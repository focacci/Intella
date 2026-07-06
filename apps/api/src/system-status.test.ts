import { describe, expect, it } from "vitest";

import { buildServer } from "./server.js";
import { closeAppAndDatabase, createTestDatabase } from "./test-helpers.js";

describe("GET /system/status", () => {
  it("returns a well-formed full-mode status object", async () => {
    const database = await createTestDatabase();
    const app = buildServer({
      authToken: "test-token",
      logger: false,
      prisma: database.prisma,
      systemStatus: {
        lastBackupAt: "2026-07-05T10:00:00.000Z",
        lastSyncAt: "2026-07-05T10:05:00.000Z",
        spendMTD: 2.4,
        spendCeiling: 10
      }
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/system/status",
        headers: {
          authorization: "Bearer test-token"
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        mode: "full",
        llm: "up",
        provider: "up",
        lastBackupAt: "2026-07-05T10:00:00.000Z",
        lastSyncAt: "2026-07-05T10:05:00.000Z",
        spendMTD: 2.4,
        spendCeiling: 10
      });
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("surfaces the newest successful backup time from the database", async () => {
    const database = await createTestDatabase();
    const finishedAt = new Date("2026-07-05T03:00:00.000Z");
    await database.prisma.backupRun.create({
      data: {
        status: "success",
        startedAt: new Date("2026-07-05T02:59:00.000Z"),
        finishedAt
      }
    });
    // A later FAILED run must not be reported as the last good backup.
    await database.prisma.backupRun.create({
      data: { status: "failed", startedAt: new Date("2026-07-05T04:00:00.000Z") }
    });

    const app = buildServer({
      authToken: "test-token",
      logger: false,
      prisma: database.prisma
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/system/status",
        headers: { authorization: "Bearer test-token" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        lastBackupAt: finishedAt.toISOString()
      });
    } finally {
      await closeAppAndDatabase(app, database);
    }
  });

  it("reflects forced-local and forced-rules toggles", async () => {
    const localDatabase = await createTestDatabase();
    const localApp = buildServer({
      authToken: "test-token",
      logger: false,
      prisma: localDatabase.prisma,
      systemStatus: {
        forceLocal: true
      }
    });

    try {
      const localResponse = await localApp.inject({
        method: "GET",
        url: "/system/status",
        headers: {
          authorization: "Bearer test-token"
        }
      });

      expect(localResponse.json()).toMatchObject({
        mode: "rules_local"
      });
    } finally {
      await closeAppAndDatabase(localApp, localDatabase);
    }

    const rulesDatabase = await createTestDatabase();
    const rulesApp = buildServer({
      authToken: "test-token",
      logger: false,
      prisma: rulesDatabase.prisma,
      systemStatus: {
        forceLocal: true,
        forceRules: true
      }
    });

    try {
      const rulesResponse = await rulesApp.inject({
        method: "GET",
        url: "/system/status",
        headers: {
          authorization: "Bearer test-token"
        }
      });

      expect(rulesResponse.json()).toMatchObject({
        mode: "rules_only"
      });
    } finally {
      await closeAppAndDatabase(rulesApp, rulesDatabase);
    }
  });
});
