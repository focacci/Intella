import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BACKUP_KEY_BYTES } from "./crypto.js";

// ---------------------------------------------------------------------------
// Backup-key keystore (T0.7 / R21).
//
// R21 wants the symmetric backup key held in the OS keystore
// (Keychain / DPAPI / libsecret). Those are native, platform-specific APIs; to
// stay OS-agnostic and runnable in the web prototype this portable backend
// resolves the key from an env var or a 0600 key file instead, and reports
// `secure: false` so first-run setup WARNS that the key is not keystore-backed.
// A native backend implementing the same shape can be dropped in for production
// without touching callers.
// ---------------------------------------------------------------------------

export type BackupKeySource = "env" | "keyfile";

export type BackupKey = {
  key: Buffer;
  source: BackupKeySource;
  /** True only when the key is held in a real OS keystore. Always false here. */
  secure: boolean;
};

export const BACKUP_KEY_FILENAME = ".backup-key";

export function loadOrCreateBackupKey(options: {
  backupDir: string;
  envKey?: string | undefined;
}): BackupKey {
  if (options.envKey) {
    const key = decodeKey(options.envKey, "INTELLA_BACKUP_KEY");
    return { key, source: "env", secure: false };
  }

  mkdirSync(options.backupDir, { recursive: true });
  const keyPath = join(options.backupDir, BACKUP_KEY_FILENAME);

  if (existsSync(keyPath)) {
    const key = decodeKey(readFileSync(keyPath, "utf8").trim(), keyPath);
    return { key, source: "keyfile", secure: false };
  }

  const key = randomBytes(BACKUP_KEY_BYTES);
  writeFileSync(keyPath, key.toString("base64"), { mode: 0o600 });
  chmodSync(keyPath, 0o600); // umask can weaken the mode above; force it.
  return { key, source: "keyfile", secure: false };
}

function decodeKey(encoded: string, label: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== BACKUP_KEY_BYTES) {
    throw new Error(
      `${label} must decode to ${BACKUP_KEY_BYTES} bytes (base64); got ${key.length}.`
    );
  }
  return key;
}
