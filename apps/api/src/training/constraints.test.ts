import { describe, expect, it } from "vitest";

import {
  computeTrainingConstraints,
  type ComputeTrainingConstraintsInput
} from "./constraints.js";
import { estimate1RM } from "./e1rm.js";
import { exerciseId, TEST_EXERCISES } from "./fixtures.js";
import { DEFAULT_SAFETY_ENVELOPE } from "./safety.js";
import type { Experience, GoalType } from "./types.js";

function build(
  overrides: {
    goal?: GoalType;
    experience?: Experience;
    daysPerWeek?: number;
    sessionMins?: number;
    equipment?: string[];
    injuries?: ComputeTrainingConstraintsInput["trainingProfile"]["injuries"];
    baselineLifts?: ComputeTrainingConstraintsInput["trainingProfile"]["baselineLifts"];
    weightKg?: number | null;
  } = {}
) {
  return computeTrainingConstraints({
    profile: { weightKg: overrides.weightKg === undefined ? 80 : overrides.weightKg },
    goal: { type: overrides.goal ?? "build_muscle" },
    trainingProfile: {
      experience: overrides.experience ?? "intermediate",
      daysPerWeek: overrides.daysPerWeek ?? 4,
      sessionMins: overrides.sessionMins ?? 60,
      equipment: overrides.equipment ?? ["full_gym"],
      injuries: overrides.injuries ?? [],
      baselineLifts: overrides.baselineLifts ?? []
    },
    exercises: TEST_EXERCISES
  });
}

describe("computeTrainingConstraints — goal / frequency combinations (T2.2)", () => {
  it("builds muscle on 4 days with an upper/lower split and hypertrophy rep range", () => {
    const constraints = build({ goal: "build_muscle", daysPerWeek: 4 });

    expect(constraints.split.name).toBe("Upper/Lower");
    expect(constraints.split.days).toHaveLength(4);
    expect(constraints.repRange).toEqual({ min: 6, max: 12 });
    // Labels must be unique — sessions are addressed by label by both the UI
    // and the generator.
    expect(new Set(constraints.split.days.map((day) => day.label)).size).toBe(4);
  });

  it("builds strength on 3 days with a full-body split and low reps", () => {
    const constraints = build({ goal: "get_stronger", daysPerWeek: 3 });

    expect(constraints.split.name).toBe("Full Body");
    expect(constraints.split.days).toHaveLength(3);
    expect(constraints.repRange).toEqual({ min: 3, max: 6 });
    // Strength trades volume for intensity, so it deloads sooner on a stall.
    expect(constraints.progressionScheme.deloadTrigger).toBe(2);
  });

  it("builds general health on 2 days with the lowest volume of any goal", () => {
    const health = build({ goal: "general_health", daysPerWeek: 2 });
    const muscle = build({ goal: "build_muscle", daysPerWeek: 2 });

    expect(health.split.days).toHaveLength(2);
    expect(health.repRange).toEqual({ min: 8, max: 15 });
    expect(health.weeklySetTargets.chest?.target).toBeLessThan(
      muscle.weeklySetTargets.chest?.target ?? 0
    );
  });

  it("scales volume up with training age", () => {
    const beginner = build({ experience: "beginner" }).weeklySetTargets.chest;
    const advanced = build({ experience: "advanced" }).weeklySetTargets.chest;

    expect(advanced?.target).toBeGreaterThan(beginner?.target ?? 0);
  });

  it("gives a 6-day lifter a push/pull/legs split", () => {
    const constraints = build({ daysPerWeek: 6 });
    expect(constraints.split.name).toBe("Push/Pull/Legs");
    expect(constraints.split.days).toHaveLength(6);
  });

  it("sizes the session from available minutes", () => {
    expect(build({ sessionMins: 30 }).itemsPerSession.max).toBeLessThan(
      build({ sessionMins: 90 }).itemsPerSession.max
    );
  });
});

describe("computeTrainingConstraints — hard exclusions (T2.2)", () => {
  it("removes every knee-loading pattern for a knee injury", () => {
    const constraints = build({ injuries: [{ area: "knee", avoidPatterns: [] }] });

    expect(constraints.excludedPatterns).toEqual(
      expect.arrayContaining(["squat", "single_leg", "knee_flexion"])
    );

    // The exclusion is structural: those movements are simply absent from the
    // menu the LLM sees, not merely discouraged.
    for (const exercise of constraints.allowedExercises) {
      expect(["squat", "single_leg", "knee_flexion"]).not.toContain(exercise.pattern);
    }
    expect(constraints.excludedExerciseIds).toContain(exerciseId("Back Squat"));
  });

  it("honours explicitly declared avoidPatterns over the area mapping", () => {
    const constraints = build({
      injuries: [{ area: "shoulder", avoidPatterns: ["vertical_push"] }]
    });

    expect(constraints.excludedPatterns).toEqual(["vertical_push"]);
    // Horizontal pushing is NOT excluded here — the user named the pattern.
    expect(
      constraints.allowedExercises.some(
        (exercise) => exercise.pattern === "horizontal_push"
      )
    ).toBe(true);
  });

  it("excludes an injured muscle as a primary mover but not as a secondary one", () => {
    const constraints = build({
      injuries: [{ area: "hamstrings", avoidPatterns: ["nothing_real"] }]
    });

    const primaryHamstrings = constraints.allowedExercises.filter((exercise) =>
      exercise.primaryMuscles.includes("hamstrings")
    );
    expect(primaryHamstrings).toHaveLength(0);

    // Back Squat lists hamstrings only as a secondary mover, so it survives —
    // excluding secondaries too would empty the library for most niggles.
    expect(
      constraints.allowedExercises.some((exercise) => exercise.name === "Back Squat")
    ).toBe(true);
  });

  it("filters to owned equipment and always keeps bodyweight available", () => {
    const constraints = build({ equipment: ["dumbbell"] });

    for (const exercise of constraints.allowedExercises) {
      for (const item of exercise.equipment) {
        expect(["dumbbell", "bodyweight"]).toContain(item);
      }
    }

    expect(
      constraints.allowedExercises.some((exercise) => exercise.name === "Push-Up")
    ).toBe(true);
    expect(
      constraints.allowedExercises.some((exercise) => exercise.name === "Bench Press")
    ).toBe(false);
  });

  it("treats the 'dumbbells' plural as the same kit as 'dumbbell'", () => {
    const plural = build({ equipment: ["dumbbells"] });
    const singular = build({ equipment: ["dumbbell"] });

    expect(plural.allowedExercises.map((exercise) => exercise.id)).toEqual(
      singular.allowedExercises.map((exercise) => exercise.id)
    );
  });

  it("caps exercise difficulty at the lifter's training age", () => {
    const beginner = build({ experience: "beginner" });

    for (const exercise of beginner.allowedExercises) {
      expect(exercise.difficulty).toBe("beginner");
    }

    const advanced = build({ experience: "advanced" });
    expect(
      advanced.allowedExercises.some((exercise) => exercise.difficulty === "advanced")
    ).toBe(true);
  });
});

describe("computeTrainingConstraints — cold start (R9)", () => {
  it("seeds working loads from baseline lifts and skips the calibration week", () => {
    const constraints = build({
      goal: "build_muscle",
      baselineLifts: [
        { pattern: "squat", estWeight: 100, estReps: 5 },
        { pattern: "horizontal_push", estWeight: 80, estReps: 5 }
      ]
    });

    expect(constraints.calibrationWeeks).toBe(0);

    const squat = constraints.seedLoads.find(
      (seed) => seed.exerciseId === exerciseId("Back Squat")
    );

    expect(squat?.source).toBe("baseline");
    // Epley on 100 kg x 5 → ~116.67 kg estimated 1RM.
    expect(squat?.est1RM).toBeCloseTo(estimate1RM(100, 5) ?? 0, 2);
    // The working load targets the middle of the 6-12 rep band, so it sits
    // meaningfully below the 1RM but above nothing.
    expect(squat?.targetLoad).toBeGreaterThan(0);
    expect(squat?.targetLoad).toBeLessThan(squat?.est1RM ?? 0);
  });

  it("applies a pattern baseline to every exercise sharing that pattern", () => {
    const constraints = build({
      baselineLifts: [{ pattern: "squat", estWeight: 100, estReps: 5 }]
    });

    const goblet = constraints.seedLoads.find(
      (seed) => seed.exerciseId === exerciseId("Goblet Squat")
    );

    expect(goblet?.source).toBe("baseline");
  });

  it("prefers an exercise-specific baseline over the pattern one", () => {
    const constraints = build({
      baselineLifts: [
        { pattern: "squat", estWeight: 60, estReps: 5 },
        { exerciseId: exerciseId("Back Squat"), estWeight: 140, estReps: 5 }
      ]
    });

    const backSquat = constraints.seedLoads.find(
      (seed) => seed.exerciseId === exerciseId("Back Squat")
    );
    const gobletSquat = constraints.seedLoads.find(
      (seed) => seed.exerciseId === exerciseId("Goblet Squat")
    );

    expect(backSquat?.est1RM).toBeCloseTo(estimate1RM(140, 5) ?? 0, 2);
    expect(gobletSquat?.est1RM).toBeCloseTo(estimate1RM(60, 5) ?? 0, 2);
  });

  it("emits a calibration week with conservative %-bodyweight loads when no baseline exists", () => {
    const constraints = build({ baselineLifts: [], weightKg: 80 });

    expect(constraints.calibrationWeeks).toBe(1);
    expect(constraints.seedLoads.every((seed) => seed.source === "calibration")).toBe(
      true
    );

    const squat = constraints.seedLoads.find(
      (seed) => seed.exerciseId === exerciseId("Back Squat")
    );

    // 50% of an 80 kg bodyweight, rounded down to a loadable 2.5 kg step.
    expect(squat?.targetLoad).toBe(40);
    expect(squat?.est1RM).toBeNull();
  });

  it("still produces usable calibration loads with no bodyweight on file", () => {
    const constraints = build({ baselineLifts: [], weightKg: null });

    expect(constraints.calibrationWeeks).toBe(1);
    const squat = constraints.seedLoads.find(
      (seed) => seed.exerciseId === exerciseId("Back Squat")
    );
    // Falls back to an assumed 75 kg rather than emitting a null/zero target.
    expect(squat?.targetLoad).toBeGreaterThan(0);
  });

  it("ignores a malformed baseline entry rather than rejecting the profile", () => {
    const constraints = build({
      baselineLifts: [
        { pattern: "squat", estWeight: 0, estReps: 5 },
        { pattern: "horizontal_push", estWeight: 80, estReps: 5 }
      ]
    });

    const squat = constraints.seedLoads.find(
      (seed) => seed.exerciseId === exerciseId("Back Squat")
    );
    const bench = constraints.seedLoads.find(
      (seed) => seed.exerciseId === exerciseId("Bench Press")
    );

    expect(squat?.source).toBe("calibration");
    expect(bench?.source).toBe("baseline");
  });
});

describe("computeTrainingConstraints — purity and safety", () => {
  it("is pure: identical inputs produce identical output", () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it("never lets goal scaling exceed the per-muscle safety ceiling", () => {
    const constraints = build({ goal: "build_muscle", experience: "advanced" });

    for (const target of Object.values(constraints.weeklySetTargets)) {
      expect(target.max).toBeLessThanOrEqual(
        DEFAULT_SAFETY_ENVELOPE.maxWeeklySetsPerMuscle
      );
      expect(target.min).toBeLessThanOrEqual(target.max);
    }
  });

  it("keeps the RPE band inside the safety envelope", () => {
    const constraints = build();
    expect(constraints.rpeRange.max).toBeLessThanOrEqual(DEFAULT_SAFETY_ENVELOPE.maxRpe);
  });
});
