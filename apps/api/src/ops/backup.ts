import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import Database from "better-sqlite3";

import type { ApiConfig } from "../config.js";
import { databaseFilePath, type IntellaPrismaClient } from "../db.js";
import { decryptFile, encryptFile } from "./crypto.js";
import { loadOrCreateBackupKey } from "./keystore.js";

// ---------------------------------------------------------------------------
// Nightly encrypted-snapshot backup job (T0.7 / R21). OS-agnostic:
//   1. checkpoint WAL so the snapshot is complete;
//   2. `VACUUM INTO` a dated snapshot (source DB stays writable);
//   3. app-level AES-256-GCM encryption with an OS-keystore-backed key;
//   4. prune to retention (≈30 daily + a few monthly);
//   5. read-only restore smoke test on the just-written snapshot;
//   6. record a `BackupRun` row.
// Uses a dedicated better-sqlite3 connection for the checkpoint + VACUUM so the
// app's Prisma connection is untouched and the database is never locked for
// writes. Never throws out of `runBackup` — failures degrade to a recorded
// `failed` BackupRun row (the app never hard-stops).
// ---------------------------------------------------------------------------

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

export const SNAPSHOT_PREFIX = "intella-";
export const SNAPSHOT_SUFFIX = ".db.enc";

export type RetentionPolicy = { dailyKeep: number; monthlyKeep: number };
export const DEFAULT_RETENTION: RetentionPolicy = { dailyKeep: 30, monthlyKeep: 6 };

export type BackupOptions = {
  sourceDbPath: string;
  backupDir: string;
  key: Buffer;
  /** Whether the key is held in a real OS keystore. Drives the offsite warning. */
  keySecure: boolean;
  offsiteConfigured: boolean;
  now?: Date;
  retention?: RetentionPolicy;
};

export type BackupResult = {
  ok: boolean;
  backupRunId: string;
  snapshotPath?: string;
  sizeBytes?: number;
  restoreOk: boolean;
  restoreDetail?: string;
  prunedCount: number;
  offsiteWarned: boolean;
  error?: string;
};

export async function runBackup(
  prisma: IntellaPrismaClient,
  options: BackupOptions
): Promise<BackupResult> {
  const now = options.now ?? new Date();
  const retention = options.retention ?? DEFAULT_RETENTION;
  const offsiteWarned = !options.keySecure || !options.offsiteConfigured;

  mkdirSync(options.backupDir, { recursive: true });

  const run = await prisma.backupRun.create({
    data: { status: "running", startedAt: now, offsiteWarned }
  });

  const stamp = formatStamp(now);
  const plaintextSnapshot = join(options.backupDir, `.tmp-${stamp}.db`);
  const snapshotPath = join(options.backupDir, `${SNAPSHOT_PREFIX}${stamp}${SNAPSHOT_SUFFIX}`);

  try {
    // 1 + 2. Checkpoint WAL, then a consistent snapshot that leaves the source
    // writable. Done on a separate connection so Prisma is never blocked.
    vacuumInto(options.sourceDbPath, plaintextSnapshot);

    // 3. Encrypt, then delete the plaintext snapshot.
    await encryptFile(plaintextSnapshot, snapshotPath, options.key);
    rmSync(plaintextSnapshot, { force: true });
    const sizeBytes = statSync(snapshotPath).size;

    // 4. Read-only restore smoke test on the encrypted snapshot we just wrote.
    const restore = await verifySnapshot(snapshotPath, options.key);

    // 5. Prune old snapshots to the retention window.
    const prunedCount = pruneSnapshots(options.backupDir, retention);

    await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "success",
        snapshotPath,
        sizeBytes,
        encrypted: true,
        restoreOk: restore.ok,
        prunedCount,
        offsiteWarned
      }
    });

    return {
      ok: true,
      backupRunId: run.id,
      snapshotPath,
      sizeBytes,
      restoreOk: restore.ok,
      restoreDetail: restore.detail,
      prunedCount,
      offsiteWarned
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rmSync(plaintextSnapshot, { force: true });

    await prisma.backupRun
      .update({
        where: { id: run.id },
        data: { finishedAt: new Date(), status: "failed", error: message, offsiteWarned }
      })
      .catch(() => undefined);

    return {
      ok: false,
      backupRunId: run.id,
      restoreOk: false,
      prunedCount: 0,
      offsiteWarned,
      error: message
    };
  }
}

/** Resolve options from config (keystore + dirs) and run one backup. */
export async function runConfiguredBackup(
  prisma: IntellaPrismaClient,
  config: ApiConfig,
  now?: Date
): Promise<BackupResult> {
  const backupDir = resolveBackupDir(config);
  const { key, secure } = loadOrCreateBackupKey({
    backupDir,
    envKey: config.INTELLA_BACKUP_KEY
  });

  return runBackup(prisma, {
    sourceDbPath: databaseFilePath(),
    backupDir,
    key,
    keySecure: secure,
    offsiteConfigured: Boolean(config.INTELLA_BACKUP_OFFSITE),
    ...(now ? { now } : {})
  });
}

export function resolveBackupDir(config: ApiConfig): string {
  return config.INTELLA_BACKUP_DIR ?? join(repoRoot, "backups");
}

/** Checkpoint the WAL then VACUUM INTO a fresh single-file snapshot. */
function vacuumInto(sourceDbPath: string, destPath: string): void {
  const db = new Database(sourceDbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
}

/** Decrypt a snapshot to `destPath` (disaster-recovery restore path). */
export async function restoreSnapshot(
  snapshotPath: string,
  destPath: string,
  key: Buffer
): Promise<void> {
  await decryptFile(snapshotPath, destPath, key);
}

/** Decrypt to a temp file and run read-only sanity queries against it. */
export async function verifySnapshot(
  snapshotPath: string,
  key: Buffer
): Promise<{ ok: boolean; detail: string }> {
  const tempPath = join(
    tmpdir(),
    `intella-restore-${process.pid}-${statSync(snapshotPath).size}.db`
  );

  try {
    await decryptFile(snapshotPath, tempPath, key);
    const db = new Database(tempPath, { readonly: true, fileMustExist: true });
    try {
      const integrity = db.pragma("integrity_check", { simple: true });
      if (integrity !== "ok") {
        return { ok: false, detail: `integrity_check=${String(integrity)}` };
      }

      // Sanity: the change-log cursor and profile tables are queryable.
      const changeLog = db.prepare('SELECT count(*) AS c FROM "ChangeLog"').get() as {
        c: number;
      };
      const profile = db.prepare('SELECT count(*) AS c FROM "Profile"').get() as {
        c: number;
      };
      return {
        ok: true,
        detail: `integrity=ok changeLog=${changeLog.c} profile=${profile.c}`
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    rmSync(tempPath, { force: true });
  }
}

// --------------------------------------------------------------------- Retention

type Snapshot = { name: string; date: Date };

export function pruneSnapshots(backupDir: string, policy: RetentionPolicy): number {
  const snapshots = listSnapshots(backupDir);
  const { prune } = planRetention(snapshots, policy);

  for (const name of prune) {
    rmSync(join(backupDir, name), { force: true });
  }

  return prune.length;
}

export function listSnapshots(backupDir: string): Snapshot[] {
  let entries: string[];
  try {
    entries = readdirSync(backupDir);
  } catch {
    return [];
  }

  const snapshots: Snapshot[] = [];
  for (const name of entries) {
    const date = parseSnapshotDate(name);
    if (date) {
      snapshots.push({ name, date });
    }
  }
  return snapshots;
}

/**
 * GFS-style retention: keep the newest snapshot per day for the most recent
 * `dailyKeep` days present, then one per month for older months up to
 * `monthlyKeep`. Everything else — including intra-day duplicates — is pruned.
 * Pure and deterministic (windows relative to the snapshot set, not wall clock).
 */
export function planRetention(
  snapshots: Snapshot[],
  policy: RetentionPolicy
): { keep: string[]; prune: string[] } {
  const byNewest = [...snapshots].sort((a, b) => b.date.getTime() - a.date.getTime());

  // One snapshot per calendar day (UTC), newest wins.
  const perDay: Snapshot[] = [];
  const seenDay = new Set<string>();
  for (const snapshot of byNewest) {
    const dayKey = utcDayKey(snapshot.date);
    if (!seenDay.has(dayKey)) {
      seenDay.add(dayKey);
      perDay.push(snapshot);
    }
  }

  const keep = new Set<string>();
  for (const snapshot of perDay.slice(0, policy.dailyKeep)) {
    keep.add(snapshot.name);
  }

  // Older than the daily window: keep one per month, newest first.
  const seenMonth = new Set<string>();
  const monthly: Snapshot[] = [];
  for (const snapshot of perDay.slice(policy.dailyKeep)) {
    const monthKey = utcMonthKey(snapshot.date);
    if (!seenMonth.has(monthKey)) {
      seenMonth.add(monthKey);
      monthly.push(snapshot);
    }
  }
  for (const snapshot of monthly.slice(0, policy.monthlyKeep)) {
    keep.add(snapshot.name);
  }

  const prune = snapshots.filter((s) => !keep.has(s.name)).map((s) => s.name);
  return { keep: [...keep], prune };
}

export function formatStamp(date: Date): string {
  const p = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`
  );
}

export function parseSnapshotDate(name: string): Date | null {
  if (!name.startsWith(SNAPSHOT_PREFIX) || !name.endsWith(SNAPSHOT_SUFFIX)) {
    return null;
  }

  const stamp = name.slice(SNAPSHOT_PREFIX.length, name.length - SNAPSHOT_SUFFIX.length);
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!match) {
    return null;
  }

  const [, y, mo, d, h, mi, s] = match.map(Number);
  const date = new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!, s!));
  return Number.isNaN(date.getTime()) ? null : date;
}

function utcDayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

function utcMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
}

// ------------------------------------------------------------------ Coverage

export function checkBackupCoverage(input: {
  keySecure: boolean;
  offsiteConfigured: boolean;
  backupDir: string;
}): string[] {
  const warnings: string[] = [];

  if (!input.keySecure) {
    warnings.push(
      `Backup key is not held in an OS keystore (Keychain/DPAPI/libsecret). ` +
        `Snapshots are encrypted, but the key currently lives beside them in ` +
        `${input.backupDir}. Provision a keystore-backed key for production.`
    );
  }

  if (!input.offsiteConfigured) {
    warnings.push(
      `No offsite/replication target configured (set INTELLA_BACKUP_OFFSITE to a ` +
        `synced path, e.g. iCloud/Time Machine/an external drive). A single local ` +
        `copy is not disaster-proof.`
    );
  }

  return warnings;
}

// ------------------------------------------------------------------ Scheduling

export type BackupSchedule = { stop: () => void };

/** Run `job` every day at `hour` (local time). Timers are unref'd. */
export function scheduleNightlyBackup(
  job: () => Promise<unknown>,
  options: { hour?: number } = {}
): BackupSchedule {
  const hour = options.hour ?? 3;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = () => {
    const delay = msUntilNextRun(hour, new Date());
    timer = setTimeout(() => {
      void Promise.resolve(job()).finally(arm);
    }, delay);
    timer.unref?.();
  };

  arm();

  return {
    stop() {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
}

export function msUntilNextRun(hour: number, from: Date): number {
  const next = new Date(from);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - from.getTime();
}
