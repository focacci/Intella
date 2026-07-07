import type {
  BaselineLift,
  DietProfile,
  DietProfileInput,
  Goal,
  GoalInput,
  Injury,
  Profile,
  ProfileInput,
  TrainingProfile,
  TrainingProfileInput,
  UnitSystem
} from "@intella/shared";

// ---------------------------------------------------------------------------
// Onboarding + Settings share these drafts, option lists, and load/build
// helpers. Numeric physiology is held METRIC-canonical in the draft (strings
// for controlled inputs); the unit-system pick only changes how the inputs
// render (R6). So building a PUT payload is a plain parse, and switching units
// never migrates stored data — the metric value is the single source of truth.
// ---------------------------------------------------------------------------

export type Option<T extends string> = { value: T; label: string };

export const SEX_OPTIONS: Option<"male" | "female" | "other">[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" }
];

export type ActivityLevel = ProfileInput["activityLevel"];
export const ACTIVITY_LEVELS: Option<ActivityLevel>[] = [
  { value: "sedentary", label: "Sedentary — desk job, little exercise" },
  { value: "light", label: "Light — 1–3 workouts / week" },
  { value: "moderate", label: "Moderate — 3–5 workouts / week" },
  { value: "very_active", label: "Very active — 6–7 workouts / week" },
  { value: "athlete", label: "Athlete — 2×/day or a physical job" }
];

export type GoalType = GoalInput["type"];
export const GOAL_TYPES: Option<GoalType>[] = [
  { value: "lose_fat", label: "Lose fat" },
  { value: "build_muscle", label: "Build muscle" },
  { value: "get_stronger", label: "Get stronger" },
  { value: "general_health", label: "General health" }
];

export type TargetKind = NonNullable<GoalInput["targetKind"]>;
export const TARGET_KINDS: Option<TargetKind>[] = [
  { value: "outcome", label: "Outcome (e.g. feel healthier)" },
  { value: "rate", label: "Rate (e.g. −0.5 kg / week)" },
  { value: "absolute", label: "Absolute (e.g. reach 80 kg)" }
];

export type TargetUnit = NonNullable<GoalInput["targetUnit"]>;
export const TARGET_UNITS: Option<TargetUnit>[] = [
  { value: "none", label: "—" },
  { value: "kg_per_week", label: "kg / week" },
  { value: "kg", label: "kg" },
  { value: "pct_bodyfat", label: "% body fat" },
  { value: "reps", label: "reps" },
  { value: "kg_1rm", label: "kg (1RM)" }
];

export type Experience = TrainingProfileInput["experience"];
export const EXPERIENCE_LEVELS: Option<Experience>[] = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" }
];

export const EQUIPMENT_PRESETS = [
  "full_gym",
  "home_rack",
  "barbell",
  "dumbbells",
  "kettlebells",
  "bands",
  "pull_up_bar",
  "bodyweight_only",
  "cardio_machine"
] as const;

export type CookingSkill = NonNullable<DietProfileInput["cookingSkill"]>;
export const COOKING_SKILLS: Option<CookingSkill>[] = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" }
];

export type Variety = NonNullable<DietProfileInput["variety"]>;
export const VARIETY_LEVELS: Option<Variety>[] = [
  { value: "low", label: "Low — I’m happy repeating meals" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High — lots of variety" }
];

export const DIET_PATTERNS = [
  "omnivore",
  "vegetarian",
  "vegan",
  "pescatarian",
  "keto",
  "paleo",
  "mediterranean"
] as const;

// --------------------------------------------------------------- Physiology

export type PhysiologyDraft = {
  age: string;
  sex: "" | "male" | "female" | "other";
  heightCm: string; // canonical cm; the input renders ft/in when imperial
  weightKg: string; // canonical kg; the input renders lb when imperial
  bodyFat: string;
  timezone: string;
  unitSystem: UnitSystem;
  activityLevel: ActivityLevel;
};

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function emptyPhysiology(): PhysiologyDraft {
  return {
    age: "",
    sex: "",
    heightCm: "",
    weightKg: "",
    bodyFat: "",
    timezone: browserTimezone(),
    unitSystem: "metric",
    activityLevel: "moderate"
  };
}

export function loadPhysiology(profile: Profile | null): PhysiologyDraft {
  const base = emptyPhysiology();
  if (!profile) {
    return base;
  }
  return {
    age: numToStr(profile.age),
    sex: (profile.sex as PhysiologyDraft["sex"]) ?? "",
    heightCm: numToStr(profile.heightCm),
    weightKg: numToStr(profile.weightKg),
    bodyFat: numToStr(profile.bodyFat),
    timezone: profile.timezone || base.timezone,
    unitSystem: profile.unitSystem,
    activityLevel: profile.activityLevel
  };
}

export function buildProfileInput(draft: PhysiologyDraft): ProfileInput {
  const input: ProfileInput = {
    timezone: draft.timezone.trim() || "UTC",
    unitSystem: draft.unitSystem,
    activityLevel: draft.activityLevel
  };

  const age = parseIntOrUndefined(draft.age);
  if (age !== undefined) input.age = age;
  if (draft.sex) input.sex = draft.sex;
  const heightCm = parseFloatOrUndefined(draft.heightCm);
  if (heightCm !== undefined) input.heightCm = heightCm;
  const weightKg = parseFloatOrUndefined(draft.weightKg);
  if (weightKg !== undefined) input.weightKg = weightKg;
  const bodyFat = parseFloatOrUndefined(draft.bodyFat);
  if (bodyFat !== undefined) input.bodyFat = bodyFat;

  return input;
}

// --------------------------------------------------------------------- Goal

export type GoalDraft = {
  id?: string;
  type: GoalType;
  targetKind: TargetKind;
  targetValue: string;
  targetUnit: TargetUnit;
  note: string;
  priority: number;
};

export function emptyGoal(): GoalDraft {
  return {
    type: "lose_fat",
    targetKind: "outcome",
    targetValue: "",
    targetUnit: "none",
    note: "",
    priority: 1
  };
}

export function loadGoal(goal: Goal | null): GoalDraft {
  if (!goal) {
    return emptyGoal();
  }
  return {
    ...(goal.id ? { id: goal.id } : {}),
    type: goal.type ?? "general_health",
    targetKind: goal.targetKind ?? "outcome",
    targetValue: numToStr(goal.targetValue ?? null),
    targetUnit: goal.targetUnit ?? "none",
    note: goal.note ?? "",
    priority: goal.priority ?? 1
  };
}

export function buildGoalInput(draft: GoalDraft): GoalInput {
  const input: GoalInput = {
    type: draft.type,
    targetKind: draft.targetKind,
    targetUnit: draft.targetUnit,
    priority: draft.priority
  };
  if (draft.id) input.id = draft.id;
  const targetValue = parseFloatOrUndefined(draft.targetValue);
  input.targetValue = targetValue ?? null;
  if (draft.note.trim()) input.note = draft.note.trim();
  return input;
}

// ---------------------------------------------------------------- Training

// A baseline lift mid-edit: weight/reps may be blank (undefined) until filled.
// estWeight is held metric (kg); the editor renders lb when imperial.
export type DraftLift = {
  pattern?: string;
  exerciseId?: string;
  estWeight?: number | undefined;
  estReps?: number | undefined;
};

export type TrainingDraft = {
  experience: Experience;
  daysPerWeek: number;
  sessionMins: number;
  equipment: string[];
  injuries: Injury[];
  baselineLifts: DraftLift[];
};

export function emptyTraining(): TrainingDraft {
  return {
    experience: "beginner",
    daysPerWeek: 3,
    sessionMins: 60,
    equipment: [],
    injuries: [],
    baselineLifts: []
  };
}

export function loadTraining(profile: TrainingProfile | null): TrainingDraft {
  if (!profile) {
    return emptyTraining();
  }
  return {
    experience: profile.experience ?? "beginner",
    daysPerWeek: profile.daysPerWeek ?? 3,
    sessionMins: profile.sessionMins ?? 60,
    equipment: profile.equipment ?? [],
    injuries: profile.injuries ?? [],
    baselineLifts: profile.baselineLifts ?? []
  };
}

export function buildTrainingInput(draft: TrainingDraft): TrainingProfileInput {
  // Drop half-filled rows so a skipped-but-touched optional never 422s: an
  // injury needs an area; a baseline lift needs a movement + a working set.
  const injuries: Injury[] = draft.injuries
    .filter((injury) => (injury.area ?? "").trim().length > 0)
    .map((injury) => ({
      area: (injury.area ?? "").trim(),
      ...(injury.note && injury.note.trim() ? { note: injury.note.trim() } : {}),
      avoidPatterns: (injury.avoidPatterns ?? []).filter((p) => p.trim().length > 0)
    }));

  const baselineLifts: BaselineLift[] = draft.baselineLifts
    .filter(
      (lift) =>
        Boolean((lift.pattern ?? "").trim() || lift.exerciseId) &&
        typeof lift.estWeight === "number" &&
        lift.estWeight > 0 &&
        typeof lift.estReps === "number" &&
        lift.estReps >= 1
    )
    .map((lift) => {
      const cleaned: BaselineLift = {
        estWeight: Number(lift.estWeight),
        estReps: Number(lift.estReps)
      };
      const pattern = (lift.pattern ?? "").trim();
      if (pattern) cleaned.pattern = pattern;
      if (lift.exerciseId) cleaned.exerciseId = lift.exerciseId;
      return cleaned;
    });

  return {
    experience: draft.experience,
    daysPerWeek: draft.daysPerWeek,
    sessionMins: draft.sessionMins,
    equipment: draft.equipment,
    injuries,
    baselineLifts
  };
}

// ---------------------------------------------------------------- Nutrition

export type NutritionDraft = {
  pattern: string;
  restrictions: string[];
  allergies: string[];
  dislikes: string[];
  cuisines: string[];
  cookingSkill: "" | CookingSkill;
  effortMax: "" | number;
  budgetWeekly: string;
  mealsPerDay: number;
  snacksPerDay: number;
  batchCooking: boolean;
  variety: Variety;
};

export function emptyNutrition(): NutritionDraft {
  return {
    pattern: "",
    restrictions: [],
    allergies: [],
    dislikes: [],
    cuisines: [],
    cookingSkill: "",
    effortMax: "",
    budgetWeekly: "",
    mealsPerDay: 3,
    snacksPerDay: 1,
    batchCooking: true,
    variety: "moderate"
  };
}

export function loadNutrition(profile: DietProfile | null): NutritionDraft {
  const base = emptyNutrition();
  if (!profile) {
    return base;
  }
  return {
    pattern: profile.pattern ?? "",
    restrictions: profile.restrictions ?? [],
    allergies: profile.allergies ?? [],
    dislikes: profile.dislikes ?? [],
    cuisines: profile.cuisines ?? [],
    cookingSkill: (profile.cookingSkill as NutritionDraft["cookingSkill"]) ?? "",
    effortMax: profile.effortMax ?? "",
    budgetWeekly: numToStr(profile.budgetWeekly ?? null),
    mealsPerDay: profile.mealsPerDay ?? 3,
    snacksPerDay: profile.snacksPerDay ?? 1,
    batchCooking: profile.batchCooking ?? true,
    variety: profile.variety ?? "moderate"
  };
}

export function buildDietInput(draft: NutritionDraft): DietProfileInput {
  const input: DietProfileInput = {
    restrictions: draft.restrictions,
    allergies: draft.allergies,
    dislikes: draft.dislikes,
    cuisines: draft.cuisines,
    mealsPerDay: draft.mealsPerDay,
    snacksPerDay: draft.snacksPerDay,
    batchCooking: draft.batchCooking,
    variety: draft.variety
  };
  if (draft.pattern) input.pattern = draft.pattern;
  if (draft.cookingSkill) input.cookingSkill = draft.cookingSkill;
  if (draft.effortMax !== "") input.effortMax = draft.effortMax;
  const budget = parseFloatOrUndefined(draft.budgetWeekly);
  if (budget !== undefined) input.budgetWeekly = budget;
  return input;
}

// ------------------------------------------------------------------- parsing

function numToStr(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function parseIntOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFloatOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}
