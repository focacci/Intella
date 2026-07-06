import { describe, expect, it } from "vitest";

import { buildServer } from "../server.js";
import { closeAppAndDatabase, createTestDatabase } from "../test-helpers.js";

describe("sync stubs (Phase 6 placeholder)", () => {
  it("returns 501 not_implemented for authed /sync/push and /sync/pull", async () => {
    const database = await createTestDatabase();
    const app = buildServer({
      authToken: "test-token",
      logger: false,
      prisma: database.prisma
    });

    try {
      const push = await app.inject({
        method: "POST",
        url: "/sync/push",
        headers: { authorization: "Bearer test-token" },
        payload: {}
      });
      expect(push.statusCode).toBe(501);
      expect(push.json()).toMatchObject({ code: "not_implemented" });

      const pull = await app.inject({
        method: "GET",
        url: "/sync/pull?since=0",
        headers: { authorization: "Bearer test-token" }
      });
      expect(pull.statusCode).toBe(501);
      expect(pull.json()).toMatchObject({ code: "not_implemented" });
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("still enforces auth (401 before 501)", async () => {
    const database = await createTestDatabase();
    const app = buildServer({
      authToken: "test-token",
      logger: false,
      prisma: database.prisma
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/sync/push",
        payload: {}
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });
});
