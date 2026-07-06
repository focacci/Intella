import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import { buildServer } from "./server.js";
import { closeAppAndDatabase, createTestDatabase } from "./test-helpers.js";
import { hashToken } from "./tokens.js";

const BOOT = "boot-token";

function authed(app: FastifyInstance, token: string) {
  return {
    get: (url: string) =>
      app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } }),
    post: (url: string, payload: unknown) =>
      app.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${token}` },
        payload: payload as object
      }),
    del: (url: string) =>
      app.inject({ method: "DELETE", url, headers: { authorization: `Bearer ${token}` } })
  };
}

describe("per-device tokens (T0.9)", () => {
  it("mints two tokens that authenticate and revoke independently", async () => {
    const database = await createTestDatabase();
    const app = buildServer({ authToken: BOOT, logger: false, prisma: database.prisma });
    const boot = authed(app, BOOT);

    try {
      const mintA = await boot.post("/auth/tokens", { name: "iPhone 15 Pro" });
      const mintB = await boot.post("/auth/tokens", { name: "MacBook" });
      expect(mintA.statusCode).toBe(201);
      expect(mintB.statusCode).toBe(201);

      const a = mintA.json();
      const b = mintB.json();
      const tokenA: string = a.token;
      const tokenB: string = b.token;

      // Both device tokens authenticate.
      expect((await authed(app, tokenA).get("/health")).statusCode).toBe(200);
      expect((await authed(app, tokenB).get("/health")).statusCode).toBe(200);

      // Only the SHA-256 hash is persisted — never the plaintext.
      const rowB = await database.prisma.apiToken.findUniqueOrThrow({ where: { id: b.id } });
      expect(rowB.tokenHash).toBe(hashToken(tokenB));
      expect(rowB.tokenHash).not.toBe(tokenB);

      // Revoke A only.
      expect((await boot.del(`/auth/tokens/${a.id}`)).statusCode).toBe(204);

      // A now 401s; B still authenticates.
      expect((await authed(app, tokenA).get("/health")).statusCode).toBe(401);
      expect((await authed(app, tokenB).get("/health")).statusCode).toBe(200);

      // Token minting/revocation is local-only — it never touches the sync log.
      expect(await database.prisma.changeLog.count()).toBe(0);
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("lists tokens without leaking the secret and stamps lastUsedAt on use", async () => {
    const database = await createTestDatabase();
    const app = buildServer({ authToken: BOOT, logger: false, prisma: database.prisma });
    const boot = authed(app, BOOT);

    try {
      const minted = (await boot.post("/auth/tokens", { name: "Watch" })).json();
      // Use the token so lastUsedAt is stamped.
      await authed(app, minted.token).get("/health");

      const list = (await boot.get("/auth/tokens")).json();
      expect(list).toHaveLength(1);

      const [entry] = list;
      expect(entry).not.toHaveProperty("token");
      expect(entry).not.toHaveProperty("tokenHash");
      expect(entry).toMatchObject({ id: minted.id, name: "Watch", revokedAt: null });
      expect(entry.lastUsedAt).not.toBeNull();
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("rejects unknown tokens, revokes idempotently, and validates input", async () => {
    const database = await createTestDatabase();
    const app = buildServer({ authToken: BOOT, logger: false, prisma: database.prisma });
    const boot = authed(app, BOOT);

    try {
      // Unknown / garbage token is unauthorized.
      expect((await authed(app, "not-a-real-token").get("/health")).statusCode).toBe(401);

      const minted = (await boot.post("/auth/tokens", { name: "Phone" })).json();

      // Revoke is idempotent; a second revoke still 204s.
      expect((await boot.del(`/auth/tokens/${minted.id}`)).statusCode).toBe(204);
      expect((await boot.del(`/auth/tokens/${minted.id}`)).statusCode).toBe(204);

      // Revoking a non-existent token is 404.
      expect((await boot.del("/auth/tokens/does-not-exist")).statusCode).toBe(404);

      // A blank device label fails validation.
      const bad = await boot.post("/auth/tokens", { name: "" });
      expect(bad.statusCode).toBe(422);
      expect(bad.json()).toMatchObject({ code: "validation_error" });
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });
});
