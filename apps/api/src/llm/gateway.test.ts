import { describe, expect, it } from "vitest";

import { parseApiConfig } from "../config.js";
import type { IntellaPrismaClient } from "../db.js";
import { createTestDatabase, type TestDatabase } from "../test-helpers.js";
import { generate, lookupCache, recordCache, repairPrompt } from "./gateway.js";
import { writeOpsConfig } from "./ops-config.js";
import { parseJsonLoose } from "./providers.js";
import type { GenerateSpec, LlmProvider, ProviderResponse } from "./types.js";

// ---------------------------------------------------------------------------
// Gateway tests (T2.8). The acceptance criteria, stated directly:
//   * an unchanged input returns a cached artifact with ZERO model calls;
//   * with the API disabled, generation still returns a valid deterministic
//     result;
//   * a routed local call is validated identically to a Claude call.
// ---------------------------------------------------------------------------

const testConfig = parseApiConfig({
  NODE_ENV: "test",
  INTELLA_AUTH_TOKEN: "test-token"
});

type Payload = { value: string };

/** A provider stub that counts calls and replays a scripted set of responses. */
function stubProvider(
  route: "claude" | "local",
  script: (unknown | Error)[]
): LlmProvider & { calls: number; lastMessages: unknown } {
  let index = 0;

  return {
    route,
    calls: 0,
    lastMessages: null,
    async call(input): Promise<ProviderResponse> {
      this.calls += 1;
      this.lastMessages = input.messages;

      const next = script[Math.min(index, script.length - 1)];
      index += 1;

      if (next instanceof Error) {
        throw next;
      }

      return {
        output: next,
        model: route === "claude" ? "claude-opus-4-8" : "llama3.1",
        tokensIn: 1000,
        tokensOut: 500
      };
    }
  };
}

/**
 * A spec whose validator accepts only `{ value: "good" }`. Everything else is a
 * violation, so the repair loop and the fallback are both directly observable.
 */
function makeSpec(
  overrides: Partial<GenerateSpec<Payload>> = {}
): GenerateSpec<Payload> {
  return {
    generator: "test_generator",
    inputHash: "hash-1",
    hashVersion: 1,
    complexity: "hard",
    system: "system",
    prompt: "prompt",
    toolName: "emit",
    toolDescription: "emit",
    toolSchema: { type: "object" },
    validate: (raw) => {
      const value = (raw as Payload | null)?.value;
      return value === "good"
        ? { ok: true, value: { value } }
        : {
            ok: false,
            violations: [{ rule: "bad_value", detail: `value was "${String(value)}"` }]
          };
    },
    fallback: () => ({ value: "deterministic-fallback" }),
    ...overrides
  };
}

async function setup(): Promise<{
  database: TestDatabase;
  prisma: IntellaPrismaClient;
}> {
  const database = await createTestDatabase();
  return { database, prisma: database.prisma };
}

const noSleep = async () => {};

describe("gateway — content-hash cache (R20b · T2.8 AC)", () => {
  it("returns the cached artifact with ZERO model calls on an unchanged input", async () => {
    const { database, prisma } = await setup();

    try {
      const provider = stubProvider("claude", [{ value: "good" }]);
      const spec = makeSpec();

      // First run: the model is called and the artifact is recorded.
      const first = await generate(
        { prisma, config: testConfig, providers: { claude: provider }, sleep: noSleep },
        spec
      );

      expect(first.status).toBe("generated");
      expect(provider.calls).toBe(1);

      await recordCache(prisma, {
        inputHash: spec.inputHash,
        hashVersion: spec.hashVersion,
        generator: spec.generator,
        artifact: { type: "program", id: "prog-1" },
        model: "claude-opus-4-8",
        route: "claude"
      });

      // Second run with the identical hash: no model call at all.
      const second = await generate(
        { prisma, config: testConfig, providers: { claude: provider }, sleep: noSleep },
        spec
      );

      expect(second.status).toBe("cached");
      if (second.status !== "cached") {
        return;
      }
      expect(second.artifact).toEqual({ type: "program", id: "prog-1" });
      expect(provider.calls).toBe(1); // unchanged — the whole point
    } finally {
      await database.cleanup();
    }
  });

  it("misses when the hash version has moved on", async () => {
    const { database, prisma } = await setup();

    try {
      await recordCache(prisma, {
        inputHash: "hash-1",
        hashVersion: 1,
        generator: "test_generator",
        artifact: { type: "program", id: "prog-1" },
        model: "m",
        route: "claude"
      });

      // A row hashed under a superseded serialization rule must not be reused.
      expect(await lookupCache(prisma, "hash-1", 2)).toBeNull();
      expect(await lookupCache(prisma, "hash-1", 1)).toEqual({
        type: "program",
        id: "prog-1"
      });
    } finally {
      await database.cleanup();
    }
  });

  it("misses on an unknown hash", async () => {
    const { database, prisma } = await setup();
    try {
      expect(await lookupCache(prisma, "never-seen", 1)).toBeNull();
    } finally {
      await database.cleanup();
    }
  });
});

describe("gateway — degraded modes (T2.8 AC)", () => {
  it("returns a valid deterministic result when NO model is reachable", async () => {
    const { database, prisma } = await setup();

    try {
      const result = await generate(
        {
          prisma,
          config: testConfig,
          providers: { claude: null, local: null },
          sleep: noSleep
        },
        makeSpec()
      );

      expect(result.status).toBe("generated");
      if (result.status !== "generated") {
        return;
      }

      expect(result.value).toEqual({ value: "deterministic-fallback" });
      expect(result.route).toBe("rules");
      expect(result.degraded).toBe(true);
      expect(result.degradedReason).toContain("No model is reachable");
    } finally {
      await database.cleanup();
    }
  });

  it("honours the INTELLA_FORCE_RULES kill switch even with a working provider", async () => {
    const { database, prisma } = await setup();

    try {
      const provider = stubProvider("claude", [{ value: "good" }]);

      const result = await generate(
        {
          prisma,
          config: parseApiConfig({
            NODE_ENV: "test",
            INTELLA_AUTH_TOKEN: "t",
            INTELLA_FORCE_RULES: "true"
          }),
          providers: { claude: provider },
          sleep: noSleep
        },
        makeSpec()
      );

      expect(provider.calls).toBe(0);
      expect(result.status === "generated" && result.degraded).toBe(true);
    } finally {
      await database.cleanup();
    }
  });

  it("falls back to rules when a provider is unreachable, after retrying", async () => {
    const { database, prisma } = await setup();

    try {
      const provider = stubProvider("claude", [new Error("ECONNREFUSED")]);

      const result = await generate(
        { prisma, config: testConfig, providers: { claude: provider }, sleep: noSleep },
        makeSpec()
      );

      // Transport retries are separate from validation repairs (R10 step 5).
      expect(provider.calls).toBe(3);
      expect(result.status === "generated" && result.degraded).toBe(true);
      expect(result.status === "generated" && result.degradedReason).toContain(
        "Model unavailable"
      );

      // The failure is still logged for observability.
      const calls = await prisma.llmCall.findMany();
      expect(calls).toHaveLength(1);
      expect(calls[0]?.error).toContain("ECONNREFUSED");
      expect(calls[0]?.validatorPassed).toBe(false);
    } finally {
      await database.cleanup();
    }
  });
});

describe("gateway — the generate → validate → repair loop (R10)", () => {
  it("repairs once and succeeds", async () => {
    const { database, prisma } = await setup();

    try {
      const provider = stubProvider("claude", [{ value: "bad" }, { value: "good" }]);

      const result = await generate(
        { prisma, config: testConfig, providers: { claude: provider }, sleep: noSleep },
        makeSpec()
      );

      expect(provider.calls).toBe(2);
      expect(result.status === "generated" && result.degraded).toBe(false);
      expect(result.status === "generated" && result.attempts).toBe(2);
    } finally {
      await database.cleanup();
    }
  });

  it("gives up after exactly two repairs and degrades (never saves invalid output)", async () => {
    const { database, prisma } = await setup();

    try {
      const provider = stubProvider("claude", [{ value: "bad" }]);

      const result = await generate(
        { prisma, config: testConfig, providers: { claude: provider }, sleep: noSleep },
        makeSpec()
      );

      // 1 initial attempt + 2 repairs = 3.
      expect(provider.calls).toBe(3);
      expect(result.status).toBe("generated");
      if (result.status !== "generated") {
        return;
      }

      // The invalid value NEVER escapes — the caller gets the deterministic one.
      expect(result.value).toEqual({ value: "deterministic-fallback" });
      expect(result.degraded).toBe(true);
      expect(result.degradedReason).toContain("bad_value");
    } finally {
      await database.cleanup();
    }
  });

  it("feeds the SPECIFIC violations back into the repair turn", async () => {
    const { database, prisma } = await setup();

    try {
      const provider = stubProvider("claude", [{ value: "bad" }, { value: "good" }]);

      await generate(
        { prisma, config: testConfig, providers: { claude: provider }, sleep: noSleep },
        makeSpec()
      );

      const messages = provider.lastMessages as { role: string; content: string }[];

      // The model's own output is echoed back so it stays anchored...
      expect(messages[1]?.role).toBe("assistant");
      expect(messages[1]?.content).toContain("bad");
      // ...followed by the exact violation to fix.
      expect(messages[2]?.content).toContain("bad_value");
      expect(messages[2]?.content).toContain('value was "bad"');
    } finally {
      await database.cleanup();
    }
  });

  it("logs one LlmCall row per attempt, with cost only on the paid route", async () => {
    const { database, prisma } = await setup();

    try {
      const provider = stubProvider("claude", [{ value: "bad" }, { value: "good" }]);

      await generate(
        { prisma, config: testConfig, providers: { claude: provider }, sleep: noSleep },
        makeSpec()
      );

      const calls = await prisma.llmCall.findMany({ orderBy: { attempt: "asc" } });

      expect(calls).toHaveLength(2);
      expect(calls[0]?.validatorPassed).toBe(false);
      expect(calls[1]?.validatorPassed).toBe(true);
      // Opus 4.8: 1000 in @ $5/M + 500 out @ $25/M = $0.005 + $0.0125.
      expect(calls[0]?.costEst).toBeCloseTo(0.0175, 6);
    } finally {
      await database.cleanup();
    }
  });
});

describe("gateway — routing (T2.8)", () => {
  it("routes routine work to the local model when one is configured", async () => {
    const { database, prisma } = await setup();

    try {
      const claude = stubProvider("claude", [{ value: "good" }]);
      const local = stubProvider("local", [{ value: "good" }]);

      const result = await generate(
        {
          prisma,
          config: testConfig,
          providers: { claude, local },
          sleep: noSleep
        },
        makeSpec({ complexity: "routine" })
      );

      expect(local.calls).toBe(1);
      expect(claude.calls).toBe(0);
      expect(result.status === "generated" && result.route).toBe("local");
    } finally {
      await database.cleanup();
    }
  });

  it("routes hard/creative work to Claude", async () => {
    const { database, prisma } = await setup();

    try {
      const claude = stubProvider("claude", [{ value: "good" }]);
      const local = stubProvider("local", [{ value: "good" }]);

      await generate(
        { prisma, config: testConfig, providers: { claude, local }, sleep: noSleep },
        makeSpec({ complexity: "hard" })
      );

      expect(claude.calls).toBe(1);
      expect(local.calls).toBe(0);
    } finally {
      await database.cleanup();
    }
  });

  it("validates a LOCAL call identically to a Claude call (T2.8 AC)", async () => {
    const { database, prisma } = await setup();

    try {
      // The same invalid payload, down each route.
      const claude = stubProvider("claude", [{ value: "bad" }]);
      const local = stubProvider("local", [{ value: "bad" }]);

      const viaClaude = await generate(
        { prisma, config: testConfig, providers: { claude, local: null }, sleep: noSleep },
        makeSpec({ complexity: "hard", inputHash: "h-claude" })
      );

      const viaLocal = await generate(
        { prisma, config: testConfig, providers: { claude: null, local }, sleep: noSleep },
        makeSpec({ complexity: "routine", inputHash: "h-local" })
      );

      // Identical treatment: same repair count, same degraded outcome.
      expect(claude.calls).toBe(3);
      expect(local.calls).toBe(3);
      expect(viaClaude.status === "generated" && viaClaude.degraded).toBe(true);
      expect(viaLocal.status === "generated" && viaLocal.degraded).toBe(true);
    } finally {
      await database.cleanup();
    }
  });

  it("falls back to Claude for routine work when no local model exists", async () => {
    const { database, prisma } = await setup();

    try {
      const claude = stubProvider("claude", [{ value: "good" }]);

      await generate(
        {
          prisma,
          config: testConfig,
          providers: { claude, local: null },
          sleep: noSleep
        },
        makeSpec({ complexity: "routine" })
      );

      expect(claude.calls).toBe(1);
    } finally {
      await database.cleanup();
    }
  });

  it("honours a per-call route override", async () => {
    const { database, prisma } = await setup();

    try {
      const claude = stubProvider("claude", [{ value: "good" }]);
      const local = stubProvider("local", [{ value: "good" }]);

      await generate(
        { prisma, config: testConfig, providers: { claude, local }, sleep: noSleep },
        makeSpec({ complexity: "hard", route: "force_local" })
      );

      expect(local.calls).toBe(1);
      expect(claude.calls).toBe(0);
    } finally {
      await database.cleanup();
    }
  });
});

describe("gateway — monthly budget ceiling (T2.8)", () => {
  it("degrades to the local model once the ceiling is reached", async () => {
    const { database, prisma } = await setup();

    try {
      await writeOpsConfig(prisma, { llmMonthlyCeiling: 0.01 });

      // A prior call this month already spent past the ceiling.
      await prisma.llmCall.create({
        data: {
          generator: "test_generator",
          route: "claude",
          model: "claude-opus-4-8",
          inputHash: "old",
          costEst: 0.5,
          validatorPassed: true
        }
      });

      const claude = stubProvider("claude", [{ value: "good" }]);
      const local = stubProvider("local", [{ value: "good" }]);

      const result = await generate(
        { prisma, config: testConfig, providers: { claude, local }, sleep: noSleep },
        makeSpec({ complexity: "hard" })
      );

      expect(claude.calls).toBe(0);
      expect(local.calls).toBe(1);
      expect(result.status === "generated" && result.route).toBe("local");
    } finally {
      await database.cleanup();
    }
  });

  it("degrades to rules over budget with no local model — never overspends", async () => {
    const { database, prisma } = await setup();

    try {
      await writeOpsConfig(prisma, { llmMonthlyCeiling: 0.01 });
      await prisma.llmCall.create({
        data: {
          generator: "g",
          route: "claude",
          model: "claude-opus-4-8",
          inputHash: "old",
          costEst: 0.5,
          validatorPassed: true
        }
      });

      const claude = stubProvider("claude", [{ value: "good" }]);

      const result = await generate(
        {
          prisma,
          config: testConfig,
          providers: { claude, local: null },
          sleep: noSleep
        },
        makeSpec()
      );

      expect(claude.calls).toBe(0);
      expect(result.status === "generated" && result.degradedReason).toContain("budget");
    } finally {
      await database.cleanup();
    }
  });

  it("does not count local calls against the budget", async () => {
    const { database, prisma } = await setup();

    try {
      const local = stubProvider("local", [{ value: "good" }]);

      await generate(
        {
          prisma,
          config: testConfig,
          providers: { claude: null, local },
          sleep: noSleep
        },
        makeSpec({ complexity: "routine" })
      );

      const calls = await prisma.llmCall.findMany();
      expect(calls[0]?.route).toBe("local");
      expect(calls[0]?.costEst).toBe(0);
    } finally {
      await database.cleanup();
    }
  });
});

describe("gateway — helpers", () => {
  it("renders a numbered repair prompt from violations", () => {
    const prompt = repairPrompt([
      { rule: "a", detail: "first problem" },
      { rule: "b", detail: "second problem" }
    ]);

    expect(prompt).toContain("1. [a] first problem");
    expect(prompt).toContain("2. [b] second problem");
    expect(prompt).toContain("call the tool");
  });

  it("extracts JSON from a fenced or prose-wrapped local-model reply", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Sure! Here you go:\n{"a":1}\nHope that helps.')).toEqual({
      a: 1
    });
    expect(parseJsonLoose("no json here")).toBeNull();
    expect(parseJsonLoose("")).toBeNull();
  });
});
