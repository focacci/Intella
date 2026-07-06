import QRCode from "qrcode";

import { config, publicBaseUrl } from "../config.js";
import { createPrismaClient } from "../db.js";
import { openPairingWindow } from "../pairing.js";
import { checkBackupCoverage, resolveBackupDir } from "./backup.js";
import { loadOrCreateBackupKey } from "./keystore.js";

// ---------------------------------------------------------------------------
// First-run setup — the app-level tail of the `setup` entrypoint (T0.12 · R22).
//
// The Docker entrypoint (or `pnpm setup`) runs the heavy Prisma steps first —
// ensure the SQLite file, `migrate deploy`, `db seed` (which enables WAL) — and
// then hands off to this script for the parts that need application code:
//
//   1. (re)assert WAL, defensively;
//   2. open a time-boxed pairing window + short-lived PIN (R22);
//   3. warn if the backup dir lacks encryption / offsite coverage (R21);
//   4. print the PIN and render a scannable pairing QR (base URL + PIN).
//
// Safe to re-run: each run opens a fresh window and supersedes any prior one.
// Nothing here mints a long-lived token by itself — the token is issued only
// when a device redeems the PIN through `GET /pair`.
// ---------------------------------------------------------------------------

const prisma = createPrismaClient();

try {
  // WAL is also set by the seed step; assert it here so a bare `setup` run (or a
  // future entrypoint reorder) can never leave the DB in rollback-journal mode.
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");

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

  const window = await openPairingWindow(prisma, {
    ttlMinutes: config.INTELLA_PAIRING_TTL_MINUTES,
    deviceName: config.INTELLA_PAIRING_DEVICE_NAME
  });

  const baseUrl = publicBaseUrl(config);
  // The QR carries base URL + PIN so the phone learns *where* to dial and *how*
  // to redeem in one scan (R22). A compact, stable JSON envelope the iOS pairing
  // flow (Phase 6) parses; `v` lets the format evolve without breaking clients.
  const payload = JSON.stringify({ v: 1, baseUrl, pin: window.pin });
  const qr = await QRCode.toString(payload, { type: "terminal", small: true });

  const ttl = config.INTELLA_PAIRING_TTL_MINUTES;
  console.log("");
  console.log("╭──────────────────────────────────────────────╮");
  console.log("│  Intella — pair a device                       │");
  console.log("╰──────────────────────────────────────────────╯");
  console.log(qr);
  console.log(`  Base URL : ${baseUrl}`);
  console.log(`  PIN      : ${window.pin}`);
  console.log(`  Expires  : ${window.expiresAt.toISOString()} (~${ttl} min)`);
  console.log("");
  console.log("  Scan the QR in the Intella app, or open:");
  console.log(`    ${baseUrl}/pair?pin=${window.pin}`);
  console.log("");
  console.log("  Re-run `setup` (or `pnpm setup`) to pair another device.");
  console.log("");

  process.exitCode = 0;
} catch (error) {
  console.error(`Setup FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
