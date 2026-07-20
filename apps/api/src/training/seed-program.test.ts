import { describe, expect, it } from "vitest";

import { computeTrainingConstraints } from "./constraints.js";
import { TEST_EXERCISES } from "./fixtures.js";
import { buildSeedProgram } from "./seed-program.js";
import type { Experience, GoalType, TrainingConstraints } from "./types.js";
import { validateProgram } from "./validate.js";

// ---------------------------------------------------------------------------
// The R18 guarantee, stated as a property:
//
//   For every profile the app can produce, the deterministic seed program
//   passes the SAME validator the LLM output must pass.
//
// If this ever fails, the degraded path is broken — which means a user with no
// API key, no budget, or an unreachable Anthropic gets nothing. That is the
// single worst failure mode in the app, so it is tested across the full matrix
// rather than on one happy-path example.
// ---------------------------------------------------------------------------

const GOALS: GoalType[] = [
  "build_muscle",
  "lose_fat",
  "get_stronger",
  "general_health"
];
const EXPERIENCES: Experience[] = ["beginner", "intermediate", "advanced"];
const FREQUENCIES = [1, 2, 3, 4, 5, 6, 7];
const EQUIPMENT_SETS = [
  ["full_gym"],
  ["dumbbell", "bench"],
  ["bodyweight"],
  ["barbell", "rack", "bench"],
  ["bands", "bodyweight"]
];
const SESSION_LENGTHS = [30, 45, 60, 90];

function constraintsFor(options: {
  goal: GoalType;
  experience: Experience;
  daysPerWeek: number;
  equipment: string[];
  sessionMins: number;
  injuries?: { area: string; avoidPatterns?: string[] }[];
  baselineLifts?: { pattern: string; estWeight: number; estReps: number }[];
}): TrainingConstraints {
  return computeTrainingConstraints({
    profile: { weightKg: 80 },
    goal: { type: options.goal },
    trainingProfile: {
      experience: options.experience,
      daysPerWeek: options.daysPerWeek,
      sessionMins: options.sessionMins,
      equipment: options.equipment,
      injuries: options.injuries ?? [],
      baselineLifts: options.baselineLifts ?? []
    },
    exercises: TEST_EXERCISES
  });
}

describe("seed program (R18) — the degraded path always produces a valid program", () => {
  it("validates across every goal × frequency × experience combination", () => {
    const failures: string[] = [];

    for (const goal of GOALS) {
      for (const experience of EXPERIENCES) {
        for (const daysPerWeek of FREQUENCIES) {
          const constraints = constraintsFor({
            goal,
            experience,
            daysPerWeek,
            equipment: ["full_gym"],
            sessionMins: 60
          });

          const result = validateProgram(buildSeedProgram(constraints), constraints);

          if (!result.ok) {
            failures.push(
              `${goal}/${experience}/${daysPerWeek}d → ` +
                result.violations.map((violation) => violation.rule).join(", ")
            );
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("validates across every equipment set and session length", () => {
    const failures: string[] = [];

    for (const equipment of EQUIPMENT_SETS) {
      for (const sessionMins of SESSION_LENGTHS) {
        for (const daysPerWeek of [3, 4, 6]) {
          const constraints = constraintsFor({
            goal: "build_muscle",
            experience: "intermediate",
            daysPerWeek,
            equipment,
            sessionMins
          });

          const result = validateProgram(buildSeedProgram(constraints), constraints);

          if (!result.ok) {
            failures.push(
              `${equipment.join("+")}/${sessionMins}min/${daysPerWeek}d → ` +
                result.violations.map((violation) => violation.detail).join(" | ")
            );
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("validates with injuries removing whole movement patterns", () => {
    const injurySets = [
      [{ area: "knee" }],
      [{ area: "shoulder" }],
      [{ area: "lower back" }],
      [{ area: "knee" }, { area: "shoulder" }],
      [{ area: "elbow" }, { area: "hip" }]
    ];

    const failures: string[] = [];

    for (const injuries of injurySets) {
      for (const daysPerWeek of [3, 4, 6]) {
        const constraints = constraintsFor({
          goal: "build_muscle",
          experience: "intermediate",
          daysPerWeek,
          equipment: ["full_gym"],
          sessionMins: 60,
          injuries
        });

        const result = validateProgram(buildSeedProgram(constraints), constraints);

        if (!result.ok) {
          failures.push(
            `${injuries.map((injury) => injury.area).join("+")}/${daysPerWeek}d → ` +
              result.violations.map((violation) => violation.detail).join(" | ")
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });
});

describe("seed program — behaviour", () => {
  it("is deterministic: the same constraints always yield the same program", () => {
    const constraints = constraintsFor({
      goal: "build_muscle",
      experience: "intermediate",
      daysPerWeek: 4,
      equipment: ["full_gym"],
      sessionMins: 60
    });

    expect(JSON.stringify(buildSeedProgram(constraints))).toBe(
      JSON.stringify(buildSeedProgram(constraints))
    );
  });

  it("emits exactly one day per split day, with matching labels", () => {
    const constraints = constraintsFor({
      goal: "build_muscle",
      experience: "intermediate",
      daysPerWeek: 5,
      equipment: ["full_gym"],
      sessionMins: 60
    });

    const seed = buildSeedProgram(constraints);

    expect(seed.days.map((day) => day.label)).toEqual(
      constraints.split.days.map((day) => day.label)
    );
  });

  it("never selects an excluded exercise", () => {
    const constraints = constraintsFor({
      goal: "build_muscle",
      experience: "intermediate",
      daysPerWeek: 4,
      equipment: ["full_gym"],
      sessionMins: 60,
      injuries: [{ area: "knee" }]
    });

    const allowed = new Set(
      constraints.allowedExercises.map((exercise) => exercise.id)
    );
    const seed = buildSeedProgram(constraints);

    for (const day of seed.days) {
      for (const item of day.items) {
        expect(allowed.has(item.exerciseId)).toBe(true);
      }
    }
  });

  it("caps RPE at the calibration limit when there are no baseline lifts (R9)", () => {
    const constraints = constraintsFor({
      goal: "build_muscle",
      experience: "intermediate",
      daysPerWeek: 3,
      equipment: ["full_gym"],
      sessionMins: 60
    });

    expect(constraints.calibrationWeeks).toBe(1);

    for (const day of buildSeedProgram(constraints).days) {
      for (const item of day.items) {
        expect(item.rpe).toBeLessThanOrEqual(constraints.safety.calibrationRpeCap);
      }
      expect(day.coachingNote).toContain("calibration");
    }
  });

  it("uses the full RPE band once baseline lifts are known", () => {
    const constraints = constraintsFor({
      goal: "build_muscle",
      experience: "intermediate",
      daysPerWeek: 3,
      equipment: ["full_gym"],
      sessionMins: 60,
      baselineLifts: [{ pattern: "squat", estWeight: 100, estReps: 5 }]
    });

    expect(constraints.calibrationWeeks).toBe(0);

    const seed = buildSeedProgram(constraints);
    expect(seed.days[0]?.items[0]?.rpe).toBe(constraints.rpeRange.max);
  });
});
