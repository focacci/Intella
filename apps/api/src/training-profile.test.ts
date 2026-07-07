import { createIntellaClient } from "@intella/shared";
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

describe("training-profile endpoints", () => {
  it("404s before creation, then round-trips injuries + baseline lifts (R9)", async () => {
    const { database, app, client } = await setup();

    try {
      await expect(client.getTrainingProfile()).resolves.toBeNull();

      const created = await client.putTrainingProfile({
        experience: "intermediate",
        daysPerWeek: 4,
        sessionMins: 60,
        equipment: ["full_gym"],
        injuries: [
          { area: "left_knee", note: "avoid deep loaded flexion", avoidPatterns: ["squat"] }
        ],
        baselineLifts: [
          { pattern: "squat", estWeight: 100, estReps: 5 },
          { exerciseId: "ex_bench", estWeight: 80, estReps: 3 }
        ]
      });

      expect(created).toMatchObject({
        experience: "intermediate",
        daysPerWeek: 4,
        sessionMins: 60,
        equipment: ["full_gym"]
      });
      expect(created.injuries).toEqual([
        { area: "left_knee", note: "avoid deep loaded flexion", avoidPatterns: ["squat"] }
      ]);
      expect(created.baselineLifts).toHaveLength(2);
      expect(created.baselineLifts?.[0]).toMatchObject({
        pattern: "squat",
        estWeight: 100,
        estReps: 5
      });

      const fetched = await client.getTrainingProfile();
      expect(fetched).toEqual(created);

      // A subsequent PUT updates the same singleton row (clears injuries).
      const updated = await client.putTrainingProfile({
        experience: "advanced",
        daysPerWeek: 5,
        sessionMins: 75,
        equipment: ["home_rack", "dumbbells"],
        injuries: [],
        baselineLifts: []
      });
      expect(updated.id).toBe(created.id);
      expect(updated.experience).toBe("advanced");
      expect(updated.injuries).toEqual([]);
      expect(updated.baselineLifts).toEqual([]);
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("rejects daysPerWeek outside 1..7 with 422", async () => {
    const { database, app } = await setup();

    try {
      const response = await app.inject({
        method: "PUT",
        url: "/training-profile",
        headers: { authorization: "Bearer test-token" },
        payload: {
          experience: "beginner",
          daysPerWeek: 9,
          sessionMins: 45,
          equipment: ["dumbbells"]
        }
      });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: "validation_error" });
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("rejects a missing required field (experience) with 422", async () => {
    const { database, app } = await setup();

    try {
      const response = await app.inject({
        method: "PUT",
        url: "/training-profile",
        headers: { authorization: "Bearer test-token" },
        payload: { daysPerWeek: 3, sessionMins: 45, equipment: [] }
      });

      expect(response.statusCode).toBe(422);
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });
});
