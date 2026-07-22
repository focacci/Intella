import type { Experience, GoalType } from "@intella/api/training";

// ---------------------------------------------------------------------------
// The golden set (T2.9 · R11).
//
// Twenty saved profiles chosen to span the axes that actually change what the
// generator produces — goal, training age, frequency, session length, available
// equipment, injuries, and whether baseline lifts exist — plus the awkward
// corners that break naive generators: a bodyweight-only beginner, two
// simultaneous injuries, a 7-day advanced split, a 30-minute session.
//
// These are FIXED. Adding a case is fine; changing one silently invalidates
// every historical run it appears in, so change the id too when you do.
// ---------------------------------------------------------------------------

export type GoldenCase = {
  id: string;
  /** One line on what this case is probing, shown in the report. */
  probes: string;
  goal: GoalType;
  experience: Experience;
  daysPerWeek: number;
  sessionMins: number;
  equipment: string[];
  weightKg: number;
  injuries?: { area: string; avoidPatterns?: string[] }[];
  baselineLifts?: { pattern: string; estWeight: number; estReps: number }[];
};

export const GOLDEN_CASES: GoldenCase[] = [
  {
    id: "hypertrophy-4d-fullgym-baselines",
    probes: "The mainstream case: an experienced lifter with numbers on file.",
    goal: "build_muscle",
    experience: "intermediate",
    daysPerWeek: 4,
    sessionMins: 60,
    equipment: ["full_gym"],
    weightKg: 82,
    baselineLifts: [
      { pattern: "squat", estWeight: 120, estReps: 5 },
      { pattern: "horizontal_push", estWeight: 90, estReps: 5 },
      { pattern: "hinge", estWeight: 140, estReps: 5 }
    ]
  },
  {
    id: "hypertrophy-4d-fullgym-coldstart",
    probes: "Same profile with NO baselines — must emit a calibration week (R9).",
    goal: "build_muscle",
    experience: "intermediate",
    daysPerWeek: 4,
    sessionMins: 60,
    equipment: ["full_gym"],
    weightKg: 82
  },
  {
    id: "strength-3d-barbell",
    probes: "Strength block: low reps, higher intensity, earlier deload.",
    goal: "get_stronger",
    experience: "advanced",
    daysPerWeek: 3,
    sessionMins: 90,
    equipment: ["barbell", "rack", "bench"],
    weightKg: 95,
    baselineLifts: [
      { pattern: "squat", estWeight: 180, estReps: 3 },
      { pattern: "hinge", estWeight: 210, estReps: 3 }
    ]
  },
  {
    id: "fatloss-5d-fullgym",
    probes: "Fat-loss phase: pulled-back volume, higher reps.",
    goal: "lose_fat",
    experience: "intermediate",
    daysPerWeek: 5,
    sessionMins: 45,
    equipment: ["full_gym"],
    weightKg: 98,
    baselineLifts: [{ pattern: "squat", estWeight: 100, estReps: 8 }]
  },
  {
    id: "health-2d-dumbbells",
    probes: "Minimum viable dose: two short days, dumbbells only.",
    goal: "general_health",
    experience: "beginner",
    daysPerWeek: 2,
    sessionMins: 30,
    equipment: ["dumbbell"],
    weightKg: 70
  },
  {
    id: "beginner-3d-bodyweight",
    probes: "Zero equipment. The generator must still produce a real program.",
    goal: "general_health",
    experience: "beginner",
    daysPerWeek: 3,
    sessionMins: 30,
    equipment: ["bodyweight"],
    weightKg: 68
  },
  {
    id: "beginner-3d-fullgym-coldstart",
    probes: "New lifter, full gym, no numbers — the classic onboarding path.",
    goal: "build_muscle",
    experience: "beginner",
    daysPerWeek: 3,
    sessionMins: 60,
    equipment: ["full_gym"],
    weightKg: 75
  },
  {
    id: "advanced-6d-ppl",
    probes: "High frequency: PPL twice, must not blow past recovery ceilings.",
    goal: "build_muscle",
    experience: "advanced",
    daysPerWeek: 6,
    sessionMins: 75,
    equipment: ["full_gym"],
    weightKg: 88,
    baselineLifts: [
      { pattern: "squat", estWeight: 160, estReps: 5 },
      { pattern: "horizontal_push", estWeight: 120, estReps: 5 }
    ]
  },
  {
    id: "advanced-7d",
    probes: "Every day of the week — the schedule edge case.",
    goal: "build_muscle",
    experience: "advanced",
    daysPerWeek: 7,
    sessionMins: 60,
    equipment: ["full_gym"],
    weightKg: 85
  },
  {
    id: "onceweekly-1d",
    probes: "One session a week. Full body or nothing.",
    goal: "general_health",
    experience: "beginner",
    daysPerWeek: 1,
    sessionMins: 60,
    equipment: ["full_gym"],
    weightKg: 72
  },
  {
    id: "knee-injury-4d",
    probes: "HARD constraint: no squat/lunge/leg-curl patterns may appear.",
    goal: "build_muscle",
    experience: "intermediate",
    daysPerWeek: 4,
    sessionMins: 60,
    equipment: ["full_gym"],
    weightKg: 80,
    injuries: [{ area: "knee" }]
  },
  {
    id: "shoulder-injury-4d",
    probes: "HARD constraint: no pressing. Chest may become untrainable.",
    goal: "build_muscle",
    experience: "intermediate",
    daysPerWeek: 4,
    sessionMins: 60,
    equipment: ["full_gym"],
    weightKg: 80,
    injuries: [{ area: "shoulder" }]
  },
  {
    id: "lower-back-injury-3d",
    probes: "HARD constraint: hinge and squat both removed.",
    goal: "get_stronger",
    experience: "intermediate",
    daysPerWeek: 3,
    sessionMins: 60,
    equipment: ["full_gym"],
    weightKg: 84,
    injuries: [{ area: "lower back" }]
  },
  {
    id: "double-injury-4d",
    probes: "Two simultaneous injuries — the most constrained realistic profile.",
    goal: "build_muscle",
    experience: "intermediate",
    daysPerWeek: 4,
    sessionMins: 60,
    equipment: ["full_gym"],
    weightKg: 80,
    injuries: [{ area: "knee" }, { area: "shoulder" }]
  },
  {
    id: "explicit-avoid-patterns",
    probes: "A user who named the pattern themselves, not just the body part.",
    goal: "build_muscle",
    experience: "advanced",
    daysPerWeek: 4,
    sessionMins: 60,
    equipment: ["full_gym"],
    weightKg: 86,
    injuries: [{ area: "elbow", avoidPatterns: ["elbow_extension"] }]
  },
  {
    id: "home-rack-4d",
    probes: "A realistic home gym: rack, barbell, bench, no machines.",
    goal: "get_stronger",
    experience: "intermediate",
    daysPerWeek: 4,
    sessionMins: 75,
    equipment: ["barbell", "rack", "bench", "pull_up_bar"],
    weightKg: 90,
    baselineLifts: [{ pattern: "squat", estWeight: 140, estReps: 5 }]
  },
  {
    id: "bands-only-3d",
    probes: "Travel kit: bands and bodyweight.",
    goal: "general_health",
    experience: "beginner",
    daysPerWeek: 3,
    sessionMins: 40,
    equipment: ["bands", "bodyweight"],
    weightKg: 74
  },
  {
    id: "short-sessions-5d",
    probes: "30-minute sessions: the time budget binds hard.",
    goal: "build_muscle",
    experience: "intermediate",
    daysPerWeek: 5,
    sessionMins: 30,
    equipment: ["full_gym"],
    weightKg: 78
  },
  {
    id: "long-sessions-3d",
    probes: "90-minute sessions: must not just pad with junk volume.",
    goal: "build_muscle",
    experience: "advanced",
    daysPerWeek: 3,
    sessionMins: 90,
    equipment: ["full_gym"],
    weightKg: 92,
    baselineLifts: [{ pattern: "squat", estWeight: 150, estReps: 5 }]
  },
  {
    id: "lightweight-beginner",
    probes: "A small, light beginner — calibration loads must stay sane.",
    goal: "build_muscle",
    experience: "beginner",
    daysPerWeek: 3,
    sessionMins: 45,
    equipment: ["dumbbell", "bench"],
    weightKg: 52
  }
];
