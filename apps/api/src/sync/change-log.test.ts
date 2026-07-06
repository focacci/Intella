import { describe, expect, it } from "vitest";

import { createTestDatabase } from "../test-helpers.js";

async function maxServerSeq(
  prisma: Awaited<ReturnType<typeof createTestDatabase>>["prisma"]
): Promise<number> {
  const result = await prisma.changeLog.aggregate({ _max: { serverSeq: true } });
  return result._max.serverSeq ?? 0;
}

describe("ChangeLog / serverSeq (T0.11)", () => {
  it("appends one ChangeLog row per syncable write and advances serverSeq", async () => {
    const database = await createTestDatabase();
    const { prisma } = database;

    try {
      expect(await maxServerSeq(prisma)).toBe(0);

      const profile = await prisma.profile.create({ data: {} });
      const afterCreate = await prisma.changeLog.findFirst({
        orderBy: { serverSeq: "desc" }
      });
      expect(afterCreate).toMatchObject({
        tableName: "Profile",
        rowId: profile.id,
        op: "upsert"
      });
      const seqAfterCreate = await maxServerSeq(prisma);
      expect(seqAfterCreate).toBeGreaterThan(0);

      await prisma.profile.update({
        where: { id: profile.id },
        data: { weightKg: 80 }
      });
      const seqAfterUpdate = await maxServerSeq(prisma);
      expect(seqAfterUpdate).toBeGreaterThan(seqAfterCreate);
      expect(await prisma.changeLog.findFirst({ orderBy: { serverSeq: "desc" } })).toMatchObject({
        tableName: "Profile",
        rowId: profile.id,
        op: "upsert"
      });

      await prisma.profile.delete({ where: { id: profile.id } });
      const seqAfterDelete = await maxServerSeq(prisma);
      expect(seqAfterDelete).toBeGreaterThan(seqAfterUpdate);
      expect(await prisma.changeLog.findFirst({ orderBy: { serverSeq: "desc" } })).toMatchObject({
        tableName: "Profile",
        rowId: profile.id,
        op: "delete"
      });

      // Three writes → exactly three ChangeLog rows.
      expect(await prisma.changeLog.count()).toBe(3);
    } finally {
      await database.cleanup();
    }
  });

  it("captures the originating clientId on the ChangeLog row", async () => {
    const database = await createTestDatabase();
    const { prisma } = database;

    try {
      await prisma.feedback.create({
        data: { domain: "training", clientId: "device-42" }
      });
      const row = await prisma.changeLog.findFirst({ orderBy: { serverSeq: "desc" } });
      expect(row).toMatchObject({
        tableName: "Feedback",
        op: "upsert",
        clientId: "device-42"
      });
    } finally {
      await database.cleanup();
    }
  });

  it("bumps the sync-quartet version on each update, leaving creates at 0", async () => {
    const database = await createTestDatabase();
    const { prisma } = database;

    try {
      // Create starts at the schema default.
      const profile = await prisma.profile.create({ data: {} });
      expect(profile.version).toBe(0);

      // Each update advances the optimistic-concurrency counter (R3).
      const afterFirst = await prisma.profile.update({
        where: { id: profile.id },
        data: { weightKg: 80 }
      });
      expect(afterFirst.version).toBe(1);

      const afterSecond = await prisma.profile.update({
        where: { id: profile.id },
        data: { weightKg: 81 }
      });
      expect(afterSecond.version).toBe(2);

      // updateMany bumps too.
      await prisma.profile.updateMany({
        where: { id: profile.id },
        data: { weightKg: 82 }
      });
      const reread = await prisma.profile.findUniqueOrThrow({ where: { id: profile.id } });
      expect(reread.version).toBe(3);
    } finally {
      await database.cleanup();
    }
  });

  it("respects an explicitly supplied version instead of bumping", async () => {
    const database = await createTestDatabase();
    const { prisma } = database;

    try {
      const profile = await prisma.profile.create({ data: {} });
      // A caller that sets version directly (e.g. a sync-apply replaying an
      // authoritative value) is left untouched — no double-write.
      const updated = await prisma.profile.update({
        where: { id: profile.id },
        data: { weightKg: 90, version: 42 }
      });
      expect(updated.version).toBe(42);
    } finally {
      await database.cleanup();
    }
  });

  it("does not log writes to local-only (non-syncable) tables", async () => {
    const database = await createTestDatabase();
    const { prisma } = database;

    try {
      await prisma.apiToken.create({
        data: { name: "laptop", tokenHash: "hash-1" }
      });
      await prisma.backupRun.create({ data: { status: "success" } });

      expect(await prisma.changeLog.count()).toBe(0);
    } finally {
      await database.cleanup();
    }
  });

  it("enforces clientId uniqueness on the event tables (SetLog/BodyMetric/Feedback)", async () => {
    const database = await createTestDatabase();
    const { prisma } = database;

    try {
      // A unique index exists on all three event tables.
      const indexes = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN
         ('SetLog_clientId_key', 'BodyMetric_clientId_key', 'Feedback_clientId_key')`
      );
      expect(indexes.map((i) => i.name).sort()).toEqual([
        "BodyMetric_clientId_key",
        "Feedback_clientId_key",
        "SetLog_clientId_key"
      ]);

      // A duplicate non-null clientId is rejected (idempotent-replay guard).
      await prisma.feedback.create({ data: { domain: "meals", clientId: "dup" } });
      await expect(
        prisma.feedback.create({ data: { domain: "meals", clientId: "dup" } })
      ).rejects.toMatchObject({ code: "P2002" });

      await prisma.bodyMetric.create({ data: { date: new Date(), clientId: "bm-1" } });
      await expect(
        prisma.bodyMetric.create({ data: { date: new Date(), clientId: "bm-1" } })
      ).rejects.toMatchObject({ code: "P2002" });

      // NULL clientIds stay distinct — server-authored rows are unconstrained.
      await prisma.feedback.create({ data: { domain: "grocery" } });
      await prisma.feedback.create({ data: { domain: "grocery" } });
      expect(
        await prisma.feedback.count({ where: { clientId: null } })
      ).toBe(2);
    } finally {
      await database.cleanup();
    }
  });
});
