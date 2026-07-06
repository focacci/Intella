import { config } from "./config.js";
import { createPrismaClient } from "./db.js";
import { runConfiguredBackup, scheduleNightlyBackup } from "./ops/backup.js";
import { startServer } from "./server.js";

const app = await startServer();

// Optional in-process nightly backup scheduler (T0.7). Off by default; enable
// with INTELLA_BACKUP_ENABLED. Uses its own Prisma connection so it never
// contends with request handling.
const backupPrisma = config.INTELLA_BACKUP_ENABLED ? createPrismaClient() : undefined;
const backupSchedule =
  backupPrisma &&
  scheduleNightlyBackup(
    async () => {
      const result = await runConfiguredBackup(backupPrisma, config);
      if (result.ok) {
        app.log.info({ snapshot: result.snapshotPath }, "nightly backup complete");
      } else {
        app.log.error({ error: result.error }, "nightly backup failed");
      }
    },
    { hour: config.INTELLA_BACKUP_HOUR }
  );

if (backupSchedule) {
  app.log.info(`Nightly backups enabled at ${config.INTELLA_BACKUP_HOUR}:00 local`);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    backupSchedule?.stop();
    void Promise.resolve(backupPrisma?.$disconnect())
      .catch(() => undefined)
      .finally(() => {
        void app.close().finally(() => {
          process.kill(process.pid, signal);
        });
      });
  });
}
