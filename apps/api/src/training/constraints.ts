import { estimate1RM, loadForReps, round, roundToLoadable } from "./e1rm.js";
import { NEUTRAL_ADJUSTMENTS, patternsForArea } from "./feedback.js";
import { clampWorkingLoad, DEFAULT_SAFETY_ENVELOPE } from "./safety.js";
import { itemsPerSession, selectSplit } from "./splits.js";
import {
  CONSTRAINTS_VERSION,
  type AllowedExercise,
  type Experience,
  type FeedbackAdjustments,
  type GoalType,
  type MovementPattern,
  type ProgressionScheme,
  type SafetyEnvelope,
  type SeedLoad,
  type Split,
  type TrainingConstraints,
  type VolumeTarget
} from "./types.js";
import { computeVolumeTargets } from "./volume.js";

// ---------------------------------------------------------------------------
// The rules layer (T2.2).
//
// `computeTrainingConstraints` is PURE: profile + goal + training profile +
// exercise library + feedback in, a complete `TrainingConstraints` out. No
// database, no clock, no network — which is exactly why it can be exhaustively
// unit-tested, and why safety lives here rather than in the prompt.
//
// Everything the LLM is allowed to do is bounded by what this function emits:
// the split, the volume targets, the rep/RPE bands, the seed loads, and — most
// importantly — `allowedExercises`, which has already had injuries and missing
// equipment filtered out. An exercise that would load an injured joint is not
// "discouraged" in a prompt; it is absent from the menu.
// ---------------------------------------------------------------------------

/** Weeks in a generated mesocycle, by training age. */
const WEEKS_BY_EXPERIENCE: Record<Experience, number> = {
  beginner: 4,
  intermediate: 6,
  advanced: 6
};

/** Rep bands by goal. Strength work sits lower; hypertrophy mid; health higher. */
const REP_RANGE_BY_GOAL: Record<GoalType, { min: number; max: number }> = {
  get_stronger: { min: 3, max: 6 },
  build_muscle: { min: 6, max: 12 },
  lose_fat: { min: 8, max: 15 },
  general_health: { min: 8, max: 15 }
};

/** Working-set RPE bands by goal. */
const RPE_RANGE_BY_GOAL: Record<GoalType, { min: number; max: number }> = {
  get_stronger: { min: 7, max: 9 },
  build_muscle: { min: 7, max: 9 },
  lose_fat: { min: 6, max: 8 },
  general_health: { min: 6, max: 8 }
};

/**
 * Conservative week-1 loads for a user with no baseline lifts, as a fraction of
 * bodyweight (R9). These are deliberately LOW — the calibration week's job is to
 * discover the real number by ramping, and starting under is recoverable while
 * starting over is an injury.
 */
const CALIBRATION_BODYWEIGHT_FRACTION: Record<MovementPattern, number> = {
  squat: 0.5,
  hinge: 0.6,
  horizontal_push: 0.4,
  vertical_push: 0.25,
  horizontal_pull: 0.35,
  vertical_pull: 0.3,
  single_leg: 0.2,
  knee_flexion: 0.15,
  calf_raise: 0.3,
  elbow_flexion: 0.1,
  elbow_extension: 0.12,
  core: 0
};

/** Fallback bodyweight when the profile has none, so cold start still works (R18). */
const ASSUMED_BODYWEIGHT_KG = 75;

/** Dumbbell/machine work loads in 1 kg steps; barbell work in 2.5 kg. */
const BARBELL_EQUIPMENT = new Set(["barbell", "trap_bar", "rack"]);

export type ProfileInputs = {
  weightKg?: number | null;
  sex?: string | null;
};

export type GoalInputs = {
  type: GoalType;
};

export type InjuryInput = {
  area: string;
  note?: string | undefined;
  avoidPatterns?: string[] | undefined;
};

export type BaselineLiftInput = {
  pattern?: string | undefined;
  exerciseId?: string | undefined;
  estWeight: number;
  estReps: number;
};

export type TrainingProfileInputs = {
  experience: Experience;
  daysPerWeek: number;
  sessionMins: number;
  equipment: string[];
  injuries: InjuryInput[];
  baselineLifts: BaselineLiftInput[];
};

export type ComputeTrainingConstraintsInput = {
  profile: ProfileInputs | null;
  goal: GoalInputs;
  trainingProfile: TrainingProfileInputs;
  /** The full seeded library; filtering happens here. */
  exercises: AllowedExercise[];
  /** Distilled from recent `Feedback` rows. Defaults to neutral. */
  feedback?: FeedbackAdjustments;
  /** Operator overrides; may only TIGHTEN the shipped envelope. */
  safety?: SafetyEnvelope;
};

/**
 * The rules layer. Pure — same inputs always produce the same constraints,
 * which is what makes the R20b content hash meaningful.
 */
export function computeTrainingConstraints(
  input: ComputeTrainingConstraintsInput
): TrainingConstraints {
  const { goal, trainingProfile, exercises } = input;
  const feedback = input.feedback ?? NEUTRAL_ADJUSTMENTS;
  const safety = input.safety ?? DEFAULT_SAFETY_ENVELOPE;

  const equipment = normalizeEquipment(trainingProfile.equipment);

  // --- HARD constraints first ------------------------------------------------
  // Injuries and pain feedback can only ever ADD exclusions. They are resolved
  // before anything else so no later step can reintroduce a filtered movement.
  const excludedPatterns = collectExcludedPatterns(
    trainingProfile.injuries,
    feedback.avoidPatterns
  );
  const injuredAreas = trainingProfile.injuries.map((injury) =>
    injury.area.trim().toLowerCase()
  );

  const allowed = exercises.filter((exercise) =>
    isAllowed(exercise, {
      equipment,
      excludedPatterns,
      injuredAreas,
      experience: trainingProfile.experience
    })
  );

  const excludedExerciseIds = exercises
    .filter((exercise) => !allowed.some((candidate) => candidate.id === exercise.id))
    .map((exercise) => exercise.id)
    .sort();

  // --- Structure -------------------------------------------------------------
  const split = selectSplit(trainingProfile.daysPerWeek);
  const weeks = WEEKS_BY_EXPERIENCE[trainingProfile.experience];
  const repRange = REP_RANGE_BY_GOAL[goal.type];
  const rpeRange = clampRpeRange(RPE_RANGE_BY_GOAL[goal.type], safety);

  const weeklySetTargets = capVolumeTargets(
    computeVolumeTargets(trainingProfile.experience, goal.type, {
      multiplier: feedback.volumeMultiplier
    }),
    safety,
    { split, allowed }
  );

  // --- Cold start (R9) -------------------------------------------------------
  const seedLoads = computeSeedLoads({
    allowed,
    baselineLifts: trainingProfile.baselineLifts,
    bodyweightKg: input.profile?.weightKg ?? ASSUMED_BODYWEIGHT_KG,
    repRange,
    loadMultiplier: feedback.loadMultiplier,
    safety
  });

  // A calibration week is needed exactly when no baseline lift told us where to
  // start. With baselines present, week 1 is real training from day one.
  const hasUsableBaseline = seedLoads.some((seed) => seed.source === "baseline");
  const calibrationWeeks = hasUsableBaseline ? 0 : 1;

  return {
    version: CONSTRAINTS_VERSION,
    goalType: goal.type,
    experience: trainingProfile.experience,
    daysPerWeek: split.days.length,
    sessionMins: trainingProfile.sessionMins,
    weeks,
    calibrationWeeks,
    split,
    weeklySetTargets,
    repRange,
    rpeRange,
    progressionScheme: progressionFor(trainingProfile.experience, goal.type),
    allowedExercises: allowed,
    excludedPatterns,
    excludedExerciseIds,
    injuryNotes: trainingProfile.injuries
      .map((injury) => (injury.note ? `${injury.area}: ${injury.note}` : injury.area))
      .sort(),
    availableEquipment: equipment,
    seedLoads,
    safety,
    itemsPerSession: itemsPerSession(trainingProfile.sessionMins),
    feedbackAdjustments: feedback
  };
}

// ------------------------------------------------------------------ Filtering

/**
 * `full_gym` is a shorthand for "assume everything is available" — expand it so
 * downstream equipment checks are a plain subset test with no special cases.
 */
const FULL_GYM_EQUIPMENT = [
  "barbell",
  "rack",
  "bench",
  "dumbbell",
  "trap_bar",
  "kettlebell",
  "cable_machine",
  "machine",
  "pull_up_bar",
  "bands",
  "bodyweight"
];

function normalizeEquipment(equipment: string[]): string[] {
  const set = new Set<string>();

  for (const raw of equipment) {
    const item = raw.trim().toLowerCase();
    if (!item) {
      continue;
    }

    if (item === "full_gym") {
      for (const expanded of FULL_GYM_EQUIPMENT) {
        set.add(expanded);
      }
      continue;
    }

    // The seed library uses both "dumbbell" and "dumbbells" historically;
    // normalize to the singular so one spelling can't silently hide half the
    // library from a user who owns dumbbells.
    set.add(item === "dumbbells" ? "dumbbell" : item);
  }

  // Bodyweight is always available — you always have your body.
  set.add("bodyweight");

  return [...set].sort();
}

/**
 * Every pattern that must never appear, from BOTH declared injuries and pain
 * reported in feedback. An injury with explicit `avoidPatterns` uses them as
 * given; otherwise the area is mapped to its loading patterns.
 */
function collectExcludedPatterns(
  injuries: InjuryInput[],
  feedbackAvoid: MovementPattern[]
): MovementPattern[] {
  const excluded = new Set<MovementPattern>(feedbackAvoid);

  for (const injury of injuries) {
    const explicit = injury.avoidPatterns ?? [];

    if (explicit.length > 0) {
      for (const pattern of explicit) {
        excluded.add(pattern.trim().toLowerCase());
      }
      continue;
    }

    for (const pattern of patternsForArea(injury.area)) {
      excluded.add(pattern);
    }
  }

  return [...excluded].sort();
}

function isAllowed(
  exercise: AllowedExercise,
  context: {
    equipment: string[];
    excludedPatterns: MovementPattern[];
    injuredAreas: string[];
    experience: Experience;
  }
): boolean {
  if (context.excludedPatterns.includes(exercise.pattern)) {
    return false;
  }

  // Every piece of kit the movement needs must be on hand.
  const owned = new Set(context.equipment);
  const needed = exercise.equipment.map((item) =>
    item === "dumbbells" ? "dumbbell" : item
  );
  if (!needed.every((item) => owned.has(item))) {
    return false;
  }

  // An injured area is excluded as a PRIMARY mover. Secondary involvement is
  // allowed — excluding it too would empty the library for something like a
  // shoulder niggle, which every upper-body press touches.
  if (
    exercise.primaryMuscles.some((muscle) =>
      context.injuredAreas.includes(muscle.trim().toLowerCase())
    )
  ) {
    return false;
  }

  return difficultyAllowed(exercise.difficulty, context.experience);
}

/** A beginner gets beginner movements; an advanced lifter gets the whole library. */
function difficultyAllowed(difficulty: Experience, experience: Experience): boolean {
  const rank: Record<Experience, number> = {
    beginner: 0,
    intermediate: 1,
    advanced: 2
  };
  return rank[difficulty] <= rank[experience];
}

// ------------------------------------------------------------------ Progression

function progressionFor(
  experience: Experience,
  goalType: GoalType
): ProgressionScheme {
  // Beginners can add load every session; advanced lifters need smaller steps
  // and more patience before a stall counts as a real stall.
  const beginner = experience === "beginner";
  const strength = goalType === "get_stronger";

  return {
    rule: "double_progression",
    incrementUpperKg: beginner ? 2.5 : 1.25,
    incrementLowerKg: beginner ? 5 : 2.5,
    deloadTrigger: strength ? 2 : 3,
    deloadPct: 0.1
  };
}

// ------------------------------------------------------------------ Seed loads

function computeSeedLoads(input: {
  allowed: AllowedExercise[];
  baselineLifts: BaselineLiftInput[];
  bodyweightKg: number;
  repRange: { min: number; max: number };
  loadMultiplier: number;
  safety: SafetyEnvelope;
}): SeedLoad[] {
  const { allowed, baselineLifts, repRange, loadMultiplier, safety } = input;
  const bodyweightKg =
    Number.isFinite(input.bodyweightKg) && input.bodyweightKg > 0
      ? input.bodyweightKg
      : ASSUMED_BODYWEIGHT_KG;

  // Target reps for the seed: the middle of the prescribed band, so week 1 sits
  // in the zone the program actually trains in.
  const targetReps = Math.round((repRange.min + repRange.max) / 2);

  // Index baselines by the exercise they reference and by their pattern, so a
  // baseline given for "squat" seeds every squat-pattern movement in the menu.
  const byExerciseId = new Map<string, BaselineLiftInput>();
  const byPattern = new Map<string, BaselineLiftInput>();

  for (const lift of baselineLifts) {
    if (lift.estWeight <= 0 || lift.estReps < 1) {
      continue; // Invalid entry — ignore rather than reject the whole profile.
    }
    if (lift.exerciseId) {
      byExerciseId.set(lift.exerciseId, lift);
    }
    if (lift.pattern) {
      const pattern = lift.pattern.trim().toLowerCase();
      // First baseline for a pattern wins; later duplicates are ignored so the
      // result does not depend on array order beyond that.
      if (!byPattern.has(pattern)) {
        byPattern.set(pattern, lift);
      }
    }
  }

  return allowed
    .map((exercise): SeedLoad => {
      const baseline = byExerciseId.get(exercise.id) ?? byPattern.get(exercise.pattern);
      const step = exercise.equipment.some((item) => BARBELL_EQUIPMENT.has(item))
        ? 2.5
        : 1;

      if (baseline) {
        const est1RM = estimate1RM(baseline.estWeight, baseline.estReps);
        const working = est1RM === null ? null : loadForReps(est1RM, targetReps);

        if (est1RM !== null && working !== null) {
          return {
            exerciseId: exercise.id,
            pattern: exercise.pattern,
            targetLoad: clampWorkingLoad(working * loadMultiplier, {
              est1RM,
              envelope: safety,
              step
            }),
            est1RM: round(est1RM),
            source: "baseline"
          };
        }
      }

      // No usable baseline → conservative %-bodyweight start, to be discovered
      // during the calibration week (R9).
      const fraction = CALIBRATION_BODYWEIGHT_FRACTION[exercise.pattern] ?? 0.2;
      const estimated = bodyweightKg * fraction * loadMultiplier;

      return {
        exerciseId: exercise.id,
        pattern: exercise.pattern,
        targetLoad: estimated > 0 ? roundToLoadable(estimated, step) : null,
        est1RM: null,
        source: "calibration"
      };
    })
    .sort((a, b) => a.exerciseId.localeCompare(b.exerciseId));
}

// ------------------------------------------------------------------- Clamping

/**
 * Bring the textbook landmarks down to what THIS program can actually deliver.
 *
 * Two clamps, and the second is the important one:
 *
 *  1. The safety envelope's per-muscle ceiling always beats the goal scaling.
 *
 *  2. A minimum is only a minimum if it is REACHABLE. Once injuries and missing
 *     equipment have filtered the menu, a muscle may have no primary-mover
 *     exercise left at all (a shoulder injury removes every pressing pattern,
 *     so chest becomes untrainable), or the split may only cover it on one day.
 *     Leaving the textbook MEV in place there would make the constraints
 *     unsatisfiable — the validator would reject every candidate program,
 *     including the deterministic fallback, and the user would get nothing.
 *
 *     So `min` is clamped to `days covering the muscle × MAX_SETS_PER_EXERCISE`,
 *     and to 0 when nothing in the allowed menu trains it. An unreachable
 *     minimum is a bug in the constraints, not a fact about the program.
 */
function capVolumeTargets(
  targets: Record<string, VolumeTarget>,
  safety: SafetyEnvelope,
  context: { split: Split; allowed: AllowedExercise[] }
): Record<string, VolumeTarget> {
  const out: Record<string, VolumeTarget> = {};

  const trainable = new Set(
    context.allowed.flatMap((exercise) => exercise.primaryMuscles)
  );

  for (const [muscle, target] of Object.entries(targets)) {
    const max = Math.min(target.max, safety.maxWeeklySetsPerMuscle);

    const daysCovering = context.split.days.filter((day) =>
      day.focus.includes(muscle)
    ).length;

    const reachable = trainable.has(muscle)
      ? daysCovering * MAX_SETS_PER_EXERCISE
      : 0;

    out[muscle] = {
      min: Math.min(target.min, max, reachable),
      target: Math.min(target.target, max),
      max
    };
  }

  return out;
}

/**
 * The most working sets a single exercise is ever prescribed. Shared with the
 * seed program's tuner so the feasibility clamp above and the tuner's ceiling
 * cannot drift apart — if they did, the constraints would promise a minimum
 * the fallback structurally could not reach.
 */
export const MAX_SETS_PER_EXERCISE = 6;

function clampRpeRange(
  range: { min: number; max: number },
  safety: SafetyEnvelope
): { min: number; max: number } {
  const max = Math.min(range.max, safety.maxRpe);
  return { min: Math.min(range.min, max), max };
}
