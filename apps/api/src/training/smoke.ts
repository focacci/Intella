// Dev-time smoke check: exercises the real generated OpenAPI client against a
// real server over the real routes, with no model reachable (the first-run
// path). Not a test — a hand-runnable sanity check.
import { createIntellaClient } from "@intella/shared";

import { buildServer } from "../server.js";
import { createInjectFetch, createTestDatabase } from "../test-helpers.js";

const database = await createTestDatabase();
const app = buildServer({
  authToken: "smoke",
  logger: false,
  prisma: database.prisma,
  llmProviders: { claude: null, local: null }
});

const client = createIntellaClient({
  authToken: "smoke",
  baseUrl: "http://intella.test",
  fetch: createInjectFetch(app)
});

await database.prisma.profile.create({ data: { weightKg: 82, timezone: "UTC" } });
await database.prisma.goal.create({ data: { type: "build_muscle", status: "active" } });
await database.prisma.trainingProfile.create({
  data: {
    experience: "intermediate",
    daysPerWeek: 4,
    sessionMins: 60,
    equipment: JSON.stringify(["full_gym"]),
    baselineLifts: JSON.stringify([{ pattern: "squat", estWeight: 120, estReps: 5 }])
  }
});

// The smoke database is migrations-only, so load a pattern-complete slice of
// the seeded library — otherwise generation correctly refuses with
// `no_exercise_library` and there is nothing to smoke-test.
const library = [
  ["Back Squat", "squat", ["quads", "glutes"], ["barbell", "rack"]],
  ["Romanian Deadlift", "hinge", ["hamstrings", "glutes"], ["barbell"]],
  ["Bench Press", "horizontal_push", ["chest"], ["barbell", "bench"]],
  ["Overhead Press", "vertical_push", ["shoulders"], ["barbell"]],
  ["Lat Pulldown", "vertical_pull", ["lats"], ["cable_machine"]],
  ["Seated Cable Row", "horizontal_pull", ["upper_back"], ["cable_machine"]],
  ["Split Squat", "single_leg", ["quads"], ["dumbbell"]],
  ["Leg Curl", "knee_flexion", ["hamstrings"], ["machine"]],
  ["Standing Calf Raise", "calf_raise", ["calves"], ["machine"]],
  ["Dumbbell Curl", "elbow_flexion", ["biceps"], ["dumbbell"]],
  ["Cable Triceps Pressdown", "elbow_extension", ["triceps"], ["cable_machine"]],
  ["Plank", "core", ["core"], ["bodyweight"]]
] as const;

for (const [name, pattern, primary, equipment] of library) {
  await database.prisma.exercise.create({
    data: {
      name,
      pattern,
      difficulty: "beginner",
      primaryMuscles: JSON.stringify(primary),
      secondaryMus: "[]",
      equipment: JSON.stringify(equipment)
    }
  });
}

console.log("exercises:", (await client.listExercises()).length);
const program = await client.generateProgram();
console.log("program:", program.id, "degraded:", program.degraded, "weeks:", program.weeks);

const session = await client.getTodaySession();
console.log("today:", session?.label, session?.plannedItems?.length, "items");

if (session?.id && session.plannedItems?.[0]) {
  const item = session.plannedItems[0];
  const logged = await client.logSets(session.id, {
    status: "completed",
    sets: [{ exerciseId: item.exerciseId!, setNo: 1, reps: 10, weight: 60, rpe: 8 }]
  });
  console.log("logged sets:", logged.setLogs?.length);

  const feedback = await client.submitSessionFeedback(session.id, {
    freeText: "felt easy"
  });
  console.log("feedback:", feedback.status, JSON.stringify(feedback.structured));
}

console.log("progress:", (await client.getProgress("volume")).points?.length, "points");

await app.close();
await database.cleanup();
