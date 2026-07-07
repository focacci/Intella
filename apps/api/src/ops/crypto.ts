import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// App-level symmetric encryption for backup snapshots (T0.7 / R21).
//
// AES-256-GCM: the 16-byte auth tag makes tampering detectable, so a corrupted
// or truncated snapshot fails the restore smoke test loudly instead of silently
// producing garbage. On-disk layout is: iv(12) || tag(16) || ciphertext.
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const BACKUP_KEY_BYTES = 32;

export async function encryptFile(
  sourcePath: string,
  destPath: string,
  key: Buffer
): Promise<void> {
  assertKey(key);
  const plaintext = await readFile(sourcePath);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  await writeFile(destPath, Buffer.concat([iv, tag, ciphertext]));
}

export async function decryptFile(
  sourcePath: string,
  destPath: string,
  key: Buffer
): Promise<void> {
  assertKey(key);
  const blob = await readFile(sourcePath);
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  await writeFile(destPath, plaintext);
}

function assertKey(key: Buffer): void {
  if (key.length !== BACKUP_KEY_BYTES) {
    throw new Error(
      `Backup key must be ${BACKUP_KEY_BYTES} bytes, received ${key.length}.`
    );
  }
}

// ---------------------------------------------------------------------------
// In-memory string encryption for small secrets (provider API keys, T1.3).
//
// Same AES-256-GCM primitive and 32-byte app key as the backup files, but
// operating on a string and returning a single base64 blob (iv || tag ||
// ciphertext) suitable for a DB column. The GCM auth tag makes a tampered or
// wrong-key value fail loudly on decrypt rather than yield garbage.
// ---------------------------------------------------------------------------

/** Encrypt a UTF-8 string to a base64 `iv || tag || ciphertext` blob. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Decrypt a base64 `iv || tag || ciphertext` blob back to a UTF-8 string. */
export function decryptSecret(blobBase64: string, key: Buffer): string {
  assertKey(key);
  const blob = Buffer.from(blobBase64, "base64");
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  );
}
