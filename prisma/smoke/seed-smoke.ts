import { createPrismaClient } from "../client.js";

process.env.DATABASE_URL ??= "file:./prisma/intella.db";

const prisma = createPrismaClient();

async function main() {
  const [exercises, ingredients, aliases, program, sessions, mealPlan, meals] =
    await Promise.all([
      prisma.exercise.count(),
      prisma.ingredient.count(),
      prisma.ingredientAlias.count(),
      prisma.program.findUnique({ where: { id: "seed-program-starter" } }),
      prisma.workoutSession.count({
        where: { programId: "seed-program-starter" }
      }),
      prisma.mealPlan.findUnique({ where: { id: "seed-meal-plan-starter" } }),
      prisma.plannedMeal.count({
        where: { planId: "seed-meal-plan-starter" }
      })
    ]);

  assertAtLeast(exercises, 12, "exercise library");
  assertAtLeast(ingredients, 16, "ingredient map");
  assertAtLeast(aliases, 20, "ingredient aliases");

  if (!program) {
    throw new Error("Missing deterministic seed program.");
  }

  if (!mealPlan) {
    throw new Error("Missing deterministic seed meal plan.");
  }

  assertAtLeast(sessions, 3, "seed workout sessions");
  assertAtLeast(meals, 28, "seed planned meals");

  const journalMode = await prisma.$queryRawUnsafe<Array<{ journal_mode: string }>>(
    "PRAGMA journal_mode"
  );

  if (journalMode[0]?.journal_mode.toLowerCase() !== "wal") {
    throw new Error(
      `SQLite journal mode is ${journalMode[0]?.journal_mode ?? "unknown"}, expected wal.`
    );
  }

  console.log(
    "Seed smoke passed: exercises, ingredient map, aliases, seed program, seed meal plan, and WAL mode are present."
  );
}

function assertAtLeast(actual: number, expected: number, label: string) {
  if (actual < expected) {
    throw new Error(`${label}: expected at least ${expected}, got ${actual}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
