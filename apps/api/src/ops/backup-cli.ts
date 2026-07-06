import { config } from "../config.js";
import { createPrismaClient } from "../db.js";
import { checkBackupCoverage, resolveBackupDir, runConfiguredBackup } from "./backup.js";
import { loadOrCreateBackupKey } from "./keystore.js";

// Runnable entry: perform one configured backup now (T0.7). Non-zero exit on a
// failed backup or a failed restore smoke test so cron / CI can alert.
const prisma = createPrismaClient();

try {
  const result = await runConfiguredBackup(prisma, config);

  const backupDir = resolveBackupDir(config);
  const { secure } = loadOrCreateBackupKey({
    backupDir,
    envKey: config.INTELLA_BACKUP_KEY
  });
  for (const warning of checkBackupCoverage({
    keySecure: secure,
    offsiteConfigured: Boolean(config.INTELLA_BACKUP_OFFSITE),
    backupDir
  })) {
    console.warn(`⚠️  ${warning}`);
  }

  if (result.ok) {
    console.log(
      `Backup OK → ${result.snapshotPath} ` +
        `(${result.sizeBytes} bytes, restoreOk=${result.restoreOk}, pruned=${result.prunedCount})`
    );
  } else {
    console.error(`Backup FAILED: ${result.error}`);
  }

  process.exitCode = result.ok && result.restoreOk ? 0 : 1;
} finally {
  await prisma.$disconnect();
}
