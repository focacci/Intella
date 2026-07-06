import type { ApiConfig } from "./config.js";
import type { IntellaPrismaClient } from "./db.js";
import type { SystemStatus } from "./schemas.js";

export type SystemStatusOverrides = Partial<{
  forceLocal: boolean;
  forceRules: boolean;
  llmUp: boolean;
  providerUp: boolean;
  lastBackupAt: string | null;
  lastSyncAt: string | null;
  spendMTD: number;
  spendCeiling: number;
}>;

/**
 * Assemble the degraded-mode / health surface (T0.10). `mode`, LLM/provider
 * up-down, and spend come from the force toggles + config. `lastBackupAt` is
 * read from the newest successful `BackupRun` (T0.7) so the surface reflects
 * real backup state rather than a static config value; an explicit override
 * (used by tests) still wins. `lastSyncAt` stays config/override-driven until
 * the Phase 6 sync engine has a real "last synced" moment to report.
 */
export async function buildSystemStatus(
  prisma: IntellaPrismaClient,
  apiConfig: ApiConfig,
  overrides: SystemStatusOverrides = {}
): Promise<SystemStatus> {
  const forceRules = overrides.forceRules ?? apiConfig.INTELLA_FORCE_RULES;
  const forceLocal = overrides.forceLocal ?? apiConfig.INTELLA_FORCE_LOCAL;

  const lastBackupAt =
    overrides.lastBackupAt !== undefined
      ? overrides.lastBackupAt
      : ((await lastSuccessfulBackupAt(prisma)) ?? apiConfig.INTELLA_LAST_BACKUP_AT ?? null);

  return {
    mode: forceRules ? "rules_only" : forceLocal ? "rules_local" : "full",
    llm: (overrides.llmUp ?? apiConfig.INTELLA_LLM_UP) ? "up" : "down",
    provider: (overrides.providerUp ?? apiConfig.INTELLA_PROVIDER_UP) ? "up" : "down",
    lastBackupAt,
    lastSyncAt: overrides.lastSyncAt ?? apiConfig.INTELLA_LAST_SYNC_AT ?? null,
    spendMTD: overrides.spendMTD ?? apiConfig.INTELLA_LLM_SPEND_MTD,
    spendCeiling: overrides.spendCeiling ?? apiConfig.INTELLA_LLM_MONTHLY_CEILING
  };
}

/** ISO timestamp of the newest successful backup, or null if none has run. */
async function lastSuccessfulBackupAt(
  prisma: IntellaPrismaClient
): Promise<string | null> {
  const run = await prisma.backupRun.findFirst({
    where: { status: "success" },
    orderBy: { startedAt: "desc" }
  });

  if (!run) {
    return null;
  }

  return (run.finishedAt ?? run.startedAt).toISOString();
}
