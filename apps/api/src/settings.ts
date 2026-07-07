import { config as defaultConfig, type ApiConfig } from "./config.js";
import type { IntellaPrismaClient } from "./db.js";
import { resolveBackupDir } from "./ops/backup.js";
import { decryptSecret, encryptSecret } from "./ops/crypto.js";
import { loadOrCreateBackupKey } from "./ops/keystore.js";
import type { ApiKeyStatus, ApiKeysInput } from "./schemas.js";

// ---------------------------------------------------------------------------
// Provider API keys (T1.3). Keys entered from Settings are encrypted at rest in
// `ProviderCredential` (AES-256-GCM) and returned to a caller only ever masked
// (a `set` flag + last-4). Engines decrypt them server-side in later phases via
// `readProviderKey` — that value is never exposed over HTTP.
//
// The symmetric key is the app's OS-keystore-backed key, resolved through the
// same mechanism as the backup key (env `INTELLA_BACKUP_KEY` or a 0600 keyfile
// in the backup dir); reusing it avoids introducing a second secret to manage.
// ---------------------------------------------------------------------------

export const PROVIDERS = ["anthropic", "spoonacular"] as const;
export type Provider = (typeof PROVIDERS)[number];

function appSecretKey(config: ApiConfig): Buffer {
  const { key } = loadOrCreateBackupKey({
    backupDir: resolveBackupDir(config),
    envKey: config.INTELLA_BACKUP_KEY
  });
  return key;
}

/** Masked status of every provider key — never carries a plaintext secret. */
export async function getApiKeyStatus(
  prisma: IntellaPrismaClient
): Promise<ApiKeyStatus> {
  const rows = await prisma.providerCredential.findMany();
  const byProvider = new Map(rows.map((row) => [row.provider, row]));

  return {
    anthropic: maskState(byProvider.get("anthropic")?.last4),
    spoonacular: maskState(byProvider.get("spoonacular")?.last4)
  };
}

/**
 * Store the supplied provider key(s), encrypted. Only present, non-empty fields
 * are written; an omitted provider is left unchanged. Returns the masked status.
 */
export async function putApiKeys(
  prisma: IntellaPrismaClient,
  input: ApiKeysInput,
  config: ApiConfig = defaultConfig
): Promise<ApiKeyStatus> {
  const key = appSecretKey(config);

  for (const provider of PROVIDERS) {
    const value = input[provider];
    if (value === undefined) {
      continue;
    }

    const ciphertext = encryptSecret(value, key);
    const last4 = value.slice(-4);

    await prisma.providerCredential.upsert({
      where: { provider },
      update: { ciphertext, last4 },
      create: { provider, ciphertext, last4 }
    });
  }

  return getApiKeyStatus(prisma);
}

/**
 * Decrypt and return a provider's plaintext key for server-side use (Anthropic
 * in Phase 2, Spoonacular in Phase 3). NOT exposed over HTTP. Returns null when
 * unset.
 */
export async function readProviderKey(
  prisma: IntellaPrismaClient,
  provider: Provider,
  config: ApiConfig = defaultConfig
): Promise<string | null> {
  const row = await prisma.providerCredential.findUnique({ where: { provider } });
  if (!row) {
    return null;
  }

  return decryptSecret(row.ciphertext, appSecretKey(config));
}

function maskState(last4: string | undefined): ApiKeyStatus["anthropic"] {
  return last4 ? { set: true, last4 } : { set: false, last4: null };
}
