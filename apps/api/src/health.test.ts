import { describe, expect, it } from "vitest";

import { buildServer } from "./server.js";

describe("GET /health", () => {
  it("returns 401 without a bearer token", async () => {
    const app = buildServer({ authToken: "test-token", logger: false });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health"
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        code: "unauthorized"
      });
    } finally {
      await app.close();
    }
  });

  it("returns ok with a valid bearer token", async () => {
    const app = buildServer({ authToken: "test-token", logger: false });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health",
        headers: {
          authorization: "Bearer test-token"
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: "ok"
      });
    } finally {
      await app.close();
    }
  });
});
