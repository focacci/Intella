import { describe, expect, it } from "vitest";

import { computeTrainingConstraints } from "./constraints.js";
import { exerciseId, TEST_EXERCISES } from "./fixtures.js";
import { PROGRAM_SCHEMA_VERSION } from "./program-schema.js";
import { buildSeedProgram } from "./seed-program.js";
import type { GeneratedProgram, TrainingConstraints } from "./types.js";
import { checkLoadJumps, validateProgram, volumeShortfalls } from "./validate.js";

function constraintsFor(
  overrides: {
    injuries?: { area: string; avoidPatterns?: string[] }[];
    daysPerWeek?: number;
    baselineLifts?: { pattern: string; estWeight: number; estReps: number }[];
  } = {}
): TrainingConstraints {
  return computeTrainingConstraints({
    profile: { weightKg: 80 },
    goal: { type: "build_muscle" },
    trainingProfile: {
      experience: "intermediate",
      daysPerWeek: overrides.daysPerWeek ?? 4,
      sessionMins: 60,
      equipment: ["full_gym"],
      injuries: overrides.injuries ?? [],
      baselineLifts: overrides.baselineLifts ?? []
    },
    exercises: TEST_EXERCISES
  });
}

/** A known-good program to mutate into each specific failure mode. */
function validProgram(constraints: TrainingConstraints): GeneratedProgram {
  return buildSeedProgram(constraints);
}

function violationRules(
  raw: unknown,
  constraints: TrainingConstraints
): string[] {
  const result = validateProgram(raw, constraints);
  return result.ok ? [] : result.violations.map((violation) => violation.rule);
}

describe("validator — accepts a well-formed program (T2.4)", () => {
  it("passes the deterministic seed and returns resolved planned items", () => {
    const constraints = constraintsFor();
    const result = validateProgram(validProgram(constraints), constraints);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.days).toHaveLength(4);

    const firstItem = result.days[0]?.items[0];
    // Names are resolved from the library, not trusted from the model.
    expect(firstItem?.exerciseName).toBeTruthy();
    expect(firstItem?.repRange).toMatch(/^\d+-\d+$/);
  });
});

describe("validator — contrived bad output is caught (T2.4)", () => {
  it("rejects an exercise that is not on the allowed menu", () => {
    const constraints = constraintsFor();
    const program = validProgram(constraints);
    program.days[0]!.items[0]!.exerciseId = "ex-totally-made-up";

    expect(violationRules(program, constraints)).toContain("exercise_not_allowed");
  });

  it("rejects a contraindicated exercise for an injured lifter", () => {
    // The model tries to prescribe a Back Squat to someone with a bad knee.
    const constraints = constraintsFor({ injuries: [{ area: "knee" }] });
    const program = validProgram(constraints);
    program.days[0]!.items[0]!.exerciseId = exerciseId("Back Squat");

    const result = validateProgram(program, constraints);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    // Caught by the allowed-menu check, because the injury filter already
    // removed it — that is the whole point of filtering in the rules layer.
    expect(result.violations.map((violation) => violation.rule)).toContain(
      "exercise_not_allowed"
    );
  });

  it("rejects a program with the wrong number of days", () => {
    const constraints = constraintsFor();
    const program = validProgram(constraints);
    program.days.pop();

    expect(violationRules(program, constraints)).toContain("day_count");
  });

  it("rejects a program whose day labels do not match the split", () => {
    const constraints = constraintsFor();
    const program = validProgram(constraints);
    program.days[0]!.label = "Leg Day (invented)";

    expect(violationRules(program, constraints)).toContain("day_label");
  });

  it("rejects rep ranges outside the prescribed band", () => {
    const constraints = constraintsFor();
    const program = validProgram(constraints);
    // A 6-12 hypertrophy block asked for; the model prescribes sets of 30.
    program.days[0]!.items[0]!.repMin = 25;
    program.days[0]!.items[0]!.repMax = 30;

    expect(violationRules(program, constraints)).toContain("rep_range_outside_band");
  });

  it("rejects an inverted rep range", () => {
    const constraints = constraintsFor();
    const program = validProgram(constraints);
    program.days[0]!.items[0]!.repMin = 12;
    program.days[0]!.items[0]!.repMax = 6;

    expect(violationRules(program, constraints)).toContain("rep_range_inverted");
  });

  it("rejects weekly volume above the recoverable maximum", () => {
    const constraints = constraintsFor();
    const program = validProgram(constraints);

    for (const day of program.days) {
      for (const item of day.items) {
        item.targetSets = 10;
      }
    }

    expect(violationRules(program, constraints)).toContain("volume_above_landmark");
  });

  it("rejects a session that could not fit in the available time", () => {
    const constraints = constraintsFor();
    const program = validProgram(constraints);

    const extra = constraints.allowedExercises.slice(0, 12);
    program.days[0]!.items = extra.map((exercise) => ({
      exerciseId: exercise.id,
      targetSets: 1,
      repMin: constraints.repRange.min,
      repMax: constraints.repRange.max,
      rpe: 8
    }));

    expect(violationRules(program, constraints)).toContain("session_too_long");
  });

  it("rejects a session with too few exercises", () => {
    const constraints = constraintsFor();
    const program = validProgram(constraints);
    program.days[0]!.items = program.days[0]!.items.slice(0, 1);

    expect(violationRules(program, constraints)).toContain("session_too_short");
  });

  it("rejects structurally malformed output at the schema boundary", () => {
    const constraints = constraintsFor();

    expect(violationRules({ nonsense: true }, constraints)).toContain("schema");
    expect(violationRules(null, constraints)).toContain("schema");
    expect(violationRules({ schemaVersion: 1, days: [] }, constraints)).toContain(
      "schema"
    );
  });

  it("reports every distinct problem at once so one repair round can fix them all", () => {
    const constraints = constraintsFor();
    const program = validProgram(constraints);
    program.days[0]!.label = "Wrong";
    program.days[1]!.items[0]!.exerciseId = "ex-nope";

    const rules = violationRules(program, constraints);
    expect(rules).toContain("day_label");
    expect(rules).toContain("exercise_not_allowed");
  });

  it("de-duplicates identical violations", () => {
    const constraints = constraintsFor();
    const program = validProgram(constraints);

    for (const day of program.days) {
      day.items[0]!.exerciseId = "ex-nope";
    }

    const result = validateProgram(program, constraints);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    const notAllowed = result.violations.filter(
      (violation) => violation.rule === "exercise_not_allowed"
    );
    expect(notAllowed).toHaveLength(1);
  });
});

describe("validator — clamps rather than rejects where correction is safe", () => {
  it("clamps an over-the-cap RPE instead of burning a repair round", () => {
    const constraints = constraintsFor({
      baselineLifts: [{ pattern: "squat", estWeight: 100, estReps: 5 }]
    });
    const program = validProgram(constraints);

    for (const day of program.days) {
      for (const item of day.items) {
        item.rpe = 10;
      }
    }

    const result = validateProgram(program, constraints);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    for (const day of result.days) {
      for (const item of day.items) {
        expect(item.rpe).toBeLessThanOrEqual(constraints.safety.maxRpe);
      }
    }
  });

  it("caps every prescribed load at the %-of-1RM ceiling", () => {
    const constraints = constraintsFor({
      baselineLifts: [{ pattern: "squat", estWeight: 100, estReps: 5 }]
    });

    const result = validateProgram(validProgram(constraints), constraints);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    for (const day of result.days) {
      for (const item of day.items) {
        const seed = constraints.seedLoads.find(
          (entry) => entry.exerciseId === item.exerciseId
        );

        if (seed?.est1RM && item.targetLoad) {
          expect(item.targetLoad).toBeLessThanOrEqual(
            seed.est1RM * constraints.safety.maxPctOf1RM
          );
        }
      }
    }
  });
});

describe("validator — load-jump cap at progression time (T2.10)", () => {
  it("flags a jump above the cap and passes one at the boundary", () => {
    const constraints = constraintsFor();
    const items = [
      {
        exerciseId: exerciseId("Back Squat"),
        exerciseName: "Back Squat",
        targetSets: 3,
        repRange: "6-12",
        targetLoad: 60,
        rpe: 8
      }
    ];

    // 50 → 60 is +20%, well past the 10% cap.
    expect(
      checkLoadJumps(items, new Map([[exerciseId("Back Squat"), 50]]), constraints)
    ).toHaveLength(1);

    // 55 is exactly the cap from 50 — allowed.
    items[0]!.targetLoad = 55;
    expect(
      checkLoadJumps(items, new Map([[exerciseId("Back Squat"), 50]]), constraints)
    ).toHaveLength(0);

    // No history to jump from — nothing to flag.
    expect(checkLoadJumps(items, new Map(), constraints)).toHaveLength(0);
  });
});

describe("volume shortfalls are reported, not enforced", () => {
  it("returns an empty list for a well-dosed program", () => {
    const constraints = constraintsFor();
    const result = validateProgram(validProgram(constraints), constraints);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // The seed tuner targets the same floors, so a full-gym 4-day block should
    // have no shortfall at all.
    expect(volumeShortfalls(result.days, constraints)).toEqual([]);
  });

  it("reports under-dosing without turning it into a validation failure", () => {
    const constraints = constraintsFor();
    const program = validProgram(constraints);

    for (const day of program.days) {
      for (const item of day.items) {
        item.targetSets = 1;
      }
    }

    const result = validateProgram(program, constraints);
    // Still VALID — under-dosing is a quality signal, not a safety violation.
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(volumeShortfalls(result.days, constraints).length).toBeGreaterThan(0);
  });
});

describe("validator — schema version", () => {
  it("accepts the published schema version", () => {
    const constraints = constraintsFor();
    const program = validProgram(constraints);
    expect(program.schemaVersion).toBe(PROGRAM_SCHEMA_VERSION);
    expect(validateProgram(program, constraints).ok).toBe(true);
  });
});
