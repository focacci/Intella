import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";

import { config } from "../config.js";
import { createPrismaClient } from "../db.js";
import { buildServer } from "../server.js";
import { resolveBackupDir, restoreSnapshot, runConfiguredBackup } from "./backup.js";
import { loadOrCreateBackupKey } from "./keystore.js";

// Gate (T0.7): a nightly snapshot appears while the DB stays writable, and a
// deliberately-restored snapshot boots the API and passes sanity queries.
const prisma = createPrismaClient();
const restoredPath = join(tmpdir(), `intella-backup-smoke-${process.pid}.db`);

function fail(message: string): never {
  console.error(`Backup restore smoke FAILED: ${message}`);
  process.exit(1);
}

try {
  // 1. Take a real snapshot, then prove the live DB is still writable.
  const result = await runConfiguredBackup(prisma, config);
  if (!result.ok || !result.snapshotPath) {
    fail(result.error ?? "backup did not produce a snapshot");
  }
  await prisma.profile.updateMany({ data: { updatedAt: new Date() } }); // writable post-backup

  // 2. Restore the encrypted snapshot to a throwaway file.
  const backupDir = resolveBackupDir(config);
  const { key } = loadOrCreateBackupKey({
    backupDir,
    envKey: config.INTELLA_BACKUP_KEY
  });
  await restoreSnapshot(result.snapshotPath!, restoredPath, key);

  // 3. Sanity-query the restored file directly (read-only).
  const db = new Database(restoredPath, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma("integrity_check", { simple: true }) !== "ok") {
      fail("restored snapshot failed integrity_check");
    }
  } finally {
    db.close();
  }

  // 4. Boot the API against the restored snapshot and exercise it.
  const restoredPrisma = createPrismaClient(`file:${restoredPath}`);
  const app = buildServer({
    authToken: "smoke-token",
    logger: false,
    prisma: restoredPrisma
  });
  try {
    const health = await app.inject({
      method: "GET",
      url: "/health",
      headers: { authorization: "Bearer smoke-token" }
    });
    if (health.statusCode !== 200) {
      fail(`restored API /health returned ${health.statusCode}`);
    }

    const profile = await app.inject({
      method: "GET",
      url: "/profile",
      headers: { authorization: "Bearer smoke-token" }
    });
    if (profile.statusCode !== 200) {
      fail(`restored API /profile returned ${profile.statusCode}`);
    }
  } finally {
    await app.close();
    await restoredPrisma.$disconnect();
  }

  console.log(
    `Backup restore smoke passed: snapshot ${result.snapshotPath} restored, ` +
      `API booted, /health + /profile OK, live DB still writable.`
  );
} finally {
  rmSync(restoredPath, { force: true });
  await prisma.$disconnect();
}
