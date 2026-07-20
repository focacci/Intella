import { config as defaultConfig, type ApiConfig } from "../config.js";
import type { IntellaPrismaClient } from "../db.js";
import { readProviderKey } from "../settings.js";
import type { Violation } from "../training/types.js";
import { readOpsConfig, spendMonthToDate, type ResolvedOpsConfig } from "./ops-config.js";
import {
  createAnthropicProvider,
  createLocalProvider,
  estimateCostUsd,
  ProviderError
} from "./providers.js";
import type {
  CachedArtifact,
  GenerateResult,
  GenerateSpec,
  LlmProvider,
  Route,
  RouterPolicy
} from "./types.js";

// ---------------------------------------------------------------------------
// The LLM gateway (T2.8).
//
//   cache-check → route → call → validate → log
//
// Every generator in the app goes through this one function. What that buys:
//
//   * CACHE (R20b). An unchanged `inputHash` returns the prior artifact with
//     ZERO model calls. The hash covers the constraints AND the id+updatedAt of
//     every referenced row, so "nothing that shaped it changed" is a real claim.
//
//   * ROUTING. Routine work goes to a local model when one is configured;
//     hard/creative work goes to Claude. Both are validated identically.
//
//   * BUDGET. The month-to-date sum of `LlmCall.costEst` is checked against the
//     ceiling before every paid call. Over budget, the gateway degrades to
//     local, then to rules — it never silently overspends and never hard-stops.
//
//   * THE R10 LOOP. Validate → on violation re-prompt with the SPECIFIC
//     violations (max 2 repairs) → still invalid → deterministic fallback,
//     returned with `degraded = true` and a reason. Invalid output is never
//     returned to the caller, so it can never be persisted.
//
//   * OBSERVABILITY. One `LlmCall` row per attempt, with route, tokens, cost,
//     latency, and whether the validator passed.
// ---------------------------------------------------------------------------

const DEFAULT_MAX_REPAIRS = 2;

/** Transport-level retries, separate from validation repairs (R10 step 5). */
const MAX_TRANSPORT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 400;

export type GatewayDeps = {
  prisma: IntellaPrismaClient;
  config?: ApiConfig;
  /** Injected in tests so the router can be exercised without a network. */
  providers?: Partial<Record<Exclude<Route, "rules">, LlmProvider | null>>;
  /** Injected in tests. Defaults to `Date.now`-based timing. */
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};



/**
 * Look up a previously generated artifact by content hash. A hit means nothing
 * that shaped the artifact has changed, so it can be reused verbatim.
 */
export async function lookupCache(
  prisma: IntellaPrismaClient,
  inputHash: string,
  hashVersion: number
): Promise<CachedArtifact | null> {
  const row = await prisma.generationCache.findUnique({ where: { inputHash } });

  // A row hashed under a superseded rule is not a hit — the rule change is
  // exactly the case where reuse would be wrong.
  if (!row || row.hashVersion !== hashVersion) {
    return null;
  }

  return { type: row.artifactType, id: row.artifactId };
}

/** Record a freshly generated artifact against its content hash. */
export async function recordCache(
  prisma: IntellaPrismaClient,
  entry: {
    inputHash: string;
    hashVersion: number;
    generator: string;
    artifact: CachedArtifact;
    model: string;
    route: Route;
  }
): Promise<void> {
  const data = {
    generator: entry.generator,
    artifactType: entry.artifact.type,
    artifactId: entry.artifact.id,
    model: entry.model,
    route: entry.route,
    constraintsHash: entry.inputHash,
    hashVersion: entry.hashVersion
  };

  await prisma.generationCache.upsert({
    where: { inputHash: entry.inputHash },
    update: data,
    create: { inputHash: entry.inputHash, ...data }
  });
}

/**
 * Run a generation through the gateway. Never throws for model/provider
 * reasons — every failure path lands on the deterministic fallback.
 */
export async function generate<T>(
  deps: GatewayDeps,
  spec: GenerateSpec<T>
): Promise<GenerateResult<T>> {
  const { prisma } = deps;
  const apiConfig = deps.config ?? defaultConfig;
  const sleep = deps.sleep ?? defaultSleep;

  // --- 1. Cache check --------------------------------------------------------
  const cached = await lookupCache(prisma, spec.inputHash, spec.hashVersion);
  if (cached) {
    return { status: "cached", artifact: cached };
  }

  // --- 2. Route --------------------------------------------------------------
  const ops = await readOpsConfig(prisma);
  const decision = await decideRoute(deps, apiConfig, ops, spec);

  if (decision.route === "rules") {
    return rulesOnly(spec, decision.reason);
  }

  const provider = decision.provider;
  const model = decision.route === "claude" ? ops.claudeModel : ops.localModel;

  // --- 3. Call + validate + repair (R10) -------------------------------------
  const maxRepairs = spec.maxRepairs ?? DEFAULT_MAX_REPAIRS;
  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: spec.prompt }
  ];

  let attempts = 0;
  let lastViolations: Violation[] = [];

  for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
    attempts += 1;

    const started = Date.now();
    let response;

    try {
      response = await callWithRetry(
        provider,
        {
          system: spec.system,
          messages,
          toolName: spec.toolName,
          toolDescription: spec.toolDescription,
          toolSchema: spec.toolSchema,
          model
        },
        sleep
      );
    } catch (error) {
      await logCall(prisma, {
        spec,
        route: decision.route,
        model,
        attempt: attempts,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - started,
        validatorPassed: false,
        error: error instanceof Error ? error.message : "unknown provider failure"
      });

      // Provider is down or refusing: no amount of repair prompting helps.
      return rulesOnly(
        spec,
        `Model unavailable (${error instanceof Error ? error.message : "unknown error"}).`
      );
    }

    // --- 4. Validate. Identical on every route (T2.8 AC). --------------------
    const outcome = spec.validate(response.output);

    await logCall(prisma, {
      spec,
      route: decision.route,
      model: response.model,
      attempt: attempts,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      latencyMs: Date.now() - started,
      validatorPassed: outcome.ok,
      error: null
    });

    if (outcome.ok) {
      return {
        status: "generated",
        value: outcome.value,
        route: decision.route,
        model: response.model,
        degraded: false,
        degradedReason: null,
        attempts
      };
    }

    lastViolations = outcome.violations;

    if (attempt === maxRepairs) {
      break;
    }

    // Re-prompt with the SPECIFIC violations. Echoing the model's own output
    // back first keeps it anchored on what it produced rather than starting over.
    messages.push({
      role: "assistant",
      content: JSON.stringify(response.output)
    });
    messages.push({ role: "user", content: repairPrompt(outcome.violations) });
  }

  // --- 5. Two repairs spent and still invalid → deterministic fallback -------
  return rulesOnly(
    spec,
    `Validation failed after ${attempts} attempts: ${summarize(lastViolations)}`,
    { attempts }
  );
}

// ------------------------------------------------------------------- Routing

type RouteDecision =
  | { route: "rules"; reason: string; provider: null }
  | { route: "claude" | "local"; reason: string; provider: LlmProvider };

/**
 * Pick the route. The precedence chain, highest priority first:
 *   1. an explicit per-call override on the spec;
 *   2. the env kill switches (`INTELLA_FORCE_RULES` / `INTELLA_FORCE_LOCAL`);
 *   3. the configured `OpsConfig.routerPolicy`;
 *   4. the monthly budget ceiling;
 *   5. availability — a key for Claude, an endpoint for local;
 *   6. complexity — routine work prefers local, hard work prefers Claude.
 *
 * Every branch that cannot reach a model ends at "rules", never at an error.
 */
async function decideRoute<T>(
  deps: GatewayDeps,
  apiConfig: ApiConfig,
  ops: ResolvedOpsConfig,
  spec: GenerateSpec<T>
): Promise<RouteDecision> {
  const policy: RouterPolicy = spec.route ?? resolvePolicy(apiConfig, ops);

  if (policy === "rules_only") {
    return { route: "rules", reason: "Rules-only mode is active.", provider: null };
  }

  const local = await resolveLocal(deps, ops);
  const claude = await resolveClaude(deps, ops);

  if (policy === "force_local") {
    return local
      ? { route: "local", reason: "Forced local route.", provider: local }
      : {
          route: "rules",
          reason: "Local route forced but no local model endpoint is configured.",
          provider: null
        };
  }

  // Budget: a paid call is only allowed while month-to-date spend is under the
  // ceiling. Over it, we still generate — just without paying for it.
  const overBudget =
    ops.llmMonthlyCeiling > 0 &&
    (await spendMonthToDate(deps.prisma, deps.now?.() ?? new Date())) >=
      ops.llmMonthlyCeiling;

  if (overBudget) {
    if (local) {
      return {
        route: "local",
        reason: "Monthly LLM budget reached; using the local model.",
        provider: local
      };
    }
    return {
      route: "rules",
      reason: "Monthly LLM budget reached and no local model is configured.",
      provider: null
    };
  }

  if (policy === "force_claude") {
    return claude
      ? { route: "claude", reason: "Forced Claude route.", provider: claude }
      : {
          route: "rules",
          reason: "Claude route forced but no Anthropic API key is set.",
          provider: null
        };
  }

  // auto
  if (spec.complexity === "routine" && local) {
    return { route: "local", reason: "Routine call routed locally.", provider: local };
  }

  if (claude) {
    return { route: "claude", reason: "Hard call routed to Claude.", provider: claude };
  }

  if (local) {
    return {
      route: "local",
      reason: "No Anthropic API key; falling back to the local model.",
      provider: local
    };
  }

  return {
    route: "rules",
    reason: "No model is reachable (no API key, no local endpoint).",
    provider: null
  };
}

function resolvePolicy(apiConfig: ApiConfig, ops: ResolvedOpsConfig): RouterPolicy {
  // The env kill switches are the operator's "turn it off now" lever and
  // outrank the stored policy — they are also what `GET /system/status`
  // reports as the degraded mode, so the two surfaces always agree.
  if (apiConfig.INTELLA_FORCE_RULES) {
    return "rules_only";
  }
  if (apiConfig.INTELLA_FORCE_LOCAL) {
    return "force_local";
  }
  return ops.routerPolicy;
}

async function resolveClaude(
  deps: GatewayDeps,
  ops: ResolvedOpsConfig
): Promise<LlmProvider | null> {
  if (deps.providers && "claude" in deps.providers) {
    return deps.providers.claude ?? null;
  }

  const apiConfig = deps.config ?? defaultConfig;

  // `INTELLA_LLM_UP=false` is the ops toggle used to simulate/declare an
  // Anthropic outage; honour it so system status and behaviour match.
  if (!apiConfig.INTELLA_LLM_UP) {
    return null;
  }

  const key = await readProviderKey(deps.prisma, "anthropic", apiConfig);
  if (!key) {
    return null;
  }

  void ops;
  return createAnthropicProvider(key);
}

async function resolveLocal(
  deps: GatewayDeps,
  ops: ResolvedOpsConfig
): Promise<LlmProvider | null> {
  if (deps.providers && "local" in deps.providers) {
    return deps.providers.local ?? null;
  }

  return ops.localModelEndpoint ? createLocalProvider(ops.localModelEndpoint) : null;
}

// -------------------------------------------------------------- Call plumbing

/**
 * Transport retry with backoff, kept strictly separate from validation repair
 * (R10 step 5): a 529 is retried with the identical prompt, whereas a validator
 * failure gets a NEW prompt. Conflating them would waste repair budget on
 * network blips.
 */
async function callWithRetry(
  provider: LlmProvider,
  input: Parameters<LlmProvider["call"]>[0],
  sleep: (ms: number) => Promise<void>
) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_TRANSPORT_RETRIES; attempt += 1) {
    try {
      return await provider.call(input);
    } catch (error) {
      lastError = error;

      const retryable = error instanceof ProviderError ? error.retryable : true;
      if (!retryable || attempt === MAX_TRANSPORT_RETRIES) {
        break;
      }

      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw lastError;
}

function rulesOnly<T>(
  spec: GenerateSpec<T>,
  reason: string,
  context: { attempts?: number } = {}
): GenerateResult<T> {
  return {
    status: "generated",
    value: spec.fallback(),
    route: "rules",
    model: "rules",
    degraded: true,
    degradedReason: reason,
    attempts: context.attempts ?? 0
  };
}

async function logCall<T>(
  prisma: IntellaPrismaClient,
  entry: {
    spec: GenerateSpec<T>;
    route: Route;
    model: string;
    attempt: number;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
    validatorPassed: boolean;
    error: string | null;
  }
): Promise<void> {
  // Local calls run on the user's own hardware, so they cost nothing and must
  // never consume the monthly ceiling.
  const costEst =
    entry.route === "claude"
      ? estimateCostUsd(entry.model, entry.tokensIn, entry.tokensOut)
      : 0;

  try {
    await prisma.llmCall.create({
      data: {
        generator: entry.spec.generator,
        route: entry.route,
        model: entry.model,
        inputHash: entry.spec.inputHash,
        attempt: entry.attempt,
        tokensIn: entry.tokensIn,
        tokensOut: entry.tokensOut,
        costEst,
        latencyMs: entry.latencyMs,
        validatorPassed: entry.validatorPassed,
        error: entry.error
      }
    });
  } catch {
    // Observability must never break generation. A failed log line is worth
    // strictly less than the artifact the user is waiting for.
  }
}

/** The repair turn: the exact violations, and nothing else to argue with. */
export function repairPrompt(violations: Violation[]): string {
  const lines = violations
    .slice(0, 20)
    .map((violation, index) => `${index + 1}. [${violation.rule}] ${violation.detail}`);

  return [
    "Your output failed validation. Fix EXACTLY these problems and re-emit the",
    "complete program by calling the tool again. Do not change anything else,",
    "and do not explain — just call the tool.",
    "",
    ...lines
  ].join("\n");
}

function summarize(violations: Violation[]): string {
  if (violations.length === 0) {
    return "no specific violations recorded";
  }
  return violations
    .slice(0, 3)
    .map((violation) => violation.rule)
    .join(", ");
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
