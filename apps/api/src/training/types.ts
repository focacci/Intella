// ---------------------------------------------------------------------------
// Shared types for the training engine (Epic 2).
//
// `TrainingConstraints` is the rules-layer output: the complete, deterministic
// description of what a valid program looks like for this user right now. It is
// the ONLY thing the LLM layer sees, the thing the validator checks against,
// and the thing that gets persisted on `Program.inputConstraints` (so any
// generated program can be explained and reproduced) and hashed for the
// generation cache (R20b).
//
// Everything here is metric-canonical (kg) — display conversion is the web
// layer's job (R6).
// ---------------------------------------------------------------------------

export const CONSTRAINTS_VERSION = 1;

export type Experience = "beginner" | "intermediate" | "advanced";

export type GoalType = "build_muscle" | "lose_fat" | "get_stronger" | "general_health";

/** A movement pattern, matching `Exercise.pattern` in the seeded library. */
export type MovementPattern = string;

/** Weekly set landmarks for one muscle group (R11-style volume properties). */
export type VolumeTarget = {
  /** Minimum effective volume — below this the week is under-dosed. */
  min: number;
  /** The target the generator should aim for. */
  target: number;
  /** Maximum recoverable volume — above this the validator rejects. */
  max: number;
};

/**
 * Deterministic safety floors/ceilings the LLM can never override (T2.10).
 * Every value is enforced in the rules layer BEFORE generation and re-checked
 * by the validator AFTER, so a model that ignores them cannot persist anything.
 */
export type SafetyEnvelope = {
  /** Hard ceiling on session-to-session load increase, as a fraction (0.10 = 10%). */
  maxLoadJumpPct: number;
  /** Hard ceiling on absolute session-to-session load increase, kg. */
  maxLoadJumpKg: number;
  /** Never prescribe a working load above this fraction of estimated 1RM. */
  maxPctOf1RM: number;
  /** Never prescribe RPE above this. */
  maxRpe: number;
  /** Hard ceiling on total working sets in one session. */
  maxSetsPerSession: number;
  /** Hard ceiling on weekly sets for any single muscle. */
  maxWeeklySetsPerMuscle: number;
  /** During a calibration week, cap RPE this low so loads are discovered safely (R9). */
  calibrationRpeCap: number;
};

/** One day in the chosen split. */
export type SplitDay = {
  /** Human label, e.g. "Upper A — Push". */
  label: string;
  /** Patterns this day should draw from, in priority order. */
  patterns: MovementPattern[];
  /** Muscles this day is responsible for. */
  focus: string[];
};

export type Split = {
  /** e.g. "Full Body" | "Upper/Lower" | "Push/Pull/Legs". */
  name: string;
  days: SplitDay[];
};

export type ProgressionScheme = {
  /** "double_progression" — add reps to the top of the range, then add load. */
  rule: "double_progression";
  /** Load step for upper-body lifts, kg. */
  incrementUpperKg: number;
  /** Load step for lower-body lifts, kg. */
  incrementLowerKg: number;
  /** Consecutive failed sessions on a lift before a deload fires. */
  deloadTrigger: number;
  /** Fraction to drop the load by on a deload (0.10 = −10%). */
  deloadPct: number;
};

/** An exercise the generator is allowed to choose, with everything it needs. */
export type AllowedExercise = {
  id: string;
  name: string;
  pattern: MovementPattern;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
  difficulty: Experience;
};

/**
 * Week-1 starting load for one exercise (R9). `source` records WHY the number
 * is what it is, which is what the "Calibration" session label surfaces:
 *   - "baseline"    — derived from a `TrainingProfile.baselineLifts` entry via Epley;
 *   - "calibration" — no baseline; a conservative %-bodyweight estimate, RPE-capped,
 *                     to be discovered during the calibration week.
 */
export type SeedLoad = {
  exerciseId: string;
  pattern: MovementPattern;
  /** kg, already clamped by the safety envelope. Null = bodyweight/unloaded. */
  targetLoad: number | null;
  /** Estimated 1RM this seed derives from, kg. Null when unknown. */
  est1RM: number | null;
  source: "baseline" | "calibration";
};

/** The full rules-layer output. Persisted verbatim on `Program.inputConstraints`. */
export type TrainingConstraints = {
  version: number;
  goalType: GoalType;
  experience: Experience;
  daysPerWeek: number;
  sessionMins: number;
  weeks: number;
  /** > 0 when week 1 (or more) is a load-discovery week (R9). */
  calibrationWeeks: number;
  split: Split;
  /** muscle → weekly set landmarks. */
  weeklySetTargets: Record<string, VolumeTarget>;
  /** Rep range the generator should stay inside, e.g. "6-10". */
  repRange: { min: number; max: number };
  /** Working-set RPE target band. */
  rpeRange: { min: number; max: number };
  progressionScheme: ProgressionScheme;
  /** Exercises the LLM may choose from. Anything outside this list is a violation. */
  allowedExercises: AllowedExercise[];
  /** HARD constraint from `TrainingProfile.injuries` — never generated, never repaired in. */
  excludedPatterns: MovementPattern[];
  /** Exercise ids excluded because they hit an injured area. HARD. */
  excludedExerciseIds: string[];
  /** Human-readable injury notes, passed to the LLM for coaching-note context. */
  injuryNotes: string[];
  availableEquipment: string[];
  seedLoads: SeedLoad[];
  safety: SafetyEnvelope;
  /** How many exercises one session should contain, derived from `sessionMins`. */
  itemsPerSession: { min: number; max: number };
  /** Structured signal distilled from recent `Feedback` rows (T2.6). */
  feedbackAdjustments: FeedbackAdjustments;
};

/**
 * What recent user feedback changes about the NEXT generation (T2.6). Produced
 * deterministically from parsed `Feedback.structured` rows so the effect is
 * testable without a model in the loop.
 */
export type FeedbackAdjustments = {
  /** Multiplier applied to seed loads: >1 when sessions felt easy, <1 when brutal. */
  loadMultiplier: number;
  /** Multiplier applied to weekly set targets. */
  volumeMultiplier: number;
  /** Patterns to drop entirely because the user reported pain. HARD — merged into excludedPatterns. */
  avoidPatterns: MovementPattern[];
  /** Short human-readable reasons, surfaced in the UI's "why did this change?" drill-down. */
  notes: string[];
};

/** One prescribed exercise inside a session. Stored on `WorkoutSession.plannedItems`. */
export type PlannedItem = {
  exerciseId: string;
  exerciseName: string;
  targetSets: number;
  /** e.g. "6-10". */
  repRange: string;
  /** kg. Null for bodyweight / to-be-discovered. */
  targetLoad: number | null;
  rpe: number | null;
};

/** The LLM layer's output shape, before validation. */
export type GeneratedProgram = {
  schemaVersion: number;
  days: {
    label: string;
    coachingNote?: string;
    items: {
      exerciseId: string;
      targetSets: number;
      repMin: number;
      repMax: number;
      rpe?: number;
    }[];
  }[];
};

/** A single validator failure. Fed back verbatim into the R10 repair prompt. */
export type Violation = {
  rule: string;
  detail: string;
};

export type ValidationResult =
  | { ok: true; days: ValidatedDay[] }
  | { ok: false; violations: Violation[] };

export type ValidatedDay = {
  label: string;
  coachingNote: string | null;
  items: PlannedItem[];
};
