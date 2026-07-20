import { createIntellaClient } from "@intella/shared";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import { buildServer } from "./server.js";
import { closeAppAndDatabase, createTestDatabase } from "./test-helpers.js";

describe("profile contract round-trip", () => {
  it("404s before onboarding writes one, and reading never creates a row", async () => {
    const database = await createTestDatabase();
    const app = buildServer({
      authToken: "test-token",
      logger: false,
      prisma: database.prisma
    });

    try {
      const client = createIntellaClient({
        authToken: "test-token",
        baseUrl: "http://intella.test",
        fetch: createInjectFetch(app)
      });

      // Null, not an auto-created empty profile: the client needs to be able to
      // tell "not onboarded" from "onboarded", and a read must not write.
      await expect(client.getProfile()).resolves.toBeNull();
      await expect(client.getProfile()).resolves.toBeNull();

      // The read side-effect this replaces persisted timezone "UTC", which
      // defeated the R1 device-timezone default on the first save.
      expect(await database.prisma.profile.count()).toBe(0);
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("serves health and GET/PUT /profile through the generated client", async () => {
    const database = await createTestDatabase();
    const app = buildServer({
      authToken: "test-token",
      logger: false,
      prisma: database.prisma
    });

    try {
      const client = createIntellaClient({
        authToken: "test-token",
        baseUrl: "http://intella.test",
        fetch: createInjectFetch(app)
      });

      await expect(client.getHealth()).resolves.toEqual({
        status: "ok"
      });

      const saved = await client.putProfile({
        age: 37,
        sex: "male",
        heightCm: 180.3,
        weightKg: 82.1,
        bodyFat: 14.5,
        timezone: "America/New_York",
        unitSystem: "imperial",
        activityLevel: "very_active"
      });

      expect(saved).toMatchObject({
        age: 37,
        sex: "male",
        heightCm: 180.3,
        weightKg: 82.1,
        bodyFat: 14.5,
        timezone: "America/New_York",
        unitSystem: "imperial",
        activityLevel: "very_active"
      });

      await expect(client.getProfile()).resolves.toEqual(saved);
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("returns 422 for a profile body outside the OpenAPI/Zod shape", async () => {
    const database = await createTestDatabase();
    const app = buildServer({
      authToken: "test-token",
      logger: false,
      prisma: database.prisma
    });

    try {
      const response = await app.inject({
        method: "PUT",
        url: "/profile",
        headers: {
          authorization: "Bearer test-token"
        },
        payload: {
          timezone: "America/New_York",
          unitSystem: "stone",
          activityLevel: "very_active"
        }
      });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        code: "validation_error"
      });
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });
});

function createInjectFetch(app: FastifyInstance) {
  return async function injectFetch(request: Request) {
    const url = new URL(request.url);
    const payload = await request.text();
    const injectOptions = {
      method: request.method.toUpperCase() as InjectMethod,
      url: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(request.headers.entries())
    };
    const response = await app.inject(
      payload ? { ...injectOptions, payload } : injectOptions
    );

    return new Response(response.body, {
      status: response.statusCode,
      headers: toResponseHeaders(response.headers)
    });
  };
}

type InjectMethod = "DELETE" | "GET" | "HEAD" | "PATCH" | "POST" | "PUT" | "OPTIONS";

function toResponseHeaders(headers: Record<string, unknown>) {
  const output = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        output.append(key, String(item));
      }
    } else if (value !== undefined) {
      output.set(key, String(value));
    }
  }

  return output;
}
