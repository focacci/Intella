import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok")
});

export const profileInputSchema = z
  .object({
    age: z.number().int().optional(),
    sex: z.enum(["male", "female", "other"]).optional(),
    heightCm: z.number().optional(),
    weightKg: z.number().optional(),
    bodyFat: z.number().optional(),
    timezone: z.string(),
    unitSystem: z.enum(["metric", "imperial"]),
    activityLevel: z.enum(["sedentary", "light", "moderate", "very_active", "athlete"])
  })
  .strict();

export const profileResponseSchema = z.object({
  id: z.string(),
  age: z.number().int().nullable(),
  sex: z.string().nullable(),
  heightCm: z.number().nullable(),
  weightKg: z.number().nullable(),
  bodyFat: z.number().nullable(),
  timezone: z.string(),
  unitSystem: z.enum(["metric", "imperial"]),
  activityLevel: z.enum(["sedentary", "light", "moderate", "very_active", "athlete"])
});

// ---------------------------------------------------------------------------
// Goals (R4 structured target + R14 priority)
// ---------------------------------------------------------------------------

const goalTypeEnum = z.enum([
  "build_muscle",
  "lose_fat",
  "get_stronger",
  "general_health"
]);
const targetKindEnum = z.enum(["rate", "absolute", "outcome"]);
const targetUnitEnum = z.enum([
  "kg_per_week",
  "kg",
  "pct_bodyfat",
  "reps",
  "kg_1rm",
  "none"
]);
const goalStatusEnum = z.enum(["active", "paused", "achieved", "abandoned"]);

export const goalInputSchema = z
  .object({
    // Absent id → create; present id → update that goal (upsert).
    id: z.string().min(1).optional(),
    type: goalTypeEnum,
    targetKind: targetKindEnum.default("outcome"),
    targetValue: z.number().nullable().optional(),
    targetUnit: targetUnitEnum.nullable().optional(),
    note: z.string().optional(),
    priority: z.number().int().min(1).default(1),
    status: goalStatusEnum.optional()
  })
  .strict();

export const goalResponseSchema = z.object({
  id: z.string(),
  type: goalTypeEnum,
  targetKind: targetKindEnum,
  targetValue: z.number().nullable(),
  targetUnit: targetUnitEnum.nullable(),
  note: z.string().nullable(),
  priority: z.number().int(),
  startDate: z.string().datetime({ offset: true }),
  status: goalStatusEnum
});

export const goalListSchema = z.array(goalResponseSchema);

// ---------------------------------------------------------------------------
// Training profile (injuries + baseline lifts are the HARD/optional bits, R9)
// ---------------------------------------------------------------------------

const experienceEnum = z.enum(["beginner", "intermediate", "advanced"]);

export const injurySchema = z.object({
  area: z.string().min(1),
  note: z.string().optional(),
  avoidPatterns: z.array(z.string()).default([])
});

// Optional starting-strength capture (R9). Needs a movement reference (pattern
// or a specific exercise) plus an estimated working set to seed week-1 loads.
export const baselineLiftSchema = z
  .object({
    pattern: z.string().min(1).optional(),
    exerciseId: z.string().min(1).optional(),
    estWeight: z.number().positive(), // kg, metric-canonical
    estReps: z.number().int().min(1)
  })
  .refine((lift) => Boolean(lift.pattern) || Boolean(lift.exerciseId), {
    message: "A baseline lift needs a pattern or an exerciseId"
  });

export const trainingProfileInputSchema = z
  .object({
    experience: experienceEnum,
    daysPerWeek: z.number().int().min(1).max(7),
    sessionMins: z.number().int().positive().max(600),
    equipment: z.array(z.string().min(1)),
    injuries: z.array(injurySchema).default([]),
    baselineLifts: z.array(baselineLiftSchema).default([])
  })
  .strict();

export const trainingProfileResponseSchema = z.object({
  id: z.string(),
  experience: experienceEnum,
  daysPerWeek: z.number().int(),
  sessionMins: z.number().int(),
  equipment: z.array(z.string()),
  injuries: z.array(injurySchema),
  baselineLifts: z.array(baselineLiftSchema)
});

// ---------------------------------------------------------------------------
// Diet profile (allergies are HARD excludes; budget is SOFT, R12)
// ---------------------------------------------------------------------------

const cookingSkillEnum = z.enum(["beginner", "intermediate", "advanced"]);
const varietyEnum = z.enum(["low", "moderate", "high"]);

// Two deliberately different shapes (see openapi.yaml):
//   macrosSchema     — carries kcal; for self-contained blobs (Recipe.macrosPerServ).
//   macroSplitSchema — no kcal; for DietProfile.macros, whose per-day energy
//                      target lives in the sibling DietProfile.kcal column.
// Keeping kcal out of the diet-profile blob avoids two sources of truth for
// the same number once the Phase 3 nutrition engine starts writing it.
export const macrosSchema = z.object({
  kcal: z.number().int(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number()
});

export const macroSplitSchema = z.object({
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number()
});

// kcal/macros are engine-computed (Phase 3), never client input.
export const dietProfileInputSchema = z
  .object({
    pattern: z.string().optional(),
    restrictions: z.array(z.string()).optional(),
    allergies: z.array(z.string()).optional(),
    dislikes: z.array(z.string()).optional(),
    cuisines: z.array(z.string()).optional(),
    cookingSkill: cookingSkillEnum.optional(),
    effortMax: z.number().int().min(1).max(5).optional(),
    budgetWeekly: z.number().nonnegative().optional(),
    mealsPerDay: z.number().int().min(1).max(12).optional(),
    snacksPerDay: z.number().int().min(0).max(12).optional(),
    batchCooking: z.boolean().optional(),
    variety: varietyEnum.optional()
  })
  .strict();

export const dietProfileResponseSchema = z.object({
  id: z.string(),
  pattern: z.string().nullable(),
  restrictions: z.array(z.string()),
  allergies: z.array(z.string()),
  dislikes: z.array(z.string()),
  cuisines: z.array(z.string()),
  cookingSkill: cookingSkillEnum.nullable(),
  effortMax: z.number().int().nullable(),
  kcal: z.number().int().nullable(),
  macros: macroSplitSchema.nullable(),
  budgetWeekly: z.number().nullable(),
  mealsPerDay: z.number().int(),
  snacksPerDay: z.number().int(),
  batchCooking: z.boolean(),
  variety: varietyEnum
});

// ---------------------------------------------------------------------------
// Provider API keys (T1.3) — stored encrypted, only ever returned masked.
// ---------------------------------------------------------------------------

const apiKeyStateSchema = z.object({
  set: z.boolean(),
  last4: z.string().nullable()
});

export const apiKeyStatusSchema = z.object({
  anthropic: apiKeyStateSchema,
  spoonacular: apiKeyStateSchema
});

export const apiKeysInputSchema = z
  .object({
    anthropic: z.string().min(1).optional(),
    spoonacular: z.string().min(1).optional()
  })
  .strict();

// ---------------------------------------------------------------------------
// Training (Epic 2). These mirror the OpenAPI request/response shapes; the
// engine's own types live in `training/types.ts` and are deliberately separate
// — the wire contract and the internal model are allowed to diverge.
// ---------------------------------------------------------------------------

export const exerciseResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  primaryMuscles: z.array(z.string()),
  secondaryMus: z.array(z.string()),
  equipment: z.array(z.string()),
  pattern: z.string(),
  difficulty: z.string(),
  mediaUrl: z.string().nullable().optional()
});

export const exerciseListSchema = z.array(exerciseResponseSchema);

export const exerciseQuerySchema = z.object({
  equipment: z.string().min(1).optional(),
  muscle: z.string().min(1).optional()
});

export const plannedItemSchema = z.object({
  exerciseId: z.string(),
  exerciseName: z.string(),
  targetSets: z.number().int(),
  repRange: z.string(),
  targetLoad: z.number().nullable(),
  rpe: z.number().nullable()
});

export const programResponseSchema = z.object({
  id: z.string(),
  goalType: z.string(),
  split: z.record(z.string(), z.unknown()),
  weeks: z.number().int(),
  progressionScheme: z.record(z.string(), z.unknown()),
  inputConstraints: z.record(z.string(), z.unknown()),
  calibrationWeeks: z.number().int(),
  degraded: z.boolean(),
  status: z.string(),
  createdAt: z.string().datetime({ offset: true })
});

export const setLogResponseSchema = z.object({
  id: z.string(),
  exerciseId: z.string(),
  setNo: z.number().int(),
  reps: z.number().int().nullable(),
  weight: z.number().nullable(),
  rpe: z.number().nullable()
});

export const workoutSessionResponseSchema = z.object({
  id: z.string(),
  programId: z.string(),
  date: z.string().datetime({ offset: true }),
  weekNo: z.number().int(),
  label: z.string().nullable(),
  status: z.enum(["planned", "completed", "skipped", "partial"]),
  plannedItems: z.array(plannedItemSchema),
  coachingNote: z.string().nullable(),
  setLogs: z.array(setLogResponseSchema)
});

export const setLogInputSchema = z
  .object({
    exerciseId: z.string().min(1),
    setNo: z.number().int().min(1),
    reps: z.number().int().min(0).max(1000).optional(),
    // Metric-canonical kg (R6). Bodyweight movements log 0.
    weight: z.number().min(0).max(1000).optional(),
    rpe: z.number().min(1).max(10).optional(),
    clientId: z.string().min(1).optional()
  })
  .strict();

export const logSetsInputSchema = z
  .object({
    status: z.enum(["completed", "skipped", "partial"]).optional(),
    sets: z.array(setLogInputSchema)
  })
  .strict();

export const feedbackInputSchema = z
  .object({
    structured: z.record(z.string(), z.unknown()).optional(),
    freeText: z.string().min(1).max(2000).optional(),
    clientId: z.string().min(1).optional()
  })
  .strict();

export const feedbackResponseSchema = z.object({
  id: z.string(),
  domain: z.string(),
  refType: z.string().nullable(),
  refId: z.string().nullable(),
  structured: z.record(z.string(), z.unknown()).nullable(),
  freeText: z.string().nullable(),
  status: z.enum(["raw", "parsed"]),
  createdAt: z.string().datetime({ offset: true })
});

export const progressQuerySchema = z.object({
  metric: z.enum(["volume", "est1rm", "bodyweight"]).default("volume"),
  exerciseId: z.string().min(1).optional()
});

export const progressSeriesSchema = z.object({
  metric: z.enum(["volume", "est1rm", "bodyweight"]),
  points: z.array(
    z.object({
      date: z.string().datetime({ offset: true }),
      value: z.number()
    })
  )
});

export const generationErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  violations: z
    .array(z.object({ rule: z.string(), detail: z.string() }))
    .optional()
});

export const systemStatusSchema = z.object({
  mode: z.enum(["full", "rules_local", "rules_only"]),
  llm: z.enum(["up", "down"]),
  provider: z.enum(["up", "down"]),
  lastBackupAt: z.string().datetime({ offset: true }).nullable(),
  lastSyncAt: z.string().datetime({ offset: true }).nullable(),
  spendMTD: z.number(),
  spendCeiling: z.number()
});

export const apiTokenInputSchema = z
  .object({
    name: z.string().min(1)
  })
  .strict();

export const apiTokenResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  lastUsedAt: z.string().datetime({ offset: true }).nullable(),
  revokedAt: z.string().datetime({ offset: true }).nullable()
});

export const apiTokenListSchema = z.array(apiTokenResponseSchema);

export const mintedApiTokenSchema = apiTokenResponseSchema.extend({
  token: z.string()
});

export const pairQuerySchema = z.object({
  pin: z.string().min(1),
  name: z.string().min(1).optional()
});

export const pairResultSchema = z.object({
  token: z.string(),
  deviceId: z.string(),
  name: z.string()
});

export type ProfileInput = z.infer<typeof profileInputSchema>;
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type GoalInput = z.infer<typeof goalInputSchema>;
export type GoalResponse = z.infer<typeof goalResponseSchema>;
export type TrainingProfileInput = z.infer<typeof trainingProfileInputSchema>;
export type TrainingProfileResponse = z.infer<typeof trainingProfileResponseSchema>;
export type Injury = z.infer<typeof injurySchema>;
export type BaselineLift = z.infer<typeof baselineLiftSchema>;
export type DietProfileInput = z.infer<typeof dietProfileInputSchema>;
export type DietProfileResponse = z.infer<typeof dietProfileResponseSchema>;
export type ApiKeyStatus = z.infer<typeof apiKeyStatusSchema>;
export type ApiKeysInput = z.infer<typeof apiKeysInputSchema>;
export type SystemStatus = z.infer<typeof systemStatusSchema>;
export type ApiTokenInput = z.infer<typeof apiTokenInputSchema>;
export type ApiTokenResponse = z.infer<typeof apiTokenResponseSchema>;
export type MintedApiTokenResponse = z.infer<typeof mintedApiTokenSchema>;
export type PairQuery = z.infer<typeof pairQuerySchema>;
export type PairResult = z.infer<typeof pairResultSchema>;
export type ExerciseResponse = z.infer<typeof exerciseResponseSchema>;
export type ExerciseQuery = z.infer<typeof exerciseQuerySchema>;
export type ProgramResponse = z.infer<typeof programResponseSchema>;
export type WorkoutSessionResponse = z.infer<typeof workoutSessionResponseSchema>;
export type LogSetsInputBody = z.infer<typeof logSetsInputSchema>;
export type FeedbackInputBody = z.infer<typeof feedbackInputSchema>;
export type ProgressQuery = z.infer<typeof progressQuerySchema>;
