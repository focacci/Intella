import type { ApiConfig } from "./config.js";
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

export function buildSystemStatus(
  apiConfig: ApiConfig,
  overrides: SystemStatusOverrides = {}
): SystemStatus {
  const forceRules = overrides.forceRules ?? apiConfig.INTELLA_FORCE_RULES;
  const forceLocal = overrides.forceLocal ?? apiConfig.INTELLA_FORCE_LOCAL;

  return {
    mode: forceRules ? "rules_only" : forceLocal ? "rules_local" : "full",
    llm: (overrides.llmUp ?? apiConfig.INTELLA_LLM_UP) ? "up" : "down",
    provider: (overrides.providerUp ?? apiConfig.INTELLA_PROVIDER_UP) ? "up" : "down",
    lastBackupAt: overrides.lastBackupAt ?? apiConfig.INTELLA_LAST_BACKUP_AT ?? null,
    lastSyncAt: overrides.lastSyncAt ?? apiConfig.INTELLA_LAST_SYNC_AT ?? null,
    spendMTD: overrides.spendMTD ?? apiConfig.INTELLA_LLM_SPEND_MTD,
    spendCeiling: overrides.spendCeiling ?? apiConfig.INTELLA_LLM_MONTHLY_CEILING
  };
}
