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

describe("goals endpoints", () => {
  it("persists a structured goal (R4) and updates by id", async () => {
    const { database, app, client } = await setup();

    try {
      await expect(client.getGoals()).resolves.toEqual([]);

      const created = await client.putGoal({
        type: "lose_fat",
        targetKind: "rate",
        targetValue: -0.5,
        targetUnit: "kg_per_week",
        note: "cut for summer",
        priority: 1
      });

      // Structured fields persist as structured fields, not free text.
      expect(created).toMatchObject({
        type: "lose_fat",
        targetKind: "rate",
        targetValue: -0.5,
        targetUnit: "kg_per_week",
        note: "cut for summer",
        priority: 1,
        status: "active"
      });
      expect(created.id).toBeTruthy();

      // Updating with the id edits the same goal (no duplicate).
      const updated = await client.putGoal({
        id: created.id,
        type: "lose_fat",
        targetKind: "rate",
        targetValue: -0.75,
        targetUnit: "kg_per_week",
        note: "steeper cut",
        priority: 1
      });
      expect(updated.id).toBe(created.id);
      expect(updated.targetValue).toBe(-0.75);

      const goals = await client.getGoals();
      expect(goals).toHaveLength(1);
      expect(goals[0]?.targetValue).toBe(-0.75);
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("supports multiple goals ordered by priority (R14)", async () => {
    const { database, app, client } = await setup();

    try {
      await client.putGoal({ type: "build_muscle", priority: 2 });
      await client.putGoal({ type: "get_stronger", priority: 1 });

      const goals = await client.getGoals();
      expect(goals.map((goal) => goal.type)).toEqual(["get_stronger", "build_muscle"]);
      expect(goals.map((goal) => goal.priority)).toEqual([1, 2]);
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("404s a PUT that targets an unknown goal id", async () => {
    const { database, app } = await setup();

    try {
      const response = await app.inject({
        method: "PUT",
        url: "/goals",
        headers: { authorization: "Bearer test-token" },
        payload: { id: "nonexistent", type: "general_health" }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: "not_found" });
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("rejects an invalid goal type with 422", async () => {
    const { database, app } = await setup();

    try {
      const response = await app.inject({
        method: "PUT",
        url: "/goals",
        headers: { authorization: "Bearer test-token" },
        payload: { type: "win_olympics" }
      });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: "validation_error" });
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });
});
