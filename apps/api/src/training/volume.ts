import type { Experience, GoalType, VolumeTarget } from "./types.js";

// ---------------------------------------------------------------------------
// Weekly set-volume landmarks per muscle group.
//
// The numbers are the widely-used MEV / MAV / MRV framing (minimum effective,
// maximum adaptive, maximum recoverable weekly sets), scaled by training age
// and then by goal. They are the validator's hard bounds: a generated week that
// under-doses a muscle below `min` or exceeds `max` is rejected and repaired.
//
// These are deliberately in ONE place — the rules layer computes them, the
// validator checks against them, and the eval harness asserts on them. There is
// no second table anywhere that could drift.
// ---------------------------------------------------------------------------

/** Every muscle the seeded library tags as a primary mover. */
export const TRACKED_MUSCLES = [
  "quads",
  "hamstrings",
  "glutes",
  "chest",
  "shoulders",
  "lats",
  "upper_back",
  "biceps",
  "triceps",
  "calves",
  "core"
] as const;

export type TrackedMuscle = (typeof TRACKED_MUSCLES)[number];

/** Base weekly sets by training age, before goal scaling. */
const BASE_BY_EXPERIENCE: Record<Experience, VolumeTarget> = {
  beginner: { min: 6, target: 10, max: 16 },
  intermediate: { min: 8, target: 14, max: 22 },
  advanced: { min: 10, target: 18, max: 26 }
};

/**
 * Goal scaling. Hypertrophy runs the most volume; strength trades volume for
 * intensity; a fat-loss phase pulls back slightly to protect recovery in a
 * deficit; general health sits lowest.
 */
const GOAL_SCALE: Record<GoalType, number> = {
  build_muscle: 1.15,
  get_stronger: 0.85,
  lose_fat: 0.9,
  general_health: 0.8
};

/**
 * Muscles that recover fast and tolerate more work (small arms/calves/core) vs
 * the big compound-driven groups that accumulate fatigue quickly.
 */
const MUSCLE_SCALE: Partial<Record<string, number>> = {
  biceps: 1.1,
  triceps: 1.1,
  calves: 1.2,
  core: 1.2,
  glutes: 0.9,
  hamstrings: 0.9
};

/**
 * Weekly set landmarks for every tracked muscle, given training age and goal.
 * `max` is additionally clamped by the safety envelope's per-muscle ceiling by
 * the caller, so this can never be the widest bound in the system.
 */
export function computeVolumeTargets(
  experience: Experience,
  goalType: GoalType,
  options: { multiplier?: number } = {}
): Record<string, VolumeTarget> {
  const base = BASE_BY_EXPERIENCE[experience];
  const scale = GOAL_SCALE[goalType] * (options.multiplier ?? 1);

  const out: Record<string, VolumeTarget> = {};

  for (const muscle of TRACKED_MUSCLES) {
    const muscleScale = MUSCLE_SCALE[muscle] ?? 1;

    // The muscle scale deliberately applies to `target` and `max` only, NOT to
    // `min`. Scaling the minimum up for small muscles (calves, arms, core)
    // pushes their MEV past what a fixed session-length budget can actually
    // deliver, which turns a perfectly good program into an unrepairable
    // validation failure. Minimum effective volume is about "is this muscle
    // trained at all"; the ceiling is where recovery capacity differs.
    out[muscle] = {
      min: Math.max(4, Math.round(base.min * scale)),
      target: Math.round(base.target * scale * muscleScale),
      max: Math.round(base.max * scale * muscleScale)
    };
  }

  return out;
}

/**
 * Which muscles a set on this exercise counts toward. Primary movers get a full
 * set; secondary movers get a half set (the standard "fractional volume"
 * convention) — otherwise a program full of compounds looks like it massively
 * over-doses every assisting muscle.
 */
export function volumeContribution(exercise: {
  primaryMuscles: string[];
  secondaryMuscles: string[];
}): Map<string, number> {
  const contribution = new Map<string, number>();

  for (const muscle of exercise.primaryMuscles) {
    contribution.set(muscle, (contribution.get(muscle) ?? 0) + 1);
  }

  for (const muscle of exercise.secondaryMuscles) {
    contribution.set(muscle, (contribution.get(muscle) ?? 0) + 0.5);
  }

  return contribution;
}

/** Ceiling on working sets for one exercise, shared by the tuner and the clamps. */
export const MAX_SETS_PER_EXERCISE = 6;

/**
 * The weekly-set floor that is actually ENFORCEABLE for a muscle in a given
 * program, as opposed to the textbook minimum.
 *
 * This distinction matters more than it looks. A 30-minute session fits ~3
 * exercises; four of those a week is 12 slots to spread across 11 muscles. The
 * textbook MEV for every muscle simply does not fit — demanding it would make
 * the constraints unsatisfiable, so the validator would reject every candidate
 * program including the deterministic fallback, and the user would get nothing.
 *
 * So the floor is conditioned on what the program actually committed to:
 *
 *   - No exercise trains this muscle as a PRIMARY mover → floor is 0. The
 *     program is not claiming to train it; that is a coverage question for the
 *     eval harness, not a dosing violation.
 *   - Otherwise the floor is the textbook minimum, capped at what the days that
 *     do train it can physically deliver (`days × MAX_SETS_PER_EXERCISE`).
 *
 * The resulting rule reads: "if you chose to train a muscle, dose it properly,
 * as far as the schedule allows." That is both meaningful and always reachable.
 */
export function effectiveMinimum(
  muscle: string,
  landmarkMin: number,
  days: { items: { exerciseId: string }[] }[],
  exercisesById: Map<string, { primaryMuscles: string[] }>
): number {
  const daysTrainingItPrimarily = days.filter((day) =>
    day.items.some((item) =>
      exercisesById.get(item.exerciseId)?.primaryMuscles.includes(muscle)
    )
  ).length;

  if (daysTrainingItPrimarily === 0) {
    return 0;
  }

  return Math.min(landmarkMin, daysTrainingItPrimarily * MAX_SETS_PER_EXERCISE);
}

/**
 * Total weekly sets per muscle for a full week of prescribed items. Only counts
 * muscles that are actually trained — an untouched muscle is absent from the
 * map rather than present as 0, so the caller can distinguish "not part of this
 * program" from "trained but under-dosed".
 */
export function weeklySetsByMuscle(
  days: { items: { exerciseId: string; targetSets: number }[] }[],
  exercisesById: Map<
    string,
    { primaryMuscles: string[]; secondaryMuscles: string[] }
  >
): Map<string, number> {
  const totals = new Map<string, number>();

  for (const day of days) {
    for (const item of day.items) {
      const exercise = exercisesById.get(item.exerciseId);
      if (!exercise) {
        continue;
      }

      for (const [muscle, weight] of volumeContribution(exercise)) {
        totals.set(muscle, (totals.get(muscle) ?? 0) + weight * item.targetSets);
      }
    }
  }

  return totals;
}
