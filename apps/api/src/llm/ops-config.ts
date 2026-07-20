import type { IntellaPrismaClient } from "../db.js";
import { mergeSafetyEnvelope } from "../training/safety.js";
import type { SafetyEnvelope } from "../training/types.js";
import type { RouterPolicy } from "./types.js";

// ---------------------------------------------------------------------------
// `OpsConfig` — the single operator row the gateway reads on every generation.
//
// It is deliberately a database row rather than env vars: the budget ceiling,
// the router policy, and the safety floors are things the user changes from
// Settings at runtime, and a restart to pick up a new ceiling would be absurd
// for a self-hosted single-user app.
//
// Reads NEVER fail: a missing row yields the shipped defaults rather than an
// error, so a fresh install generates on first run without any setup step.
// ---------------------------------------------------------------------------

export const OPS_CONFIG_ID = "singleton";

/**
 * The Claude model the gateway routes hard/creative work to. Opus 4.8 is the
 * current most-capable Opus-tier model; program design is exactly the kind of
 * structural, constraint-satisfying task that benefits from it.
 */
export const DEFAULT_CLAUDE_MODEL = "claude-opus-4-8";

/** Ollama's default chat model. Only used when a local endpoint is configured. */
export const DEFAULT_LOCAL_MODEL = "llama3.1";

export const DEFAULT_MONTHLY_CEILING_USD = 10;

export type ResolvedOpsConfig = {
  llmMonthlyCeiling: number;
  routerPolicy: RouterPolicy;
  localModelEndpoint: string | null;
  localModel: string;
  claudeModel: string;
  safetyFloors: SafetyEnvelope;
};

const ROUTER_POLICIES: ReadonlySet<string> = new Set([
  "auto",
  "force_local",
  "force_claude",
  "rules_only"
]);

/** Read the ops row, falling back to defaults for a missing or corrupt row. */
export async function readOpsConfig(
  prisma: IntellaPrismaClient
): Promise<ResolvedOpsConfig> {
  const row = await prisma.opsConfig.findUnique({ where: { id: OPS_CONFIG_ID } });

  if (!row) {
    return defaultOpsConfig();
  }

  return {
    llmMonthlyCeiling:
      Number.isFinite(row.llmMonthlyCeiling) && row.llmMonthlyCeiling >= 0
        ? row.llmMonthlyCeiling
        : DEFAULT_MONTHLY_CEILING_USD,
    routerPolicy: ROUTER_POLICIES.has(row.routerPolicy)
      ? (row.routerPolicy as RouterPolicy)
      : "auto",
    localModelEndpoint: normalizeEndpoint(row.localModelEndpoint),
    localModel: row.localModel.trim() || DEFAULT_LOCAL_MODEL,
    claudeModel: row.claudeModel.trim() || DEFAULT_CLAUDE_MODEL,
    safetyFloors: mergeSafetyEnvelope(parseJson(row.safetyFloors))
  };
}

export function defaultOpsConfig(): ResolvedOpsConfig {
  return {
    llmMonthlyCeiling: DEFAULT_MONTHLY_CEILING_USD,
    routerPolicy: "auto",
    localModelEndpoint: null,
    localModel: DEFAULT_LOCAL_MODEL,
    claudeModel: DEFAULT_CLAUDE_MODEL,
    safetyFloors: mergeSafetyEnvelope(null)
  };
}

/** Upsert the singleton row. Only supplied fields are written. */
export async function writeOpsConfig(
  prisma: IntellaPrismaClient,
  patch: Partial<{
    llmMonthlyCeiling: number;
    routerPolicy: RouterPolicy;
    localModelEndpoint: string | null;
    localModel: string;
    claudeModel: string;
    safetyFloors: unknown;
  }>
): Promise<ResolvedOpsConfig> {
  const data: Record<string, unknown> = {};

  if (patch.llmMonthlyCeiling !== undefined) {
    data.llmMonthlyCeiling = Math.max(0, patch.llmMonthlyCeiling);
  }
  if (patch.routerPolicy !== undefined) {
    data.routerPolicy = patch.routerPolicy;
  }
  if (patch.localModelEndpoint !== undefined) {
    data.localModelEndpoint = patch.localModelEndpoint;
  }
  if (patch.localModel !== undefined) {
    data.localModel = patch.localModel;
  }
  if (patch.claudeModel !== undefined) {
    data.claudeModel = patch.claudeModel;
  }
  if (patch.safetyFloors !== undefined) {
    data.safetyFloors = JSON.stringify(patch.safetyFloors ?? {});
  }

  await prisma.opsConfig.upsert({
    where: { id: OPS_CONFIG_ID },
    update: data,
    create: { id: OPS_CONFIG_ID, ...data }
  });

  return readOpsConfig(prisma);
}

/**
 * Month-to-date model spend in USD, summed from `LlmCall`. This is what the
 * budget ceiling is enforced against — a real number derived from real calls,
 * not a config guess.
 */
export async function spendMonthToDate(
  prisma: IntellaPrismaClient,
  now: Date = new Date()
): Promise<number> {
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  );

  const result = await prisma.llmCall.aggregate({
    _sum: { costEst: true },
    where: { createdAt: { gte: monthStart } }
  });

  return round4(result._sum.costEst ?? 0);
}

function normalizeEndpoint(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/+$/, "");
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
