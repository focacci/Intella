import { existsSync } from "node:fs";

import Database from "better-sqlite3";

import { config } from "../config.js";
import { createPrismaClient, databaseFilePath } from "../db.js";
import { runConfiguredBackup } from "./backup.js";

// Pre-migrate hook (T0.8): take a fresh encrypted snapshot BEFORE any migration
// touches real data, so a bad migration is always recoverable. Skips cleanly on
// a brand-new / empty database (nothing to protect). A failed snapshot aborts
// the migration — we never migrate live data we couldn't back up first.
const dbPath = databaseFilePath();

if (!existsSync(dbPath) || !hasUserTables(dbPath)) {
  console.log("Pre-migrate: no existing data to snapshot — skipping.");
  process.exit(0);
}

const prisma = createPrismaClient();

try {
  const result = await runConfiguredBackup(prisma, config);

  if (!result.ok) {
    console.error(`Pre-migrate snapshot FAILED — aborting migration: ${result.error}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Pre-migrate snapshot OK → ${result.snapshotPath} (restoreOk=${result.restoreOk}).`
    );
  }
} finally {
  await prisma.$disconnect();
}

function hasUserTables(path: string): boolean {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const row = db
      .prepare(
        `SELECT count(*) AS c FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
      )
      .get() as { c: number };
    return row.c > 0;
  } catch {
    return false;
  } finally {
    db.close();
  }
}
