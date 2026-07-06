import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import { hashPin, openPairingWindow, redeemPairingPin } from "./pairing.js";
import { buildServer } from "./server.js";
import { closeAppAndDatabase, createTestDatabase } from "./test-helpers.js";

const BOOT = "boot-token";

async function newServer() {
  const database = await createTestDatabase();
  const app = buildServer({ authToken: BOOT, logger: false, prisma: database.prisma });
  return { app, database };
}

function pairUrl(pin: string, name?: string) {
  const params = new URLSearchParams({ pin });
  if (name) {
    params.set("name", name);
  }
  return `/pair?${params.toString()}`;
}

describe("pairing module (T0.12 · R22)", () => {
  it("stores only the PIN hash, never the plaintext", async () => {
    const { app, database } = await newServer();
    try {
      const window = await openPairingWindow(database.prisma, { deviceName: "Phone" });
      const row = await database.prisma.pairingWindow.findUniqueOrThrow({
        where: { id: window.id }
      });
      expect(row.pinHash).toBe(hashPin(window.pin));
      expect(row.pinHash).not.toBe(window.pin);
      expect(row.consumedAt).toBeNull();
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("redeems a valid PIN once, then rejects a replay (single-use)", async () => {
    const { app, database } = await newServer();
    try {
      const window = await openPairingWindow(database.prisma, { deviceName: "Phone" });

      const first = await redeemPairingPin(database.prisma, window.pin);
      expect(first.ok).toBe(true);
      if (first.ok) {
        expect(first.result.token).toBeTruthy();
        expect(first.result.name).toBe("Phone");
      }

      // The window is consumed — the same PIN cannot be replayed.
      const replay = await redeemPairingPin(database.prisma, window.pin);
      expect(replay.ok).toBe(false);
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("opening a new window supersedes any prior unused window", async () => {
    const { app, database } = await newServer();
    try {
      const first = await openPairingWindow(database.prisma);
      const second = await openPairingWindow(database.prisma);

      // The first PIN is now dead; only the newest window is live.
      expect((await redeemPairingPin(database.prisma, first.pin)).ok).toBe(false);
      expect((await redeemPairingPin(database.prisma, second.pin)).ok).toBe(true);
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("rejects an expired PIN", async () => {
    const { app, database } = await newServer();
    try {
      const past = new Date(Date.now() - 60_000);
      const window = await openPairingWindow(database.prisma, {
        ttlMinutes: 0.001, // ~60ms
        now: past
      });
      const outcome = await redeemPairingPin(database.prisma, window.pin);
      expect(outcome.ok).toBe(false);
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("is case-insensitive and rejects a wrong PIN", async () => {
    const { app, database } = await newServer();
    try {
      const window = await openPairingWindow(database.prisma);
      expect((await redeemPairingPin(database.prisma, "NOTITSPIN")).ok).toBe(false);
      // A fresh window (the wrong-PIN attempt did not consume the real one).
      const lower = window.pin.toLowerCase();
      expect((await redeemPairingPin(database.prisma, lower)).ok).toBe(true);
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });
});

describe("GET /pair (T0.12 · R22)", () => {
  async function unauthedPair(app: FastifyInstance, pin: string, name?: string) {
    return app.inject({ method: "GET", url: pairUrl(pin, name) });
  }

  it("mints a token with a valid PIN — no bearer token required", async () => {
    const { app, database } = await newServer();
    try {
      const window = await openPairingWindow(database.prisma);
      const res = await unauthedPair(app, window.pin, "iPhone 15 Pro");
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.token).toBeTruthy();
      expect(body.deviceId).toBeTruthy();
      expect(body.name).toBe("iPhone 15 Pro");

      // The freshly minted token authenticates a normal request.
      const health = await app.inject({
        method: "GET",
        url: "/health",
        headers: { authorization: `Bearer ${body.token}` }
      });
      expect(health.statusCode).toBe(200);
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("403s outside any open window", async () => {
    const { app, database } = await newServer();
    try {
      // No window opened at all.
      const res = await unauthedPair(app, "ANYTHING8");
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: "pairing_closed" });
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("403s on a wrong PIN and a missing PIN", async () => {
    const { app, database } = await newServer();
    try {
      await openPairingWindow(database.prisma);
      expect((await unauthedPair(app, "WRONGPIN")).statusCode).toBe(403);
      // Missing pin query param → 403 (never leaks a distinct 4xx).
      const missing = await app.inject({ method: "GET", url: "/pair" });
      expect(missing.statusCode).toBe(403);
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("does not write to the sync ChangeLog (local-only pairing state)", async () => {
    const { app, database } = await newServer();
    try {
      const window = await openPairingWindow(database.prisma);
      await unauthedPair(app, window.pin);
      expect(await database.prisma.changeLog.count()).toBe(0);
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });
});
