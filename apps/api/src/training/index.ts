// Public surface of the training engine, for the dev-time eval harness
// (`packages/eval`) and any future consumer. Everything exported here is pure —
// the database-facing `service.ts` is deliberately NOT re-exported, so a
// consumer cannot accidentally pull Prisma into a context that has no database.

export {
  computeTrainingConstraints,
  MAX_SETS_PER_EXERCISE,
  type ComputeTrainingConstraintsInput,
  type TrainingProfileInputs
} from "./constraints.js";
export { estimate1RM, loadForReps, roundToLoadable } from "./e1rm.js";
export {
  deriveFeedbackAdjustments,
  NEUTRAL_ADJUSTMENTS,
  parseTrainingFeedbackText,
  patternsForArea,
  trainingFeedbackSignalSchema,
  type TrainingFeedbackSignal
} from "./feedback.js";
export {
  generatedProgramSchema,
  PROGRAM_SCHEMA_VERSION,
  PROGRAM_TOOL_DESCRIPTION,
  PROGRAM_TOOL_NAME,
  PROGRAM_TOOL_SCHEMA
} from "./program-schema.js";
export {
  progressItem,
  progressSession,
  type ExerciseHistory,
  type ProgressionOutcome,
  type SessionPerformance
} from "./progression.js";
export {
  clampRpe,
  clampWorkingLoad,
  DEFAULT_SAFETY_ENVELOPE,
  maxNextLoad,
  mergeSafetyEnvelope
} from "./safety.js";
export { buildSeedProgram } from "./seed-program.js";
export { itemsPerSession, selectSplit } from "./splits.js";
export { TEST_EXERCISES } from "./fixtures.js";
export type {
  AllowedExercise,
  Experience,
  GeneratedProgram,
  GoalType,
  PlannedItem,
  SafetyEnvelope,
  TrainingConstraints,
  ValidatedDay,
  ValidationResult,
  Violation,
  VolumeTarget
} from "./types.js";
export { checkLoadJumps, validateProgram, volumeShortfalls } from "./validate.js";
export {
  computeVolumeTargets,
  effectiveMinimum,
  TRACKED_MUSCLES,
  volumeContribution,
  weeklySetsByMuscle
} from "./volume.js";
