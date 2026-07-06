import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../test-helpers.js";
import { decryptFile, encryptFile } from "./crypto.js";
import {
  checkBackupCoverage,
  formatStamp,
  msUntilNextRun,
  parseSnapshotDate,
  planRetention,
  restoreSnapshot,
  runBackup,
  SNAPSHOT_PREFIX,
  SNAPSHOT_SUFFIX
} from "./backup.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "intella-backup-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("runBackup (T0.7 gate)", () => {
  let database: TestDatabase;

  afterEach(async () => {
    await database?.cleanup();
  });

  it("writes an encrypted snapshot, keeps the DB writable, and passes the restore smoke test", async () => {
    database = await createTestDatabase();
    const backupDir = join(workDir, "backups");
    const key = randomBytes(32);

    const before = await database.prisma.profile.create({ data: { timezone: "UTC" } });

    const result = await runBackup(database.prisma, {
      sourceDbPath: database.path,
      backupDir,
      key,
      keySecure: false,
      offsiteConfigured: false,
      now: new Date(Date.UTC(2026, 6, 5, 3, 0, 0))
    });

    expect(result.ok).toBe(true);
    expect(result.restoreOk).toBe(true);
    expect(result.offsiteWarned).toBe(true); // key not keystore-backed + no offsite
    expect(result.snapshotPath).toBeDefined();
    expect(existsSync(result.snapshotPath!)).toBe(true);
    expect(result.snapshotPath!.endsWith(SNAPSHOT_SUFFIX)).toBe(true);

    // The BackupRun row records the outcome.
    const run = await database.prisma.backupRun.findUniqueOrThrow({
      where: { id: result.backupRunId }
    });
    expect(run).toMatchObject({
      status: "success",
      encrypted: true,
      restoreOk: true,
      offsiteWarned: true
    });
    expect(run.finishedAt).not.toBeNull();

    // The source DB stayed writable — a write after the snapshot succeeds.
    await expect(
      database.prisma.profile.update({
        where: { id: before.id },
        data: { weightKg: 81 }
      })
    ).resolves.toBeDefined();

    // Restoring the snapshot yields a readable DB containing the pre-backup row.
    const restored = join(workDir, "restored.db");
    await restoreSnapshot(result.snapshotPath!, restored, key);
    const db = new Database(restored, { readonly: true, fileMustExist: true });
    try {
      expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
      const count = db.prepare('SELECT count(*) AS c FROM "Profile"').get() as { c: number };
      expect(count.c).toBe(1);
    } finally {
      db.close();
    }
  });

  it("records a failed BackupRun (never throws) when the source path is bad", async () => {
    database = await createTestDatabase();
    const result = await runBackup(database.prisma, {
      sourceDbPath: join(workDir, "does-not-exist", "missing.db"),
      backupDir: join(workDir, "backups"),
      key: randomBytes(32),
      keySecure: true,
      offsiteConfigured: true
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    const run = await database.prisma.backupRun.findUniqueOrThrow({
      where: { id: result.backupRunId }
    });
    expect(run.status).toBe("failed");
  });
});

describe("encryption round-trip (T0.7)", () => {
  it("encrypts and decrypts to identical bytes and rejects tampering", async () => {
    const key = randomBytes(32);
    const plain = join(workDir, "plain.bin");
    const enc = join(workDir, "cipher.enc");
    const out = join(workDir, "out.bin");
    const payload = randomBytes(2048);
    writeFileSync(plain, payload);

    await encryptFile(plain, enc, key);
    expect(readFileSync(enc).equals(payload)).toBe(false); // actually encrypted
    await decryptFile(enc, out, key);
    expect(readFileSync(out).equals(payload)).toBe(true);

    // Flip a ciphertext byte → GCM auth tag rejects it.
    const blob = readFileSync(enc);
    const last = blob.length - 1;
    blob[last] = (blob[last] ?? 0) ^ 0xff;
    writeFileSync(enc, blob);
    await expect(decryptFile(enc, out, key)).rejects.toThrow();
  });
});

describe("planRetention (T0.7)", () => {
  const policy = { dailyKeep: 30, monthlyKeep: 6 };

  function snapshot(date: Date) {
    return { name: `${SNAPSHOT_PREFIX}${formatStamp(date)}${SNAPSHOT_SUFFIX}`, date };
  }

  it("keeps the newest 30 daily snapshots and thins older ones to monthly", () => {
    const snapshots = Array.from({ length: 40 }, (_, i) =>
      snapshot(new Date(Date.UTC(2026, 6, 5) - i * 24 * 60 * 60 * 1000))
    );

    const { keep, prune } = planRetention(snapshots, policy);

    // The 30 most recent days are all kept.
    const newest30 = snapshots.slice(0, 30).map((s) => s.name);
    for (const name of newest30) {
      expect(keep).toContain(name);
    }
    // Older ones are thinned to at most `monthlyKeep`.
    expect(keep.length).toBeLessThanOrEqual(30 + policy.monthlyKeep);
    expect(prune.length).toBe(snapshots.length - keep.length);
  });

  it("prunes intra-day duplicates, keeping the newest of the day", () => {
    const day = Date.UTC(2026, 6, 5);
    const snapshots = [
      snapshot(new Date(day + 1 * 3600 * 1000)),
      snapshot(new Date(day + 9 * 3600 * 1000)), // newest of the day
      snapshot(new Date(day + 5 * 3600 * 1000))
    ];

    const { keep, prune } = planRetention(snapshots, policy);
    expect(keep).toEqual([snapshots[1]!.name]);
    expect(prune).toHaveLength(2);
  });
});

describe("backup helpers (T0.7)", () => {
  it("round-trips the snapshot timestamp", () => {
    const date = new Date(Date.UTC(2026, 6, 5, 3, 7, 9));
    const name = `${SNAPSHOT_PREFIX}${formatStamp(date)}${SNAPSHOT_SUFFIX}`;
    expect(formatStamp(date)).toBe("20260705-030709");
    expect(parseSnapshotDate(name)?.getTime()).toBe(date.getTime());
    expect(parseSnapshotDate("not-a-snapshot.txt")).toBeNull();
  });

  it("warns when the key is not keystore-backed or offsite is unconfigured", () => {
    expect(
      checkBackupCoverage({ keySecure: false, offsiteConfigured: false, backupDir: "/b" })
    ).toHaveLength(2);
    expect(
      checkBackupCoverage({ keySecure: true, offsiteConfigured: true, backupDir: "/b" })
    ).toHaveLength(0);
  });

  it("computes the delay to the next nightly run", () => {
    const at0200 = new Date(2026, 6, 5, 2, 0, 0);
    expect(msUntilNextRun(3, at0200)).toBe(60 * 60 * 1000); // 1h until 03:00 today
    const at0400 = new Date(2026, 6, 5, 4, 0, 0);
    expect(msUntilNextRun(3, at0400)).toBe(23 * 60 * 60 * 1000); // 03:00 tomorrow
  });
});
