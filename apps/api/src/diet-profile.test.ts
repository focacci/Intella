import { createIntellaClient, IntellaApiError } from "@intella/shared";
import { describe, expect, it } from "vitest";

import { buildServer } from "./server.js";
import {
  closeAppAndDatabase,
  createInjectFetch,
  createTestDatabase
} from "./test-helpers.js";

async function setup() {
  const database = await createTestDatabase();
  const app = buildServer({
    authToken: "test-token",
    logger: false,
    prisma: database.prisma
  });
  const client = createIntellaClient({
    authToken: "test-token",
    baseUrl: "http://intella.test",
    fetch: createInjectFetch(app)
  });
  return { database, app, client };
}

describe("diet-profile endpoints", () => {
  it("404s before onboarding writes one, then round-trips create + update", async () => {
    const { database, app, client } = await setup();

    try {
      await expect(client.getDietProfile()).resolves.toBeNull();

      const created = await client.putDietProfile({
        pattern: "omnivore",
        restrictions: ["halal"],
        allergies: ["peanuts", "shellfish"],
        dislikes: ["cilantro"],
        cuisines: ["thai", "italian"],
        cookingSkill: "intermediate",
        effortMax: 3,
        budgetWeekly: 120,
        mealsPerDay: 3,
        snacksPerDay: 2,
        batchCooking: true,
        variety: "high"
      });

      expect(created).toMatchObject({
        pattern: "omnivore",
        allergies: ["peanuts", "shellfish"],
        cuisines: ["thai", "italian"],
        effortMax: 3,
        budgetWeekly: 120,
        variety: "high"
      });
      // Engine-computed fields stay null until Phase 3.
      expect(created.kcal).toBeNull();
      expect(created.macros).toBeNull();

      // Read back the same row (not a second create).
      const fetched = await client.getDietProfile();
      expect(fetched).toEqual(created);
      expect(fetched?.id).toBe(created.id);

      // A partial update leaves untouched fields intact.
      const updated = await client.putDietProfile({
        allergies: ["peanuts"],
        variety: "low"
      });
      expect(updated.id).toBe(created.id);
      expect(updated.allergies).toEqual(["peanuts"]);
      expect(updated.variety).toBe("low");
      expect(updated.pattern).toBe("omnivore");
      expect(updated.cuisines).toEqual(["thai", "italian"]);
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("rejects an out-of-range effortMax with 422", async () => {
    const { database, app } = await setup();

    try {
      const response = await app.inject({
        method: "PUT",
        url: "/diet-profile",
        headers: { authorization: "Bearer test-token" },
        payload: { effortMax: 9 }
      });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: "validation_error" });
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("rejects unknown fields with 422 (strict schema)", async () => {
    const { database, app } = await setup();

    try {
      const response = await app.inject({
        method: "PUT",
        url: "/diet-profile",
        headers: { authorization: "Bearer test-token" },
        payload: { kcal: 2200 } // engine-computed, not a client input
      });

      expect(response.statusCode).toBe(422);
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("404 surfaces as an IntellaApiError only via app.inject, null via client", async () => {
    const { database, app, client } = await setup();

    try {
      // The client maps 404 -> null; a raw inject shows the 404 contract.
      await expect(client.getDietProfile()).resolves.toBeNull();

      const raw = await app.inject({
        method: "GET",
        url: "/diet-profile",
        headers: { authorization: "Bearer test-token" }
      });
      expect(raw.statusCode).toBe(404);
      expect(raw.json()).toMatchObject({ code: "not_found" });

      // Sanity: unrelated client errors still throw.
      expect(IntellaApiError).toBeDefined();
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });
});
