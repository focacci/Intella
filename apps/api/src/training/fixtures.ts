import type { AllowedExercise, Experience } from "./types.js";

// ---------------------------------------------------------------------------
// Shared test fixtures for the training engine.
//
// The library here MIRRORS the shape and coverage of the seeded one in
// `prisma/seed.ts` — every pattern the splits reference, at several equipment
// tiers and difficulties — so the pure unit tests exercise realistic filtering
// (a beginner with dumbbells only, a lifter with a bad knee) rather than a toy
// two-exercise menu that would never surface a real constraint interaction.
// ---------------------------------------------------------------------------

type Spec = [
  name: string,
  pattern: string,
  primary: string[],
  secondary: string[],
  equipment: string[],
  difficulty: Experience
];

const SPECS: Spec[] = [
  // squat
  ["Back Squat", "squat", ["quads", "glutes"], ["hamstrings", "core"], ["barbell", "rack"], "intermediate"],
  ["Goblet Squat", "squat", ["quads", "glutes"], ["core"], ["dumbbell"], "beginner"],
  ["Bodyweight Squat", "squat", ["quads", "glutes"], ["core"], ["bodyweight"], "beginner"],
  ["Leg Press", "squat", ["quads", "glutes"], ["hamstrings"], ["machine"], "beginner"],
  // hinge
  ["Romanian Deadlift", "hinge", ["hamstrings", "glutes"], ["upper_back"], ["barbell"], "intermediate"],
  ["Dumbbell Romanian Deadlift", "hinge", ["hamstrings", "glutes"], ["upper_back"], ["dumbbell"], "beginner"],
  ["Back Extension", "hinge", ["glutes", "hamstrings"], ["core"], ["bodyweight"], "beginner"],
  // horizontal push
  ["Bench Press", "horizontal_push", ["chest"], ["triceps", "shoulders"], ["barbell", "bench"], "intermediate"],
  ["Dumbbell Bench Press", "horizontal_push", ["chest"], ["triceps", "shoulders"], ["dumbbell", "bench"], "beginner"],
  ["Push-Up", "horizontal_push", ["chest"], ["triceps", "core", "shoulders"], ["bodyweight"], "beginner"],
  // vertical push
  ["Overhead Press", "vertical_push", ["shoulders"], ["triceps", "core"], ["barbell"], "intermediate"],
  ["Dumbbell Shoulder Press", "vertical_push", ["shoulders"], ["triceps"], ["dumbbell"], "beginner"],
  ["Pike Push-Up", "vertical_push", ["shoulders"], ["triceps", "core"], ["bodyweight"], "intermediate"],
  ["Dumbbell Lateral Raise", "vertical_push", ["shoulders"], [], ["dumbbell"], "beginner"],
  // vertical pull
  ["Pull-Up", "vertical_pull", ["lats", "upper_back"], ["biceps", "core"], ["pull_up_bar"], "intermediate"],
  ["Lat Pulldown", "vertical_pull", ["lats"], ["biceps", "upper_back"], ["cable_machine"], "beginner"],
  ["Band Lat Pulldown", "vertical_pull", ["lats"], ["biceps", "upper_back"], ["bands"], "beginner"],
  // horizontal pull
  ["Barbell Row", "horizontal_pull", ["upper_back", "lats"], ["biceps", "core"], ["barbell"], "intermediate"],
  ["One-Arm Dumbbell Row", "horizontal_pull", ["upper_back", "lats"], ["biceps"], ["dumbbell", "bench"], "beginner"],
  ["Inverted Row", "horizontal_pull", ["upper_back", "lats"], ["biceps", "core"], ["bodyweight"], "beginner"],
  // single leg
  ["Split Squat", "single_leg", ["quads", "glutes"], ["core"], ["dumbbell"], "intermediate"],
  ["Reverse Lunge", "single_leg", ["quads", "glutes"], ["hamstrings"], ["bodyweight"], "beginner"],
  // knee flexion
  ["Leg Curl", "knee_flexion", ["hamstrings"], [], ["machine"], "beginner"],
  ["Nordic Curl", "knee_flexion", ["hamstrings"], ["glutes"], ["bodyweight"], "advanced"],
  ["Dumbbell Leg Curl", "knee_flexion", ["hamstrings"], [], ["dumbbell", "bench"], "beginner"],
  // calf raise
  ["Standing Calf Raise", "calf_raise", ["calves"], [], ["machine"], "beginner"],
  ["Bodyweight Calf Raise", "calf_raise", ["calves"], [], ["bodyweight"], "beginner"],
  ["Dumbbell Calf Raise", "calf_raise", ["calves"], [], ["dumbbell"], "beginner"],
  // elbow flexion
  ["Dumbbell Curl", "elbow_flexion", ["biceps"], [], ["dumbbell"], "beginner"],
  ["Barbell Curl", "elbow_flexion", ["biceps"], ["upper_back"], ["barbell"], "beginner"],
  ["Band Curl", "elbow_flexion", ["biceps"], [], ["bands"], "beginner"],
  // elbow extension
  ["Cable Triceps Pressdown", "elbow_extension", ["triceps"], [], ["cable_machine"], "beginner"],
  ["Overhead Dumbbell Extension", "elbow_extension", ["triceps"], [], ["dumbbell"], "beginner"],
  ["Bench Dip", "elbow_extension", ["triceps"], ["chest"], ["bodyweight", "bench"], "beginner"],
  // core
  ["Plank", "core", ["core"], [], ["bodyweight"], "beginner"],
  ["Cable Crunch", "core", ["core"], [], ["cable_machine"], "beginner"],
  ["Hanging Leg Raise", "core", ["core"], ["lats"], ["pull_up_bar"], "intermediate"]
];

/** A stable id per exercise, so assertions can name a specific movement. */
export function exerciseId(name: string): string {
  return `ex-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export const TEST_EXERCISES: AllowedExercise[] = SPECS.map(
  ([name, pattern, primaryMuscles, secondaryMuscles, equipment, difficulty]) => ({
    id: exerciseId(name),
    name,
    pattern,
    primaryMuscles,
    secondaryMuscles,
    equipment,
    difficulty
  })
);

export function findExercise(name: string): AllowedExercise {
  const exercise = TEST_EXERCISES.find((candidate) => candidate.name === name);
  if (!exercise) {
    throw new Error(`No test exercise named "${name}"`);
  }
  return exercise;
}
