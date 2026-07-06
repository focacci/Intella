import { createHash, randomInt } from "node:crypto";

import type { IntellaPrismaClient } from "./db.js";
import type { PairResult } from "./schemas.js";
import { mintToken } from "./tokens.js";

// ---------------------------------------------------------------------------
// Device pairing (T0.12 · R22)
//
// `/pair` is NOT an open door. First-run `setup` opens a *time-boxed* pairing
// window and prints a short-lived PIN (carried by the QR alongside the base
// URL). A device redeems the PIN via unauthenticated `GET /pair?pin=…`, and a
// per-device token is minted ONLY when the PIN matches a window that is still
// open (`expiresAt > now`) and unconsumed. Redemption is single-use — the
// window is consumed so the PIN cannot be replayed. Outside any open window
// `/pair` returns 403, so a trusted tailnet peer cannot silently pull a token.
//
// Only the SHA-256 hash of the PIN is stored, mirroring ApiToken. The PIN is a
// short, human-legible alphabet (Crockford-ish base32 without ambiguous chars)
// and carries ~40 bits of entropy — high enough that guessing inside a short
// window is infeasible, short enough to read off a console.
// ---------------------------------------------------------------------------

/** Unambiguous alphabet: no 0/O, 1/I/L, U — safe to read and type. */
const PIN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const PIN_LENGTH = 8;

export const DEFAULT_PAIRING_TTL_MINUTES = 10;

export function generatePin(): string {
  let pin = "";
  for (let i = 0; i < PIN_LENGTH; i += 1) {
    pin += PIN_ALPHABET[randomInt(PIN_ALPHABET.length)];
  }
  return pin;
}

/** Case-insensitive: PINs are normalized to upper-case before hashing. */
export function hashPin(pin: string): string {
  return createHash("sha256").update(pin.trim().toUpperCase()).digest("hex");
}

export type OpenedPairingWindow = {
  id: string;
  pin: string;
  deviceName: string;
  expiresAt: Date;
};

export type OpenPairingWindowOptions = {
  ttlMinutes?: number;
  deviceName?: string;
  now?: Date;
};

/**
 * Open a fresh pairing window and return its plaintext PIN (shown once — never
 * persisted). Any still-open windows are pre-consumed so only the newest PIN is
 * live; re-running `setup` cleanly supersedes a prior, unused window.
 */
export async function openPairingWindow(
  prisma: IntellaPrismaClient,
  options: OpenPairingWindowOptions = {}
): Promise<OpenedPairingWindow> {
  const now = options.now ?? new Date();
  const ttlMinutes = options.ttlMinutes ?? DEFAULT_PAIRING_TTL_MINUTES;
  const deviceName = options.deviceName?.trim() || "Paired device";
  const pin = generatePin();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);

  await prisma.pairingWindow.updateMany({
    where: { consumedAt: null },
    data: { consumedAt: now }
  });

  const row = await prisma.pairingWindow.create({
    data: {
      pinHash: hashPin(pin),
      deviceName,
      expiresAt
    }
  });

  return { id: row.id, pin, deviceName, expiresAt };
}

export type RedeemPairingResult =
  | { ok: true; result: PairResult }
  | { ok: false };

/**
 * Redeem a PIN. Succeeds only against a window that matches the PIN hash, has
 * not expired, and has not been consumed. On success mints a per-device token
 * and consumes the window atomically (single-use). Any failure is a flat 403 —
 * we never distinguish "wrong PIN" from "no window" from "expired", so probing
 * leaks nothing.
 */
export async function redeemPairingPin(
  prisma: IntellaPrismaClient,
  pin: string,
  options: { deviceName?: string; now?: Date } = {}
): Promise<RedeemPairingResult> {
  const now = options.now ?? new Date();

  if (!pin || pin.trim() === "") {
    return { ok: false };
  }

  const window = await prisma.pairingWindow.findFirst({
    where: {
      pinHash: hashPin(pin),
      consumedAt: null,
      expiresAt: { gt: now }
    }
  });

  if (!window) {
    return { ok: false };
  }

  // Consume first, and only if still unconsumed — this closes the race where
  // two requests present the same PIN concurrently (updateMany is atomic; the
  // loser sees count 0 and is rejected).
  const consumed = await prisma.pairingWindow.updateMany({
    where: { id: window.id, consumedAt: null },
    data: { consumedAt: now }
  });

  if (consumed.count === 0) {
    return { ok: false };
  }

  const name = options.deviceName?.trim() || window.deviceName;
  const minted = await mintToken(prisma, name);

  return {
    ok: true,
    result: {
      token: minted.token,
      deviceId: minted.id,
      name: minted.name
    }
  };
}
