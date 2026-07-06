import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { config } from "../config.js";
import { listSnapshots, resolveBackupDir, restoreSnapshot } from "./backup.js";
import { loadOrCreateBackupKey } from "./keystore.js";

// Migration-discipline gate (T0.8): restore the latest snapshot to a throwaway
// database and run `prisma migrate deploy` against it. This dry-runs the
// committed migrations — including any new additive migration — against a copy
// of real, production-shaped data before it is ever applied to the live DB.
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const backupDir = resolveBackupDir(config);

const snapshots = listSnapshots(backupDir).sort(
  (a, b) => b.date.getTime() - a.date.getTime()
);
const latest = snapshots[0];

if (!latest) {
  console.error(
    `No snapshots found in ${backupDir}. Run \`pnpm backup:run\` first to create one.`
  );
  process.exit(1);
}

const restoredPath = join(tmpdir(), `intella-migrate-verify-${process.pid}.db`);
const { key } = loadOrCreateBackupKey({
  backupDir,
  envKey: config.INTELLA_BACKUP_KEY
});

try {
  await restoreSnapshot(join(backupDir, latest.name), restoredPath, key);
  console.log(`Restored ${latest.name} → ${restoredPath}; applying migrations…`);

  const deploy = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: `file:${restoredPath}` },
    stdio: "inherit"
  });

  if (deploy.status !== 0) {
    console.error("Migrations FAILED against the restored snapshot.");
    process.exitCode = 1;
  } else {
    console.log("Migrations apply cleanly against the restored snapshot.");
  }
} finally {
  rmSync(restoredPath, { force: true });
}
