import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import type { LlmProvider } from "../llm/types.js";
import { buildServer } from "../server.js";
import { createTestDatabase, type TestDatabase } from "../test-helpers.js";
import { todayInTimezone } from "./calendar.js";

// ---------------------------------------------------------------------------
// End-to-end training routes. Every test runs with NO model provider, which
// exercises the rules-only degraded path — the one that has to work on a fresh
// install with no API key. That is deliberate: the happy path with a live model
// is covered by the gateway's stubs, but this is the path a real first-run user
// takes.
// ---------------------------------------------------------------------------

type Ctx = { database: TestDatabase; app: FastifyInstance };

async function setup(
  options: { llmProviders?: Partial<Record<"claude" | "local", LlmProvider | null>> } = {}
): Promise<Ctx> {
  const database = await createTestDatabase();
  const app = buildServer({
    authToken: "test-token",
    logger: false,
    prisma: database.prisma,
    // No model reachable → the deterministic path.
    llmProviders: options.llmProviders ?? { claude: null, local: null }
  });

  return { database, app };
}

const auth = { authorization: "Bearer test-token" };

async function seedProfileAndLibrary(ctx: Ctx, overrides: { baselines?: boolean } = {}) {
  const { prisma } = ctx.database;

  await prisma.profile.create({
    data: { weightKg: 80, timezone: "UTC", unitSystem: "metric" }
  });

  await prisma.goal.create({ data: { type: "build_muscle", status: "active" } });

  await prisma.trainingProfile.create({
    data: {
      experience: "intermediate",
      daysPerWeek: 4,
      sessionMins: 60,
      equipment: JSON.stringify(["full_gym"]),
      injuries: "[]",
      baselineLifts: overrides.baselines
        ? JSON.stringify([{ pattern: "squat", estWeight: 100, estReps: 5 }])
        : "[]"
    }
  });

  // A small but pattern-complete library, mirroring the seeded one.
  const library = [
    ["Back Squat", "squat", ["quads", "glutes"], ["hamstrings"], ["barbell", "rack"]],
    ["Romanian Deadlift", "hinge", ["hamstrings", "glutes"], ["upper_back"], ["barbell"]],
    ["Bench Press", "horizontal_push", ["chest"], ["triceps"], ["barbell", "bench"]],
    ["Overhead Press", "vertical_push", ["shoulders"], ["triceps"], ["barbell"]],
    ["Lat Pulldown", "vertical_pull", ["lats"], ["biceps"], ["cable_machine"]],
    ["Seated Cable Row", "horizontal_pull", ["upper_back"], ["biceps"], ["cable_machine"]],
    ["Split Squat", "single_leg", ["quads", "glutes"], [], ["dumbbell"]],
    ["Leg Curl", "knee_flexion", ["hamstrings"], [], ["machine"]],
    ["Standing Calf Raise", "calf_raise", ["calves"], [], ["machine"]],
    ["Dumbbell Curl", "elbow_flexion", ["biceps"], [], ["dumbbell"]],
    ["Cable Triceps Pressdown", "elbow_extension", ["triceps"], [], ["cable_machine"]],
    ["Plank", "core", ["core"], [], ["bodyweight"]]
  ] as const;

  for (const [name, pattern, primary, secondary, equipment] of library) {
    await prisma.exercise.create({
      data: {
        name,
        pattern,
        difficulty: "beginner",
        primaryMuscles: JSON.stringify(primary),
        secondaryMus: JSON.stringify(secondary),
        equipment: JSON.stringify(equipment)
      }
    });
  }
}

describe("GET /exercises (T2.1)", () => {
  it("lists the library and filters by equipment and muscle", async () => {
    const ctx = await setup();

    try {
      await seedProfileAndLibrary(ctx);

      const all = await ctx.app.inject({ method: "GET", url: "/exercises", headers: auth });
      expect(all.statusCode).toBe(200);
      expect(all.json()).toHaveLength(12);

      const barbell = await ctx.app.inject({
        method: "GET",
        url: "/exercises?equipment=barbell",
        headers: auth
      });
      const names = (barbell.json() as { name: string }[]).map((row) => row.name);
      expect(names).toEqual(
        expect.arrayContaining(["Back Squat", "Bench Press", "Overhead Press"])
      );
      expect(names).not.toContain("Leg Curl");

      const quads = await ctx.app.inject({
        method: "GET",
        url: "/exercises?muscle=quads",
        headers: auth
      });
      expect((quads.json() as { name: string }[]).map((row) => row.name)).toEqual([
        "Back Squat",
        "Split Squat"
      ]);

      // Filters compose.
      const both = await ctx.app.inject({
        method: "GET",
        url: "/exercises?muscle=quads&equipment=barbell",
        headers: auth
      });
      expect(both.json()).toHaveLength(1);
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });

  it("requires auth", async () => {
    const ctx = await setup();
    try {
      const response = await ctx.app.inject({ method: "GET", url: "/exercises" });
      expect(response.statusCode).toBe(401);
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });
});

describe("POST /training/program:generate (T2.4)", () => {
  it("422s with a specific code when onboarding is incomplete", async () => {
    const ctx = await setup();

    try {
      const noProfile = await ctx.app.inject({
        method: "POST",
        url: "/training/program:generate",
        headers: auth
      });

      expect(noProfile.statusCode).toBe(422);
      expect(noProfile.json()).toMatchObject({ code: "no_training_profile" });

      // With a training profile but no goal, the other precondition fires.
      await ctx.database.prisma.trainingProfile.create({
        data: {
          experience: "beginner",
          daysPerWeek: 3,
          sessionMins: 45,
          equipment: JSON.stringify(["bodyweight"])
        }
      });

      const noGoal = await ctx.app.inject({
        method: "POST",
        url: "/training/program:generate",
        headers: auth
      });

      expect(noGoal.statusCode).toBe(422);
      expect(noGoal.json()).toMatchObject({ code: "no_goal" });
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });

  it("generates and persists a valid program with the LLM unreachable (R18)", async () => {
    const ctx = await setup();

    try {
      await seedProfileAndLibrary(ctx);

      const response = await ctx.app.inject({
        method: "POST",
        url: "/training/program:generate",
        headers: auth
      });

      expect(response.statusCode).toBe(201);
      const program = response.json() as {
        id: string;
        weeks: number;
        degraded: boolean;
        calibrationWeeks: number;
        inputConstraints: Record<string, unknown>;
      };

      // Degraded, but real: a usable program, honestly flagged.
      expect(program.degraded).toBe(true);
      // No baseline lifts were given, so week 1 discovers loads (R9).
      expect(program.calibrationWeeks).toBe(1);
      // The explainability backbone is persisted.
      expect(program.inputConstraints.split).toBeTruthy();
      expect(program.inputConstraints.weeklySetTargets).toBeTruthy();

      // Sessions were created as their own top-level rows, so each one has a
      // ChangeLog entry and will reach a paired device via /sync/pull.
      const sessions = await ctx.database.prisma.workoutSession.findMany();
      expect(sessions).toHaveLength(program.weeks * 4);

      const logged = await ctx.database.prisma.changeLog.findMany({
        where: { tableName: "WorkoutSession" }
      });
      expect(logged).toHaveLength(sessions.length);

      // Week 1 is labelled as calibration so the UI can explain the light loads.
      expect(
        sessions.filter((session) => session.weekNo === 1).every(
          (session) => session.label === "Calibration"
        )
      ).toBe(true);
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });

  it("skips the calibration week when baseline lifts are on file (R9)", async () => {
    const ctx = await setup();

    try {
      await seedProfileAndLibrary(ctx, { baselines: true });

      const response = await ctx.app.inject({
        method: "POST",
        url: "/training/program:generate",
        headers: auth
      });

      expect((response.json() as { calibrationWeeks: number }).calibrationWeeks).toBe(0);
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });

  it("archives the previous program when a new one is generated", async () => {
    const ctx = await setup();

    try {
      await seedProfileAndLibrary(ctx);

      await ctx.app.inject({
        method: "POST",
        url: "/training/program:generate",
        headers: auth
      });

      // Change an input so the content hash differs and a fresh program is built.
      await ctx.database.prisma.trainingProfile.updateMany({
        data: { daysPerWeek: 3 }
      });

      await ctx.app.inject({
        method: "POST",
        url: "/training/program:generate",
        headers: auth
      });

      const active = await ctx.database.prisma.program.findMany({
        where: { status: "active" }
      });
      expect(active).toHaveLength(1);

      const archived = await ctx.database.prisma.program.findMany({
        where: { status: "archived" }
      });
      expect(archived).toHaveLength(1);
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });

  it("does NOT cache a degraded program — a rules-only plan must not pin the user", async () => {
    const ctx = await setup();

    try {
      await seedProfileAndLibrary(ctx);

      await ctx.app.inject({
        method: "POST",
        url: "/training/program:generate",
        headers: auth
      });

      expect(await ctx.database.prisma.generationCache.findMany()).toHaveLength(0);
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });
});

describe("GET /training/program/current + session/today (T2.5)", () => {
  it("404s before anything is generated, then serves the program and today's session", async () => {
    const ctx = await setup();

    try {
      await seedProfileAndLibrary(ctx);

      expect(
        (
          await ctx.app.inject({
            method: "GET",
            url: "/training/program/current",
            headers: auth
          })
        ).statusCode
      ).toBe(404);

      await ctx.app.inject({
        method: "POST",
        url: "/training/program:generate",
        headers: auth
      });

      const current = await ctx.app.inject({
        method: "GET",
        url: "/training/program/current",
        headers: auth
      });
      expect(current.statusCode).toBe(200);

      const today = await ctx.app.inject({
        method: "GET",
        url: "/training/session/today",
        headers: auth
      });
      expect(today.statusCode).toBe(200);

      const session = today.json() as {
        id: string;
        date: string;
        plannedItems: { exerciseId: string; targetSets: number; targetLoad: number | null }[];
        setLogs: unknown[];
      };

      // The block starts today, so day 1 of week 1 is scheduled for today (R1).
      expect(session.date).toBe(todayInTimezone("UTC").toISOString());
      expect(session.plannedItems.length).toBeGreaterThanOrEqual(3);
      expect(session.setLogs).toEqual([]);
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });
});

describe("POST /training/session/{id}/log (T2.5, T2.6)", () => {
  async function generateAndGetToday(ctx: Ctx) {
    await ctx.app.inject({
      method: "POST",
      url: "/training/program:generate",
      headers: auth
    });

    const today = await ctx.app.inject({
      method: "GET",
      url: "/training/session/today",
      headers: auth
    });

    return today.json() as {
      id: string;
      label: string | null;
      plannedItems: { exerciseId: string; repRange: string; targetLoad: number | null }[];
    };
  }

  /**
   * The next occurrence of the SAME session (same split label) — which is what
   * progression rolls forward into. The chronologically-next planned row is a
   * different day of the split and trains different movements.
   */
  async function nextOccurrence(ctx: Ctx, label: string | null) {
    return ctx.database.prisma.workoutSession.findFirst({
      where: { status: "planned", label },
      orderBy: { date: "asc" }
    });
  }

  it("persists logged sets and shows them on revisit", async () => {
    const ctx = await setup();

    try {
      await seedProfileAndLibrary(ctx, { baselines: true });
      const session = await generateAndGetToday(ctx);
      const first = session.plannedItems[0]!;

      const response = await ctx.app.inject({
        method: "POST",
        url: `/training/session/${session.id}/log`,
        headers: auth,
        payload: {
          status: "completed",
          sets: [
            { exerciseId: first.exerciseId, setNo: 1, reps: 8, weight: 60, rpe: 8 },
            { exerciseId: first.exerciseId, setNo: 2, reps: 8, weight: 60, rpe: 8 }
          ]
        }
      });

      expect(response.statusCode).toBe(200);
      expect((response.json() as { setLogs: unknown[] }).setLogs).toHaveLength(2);
      expect((response.json() as { status: string }).status).toBe("completed");

      // Revisiting shows the same logged sets.
      const revisit = await ctx.app.inject({
        method: "GET",
        url: "/training/session/today",
        headers: auth
      });
      expect((revisit.json() as { setLogs: unknown[] }).setLogs).toHaveLength(2);
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });

  it("is idempotent when an offline create is replayed with the same clientId (T0.11)", async () => {
    const ctx = await setup();

    try {
      await seedProfileAndLibrary(ctx, { baselines: true });
      const session = await generateAndGetToday(ctx);
      const first = session.plannedItems[0]!;

      const payload = {
        sets: [
          {
            exerciseId: first.exerciseId,
            setNo: 1,
            reps: 8,
            weight: 60,
            clientId: "device-set-1"
          }
        ]
      };

      await ctx.app.inject({
        method: "POST",
        url: `/training/session/${session.id}/log`,
        headers: auth,
        payload
      });

      const replay = await ctx.app.inject({
        method: "POST",
        url: `/training/session/${session.id}/log`,
        headers: auth,
        payload
      });

      // Replayed, not duplicated.
      expect((replay.json() as { setLogs: unknown[] }).setLogs).toHaveLength(1);
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });

  it("raises the NEXT session's target after an easy session (T2.6 AC)", async () => {
    const ctx = await setup();

    try {
      await seedProfileAndLibrary(ctx, { baselines: true });
      const session = await generateAndGetToday(ctx);
      const first = session.plannedItems[0]!;

      const [repMin, repMax] = first.repRange.split("-").map(Number) as [number, number];
      const startingLoad = first.targetLoad ?? 60;

      // Hit the TOP of the rep range on every set — the trigger for adding load.
      await ctx.app.inject({
        method: "POST",
        url: `/training/session/${session.id}/log`,
        headers: auth,
        payload: {
          sets: [1, 2, 3].map((setNo) => ({
            exerciseId: first.exerciseId,
            setNo,
            reps: repMax,
            weight: startingLoad,
            rpe: 7
          }))
        }
      });

      // The next occurrence of this session now prescribes MORE weight.
      const next = await nextOccurrence(ctx, session.label);

      const nextItems = JSON.parse(next?.plannedItems ?? "[]") as {
        exerciseId: string;
        targetLoad: number | null;
      }[];

      const progressed = nextItems.find(
        (item) => item.exerciseId === first.exerciseId
      );

      expect(progressed?.targetLoad).toBeGreaterThan(startingLoad);
      // …and the reason is recorded for the "why is my target this?" drill-down.
      expect(next?.coachingNote).toContain("rep range");
      expect(repMin).toBeLessThan(repMax);
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });

  it("holds the target after a missed session", async () => {
    const ctx = await setup();

    try {
      await seedProfileAndLibrary(ctx, { baselines: true });
      const session = await generateAndGetToday(ctx);
      const first = session.plannedItems[0]!;
      const startingLoad = first.targetLoad ?? 60;

      await ctx.app.inject({
        method: "POST",
        url: `/training/session/${session.id}/log`,
        headers: auth,
        payload: {
          sets: [{ exerciseId: first.exerciseId, setNo: 1, reps: 1, weight: startingLoad }]
        }
      });

      const next = await nextOccurrence(ctx, session.label);

      const nextItems = JSON.parse(next?.plannedItems ?? "[]") as {
        exerciseId: string;
        targetLoad: number | null;
      }[];

      expect(
        nextItems.find((item) => item.exerciseId === first.exerciseId)?.targetLoad
      ).toBeLessThanOrEqual(startingLoad);
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });

  it("404s for an unknown session and 422s on a malformed body", async () => {
    const ctx = await setup();

    try {
      await seedProfileAndLibrary(ctx);

      expect(
        (
          await ctx.app.inject({
            method: "POST",
            url: "/training/session/nope/log",
            headers: auth,
            payload: { sets: [] }
          })
        ).statusCode
      ).toBe(404);

      expect(
        (
          await ctx.app.inject({
            method: "POST",
            url: "/training/session/nope/log",
            headers: auth,
            payload: { sets: [{ exerciseId: "x" }] }
          })
        ).statusCode
      ).toBe(422);
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });
});

describe("POST /training/session/{id}/feedback (T2.6)", () => {
  it("parses free text into a structured signal", async () => {
    const ctx = await setup();

    try {
      await seedProfileAndLibrary(ctx);
      await ctx.app.inject({
        method: "POST",
        url: "/training/program:generate",
        headers: auth
      });

      const today = await ctx.app.inject({
        method: "GET",
        url: "/training/session/today",
        headers: auth
      });
      const sessionId = (today.json() as { id: string }).id;

      const response = await ctx.app.inject({
        method: "POST",
        url: `/training/session/${sessionId}/feedback`,
        headers: auth,
        payload: { freeText: "that felt easy" }
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        domain: "training",
        refType: "session",
        refId: sessionId,
        status: "parsed",
        structured: { felt: "easy" }
      });
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });

  it("stores an unparseable note as raw rather than pretending it means nothing", async () => {
    const ctx = await setup();

    try {
      await seedProfileAndLibrary(ctx);
      await ctx.app.inject({
        method: "POST",
        url: "/training/program:generate",
        headers: auth
      });
      const today = await ctx.app.inject({
        method: "GET",
        url: "/training/session/today",
        headers: auth
      });
      const sessionId = (today.json() as { id: string }).id;

      const response = await ctx.app.inject({
        method: "POST",
        url: `/training/session/${sessionId}/feedback`,
        headers: auth,
        payload: { freeText: "did the thing" }
      });

      expect(response.json()).toMatchObject({ status: "raw", structured: null });
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });

  it("an injury note removes the offending pattern from the NEXT generation (T2.6 AC)", async () => {
    const ctx = await setup();

    try {
      await seedProfileAndLibrary(ctx, { baselines: true });

      await ctx.app.inject({
        method: "POST",
        url: "/training/program:generate",
        headers: auth
      });

      const before = await ctx.database.prisma.program.findFirst({
        where: { status: "active" }
      });
      const beforeConstraints = JSON.parse(before?.inputConstraints ?? "{}") as {
        allowedExercises: { pattern: string }[];
      };
      expect(
        beforeConstraints.allowedExercises.some(
          (exercise) => exercise.pattern === "squat"
        )
      ).toBe(true);

      const today = await ctx.app.inject({
        method: "GET",
        url: "/training/session/today",
        headers: auth
      });

      await ctx.app.inject({
        method: "POST",
        url: `/training/session/${(today.json() as { id: string }).id}/feedback`,
        headers: auth,
        payload: { freeText: "my knee hurt badly on squats" }
      });

      await ctx.app.inject({
        method: "POST",
        url: "/training/program:generate",
        headers: auth
      });

      const after = await ctx.database.prisma.program.findFirst({
        where: { status: "active" },
        orderBy: { createdAt: "desc" }
      });
      const afterConstraints = JSON.parse(after?.inputConstraints ?? "{}") as {
        excludedPatterns: string[];
        allowedExercises: { pattern: string }[];
      };

      expect(afterConstraints.excludedPatterns).toEqual(
        expect.arrayContaining(["squat", "single_leg", "knee_flexion"])
      );
      // The movements are physically gone, not merely discouraged.
      for (const exercise of afterConstraints.allowedExercises) {
        expect(["squat", "single_leg", "knee_flexion"]).not.toContain(exercise.pattern);
      }
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });
});

describe("GET /training/progress (T2.7)", () => {
  it("returns an empty series before anything is logged", async () => {
    const ctx = await setup();

    try {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/training/progress?metric=volume",
        headers: auth
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ metric: "volume", points: [] });
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });

  it("computes tonnage, est-1RM and bodyweight from logged data", async () => {
    const ctx = await setup();

    try {
      await seedProfileAndLibrary(ctx, { baselines: true });

      await ctx.app.inject({
        method: "POST",
        url: "/training/program:generate",
        headers: auth
      });
      const today = await ctx.app.inject({
        method: "GET",
        url: "/training/session/today",
        headers: auth
      });
      const session = today.json() as {
        id: string;
        plannedItems: { exerciseId: string }[];
      };
      const exerciseId = session.plannedItems[0]!.exerciseId;

      await ctx.app.inject({
        method: "POST",
        url: `/training/session/${session.id}/log`,
        headers: auth,
        payload: {
          sets: [
            { exerciseId, setNo: 1, reps: 10, weight: 100 },
            { exerciseId, setNo: 2, reps: 5, weight: 120 }
          ]
        }
      });

      const volume = await ctx.app.inject({
        method: "GET",
        url: "/training/progress?metric=volume",
        headers: auth
      });
      // Tonnage sums every set: 10×100 + 5×120 = 1600.
      expect((volume.json() as { points: { value: number }[] }).points[0]?.value).toBe(
        1600
      );

      const est1rm = await ctx.app.inject({
        method: "GET",
        url: `/training/progress?metric=est1rm&exerciseId=${exerciseId}`,
        headers: auth
      });
      // The day's BEST estimate, not a sum: 120 × (1 + 5/30) = 140.
      expect((est1rm.json() as { points: { value: number }[] }).points[0]?.value).toBe(
        140
      );

      await ctx.database.prisma.bodyMetric.create({
        data: { date: new Date("2026-07-01T00:00:00.000Z"), weightKg: 79.5 }
      });

      const bodyweight = await ctx.app.inject({
        method: "GET",
        url: "/training/progress?metric=bodyweight",
        headers: auth
      });
      expect((bodyweight.json() as { points: { value: number }[] }).points).toEqual([
        { date: "2026-07-01T00:00:00.000Z", value: 79.5 }
      ]);
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });

  it("422s on an unknown metric", async () => {
    const ctx = await setup();

    try {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/training/progress?metric=vibes",
        headers: auth
      });
      expect(response.statusCode).toBe(422);
    } finally {
      await ctx.app.close();
      await ctx.database.cleanup();
    }
  });
});
