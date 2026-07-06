import { createPrismaClient } from "./client.js";

process.env.DATABASE_URL ??= "file:./prisma/intella.db";

const prisma = createPrismaClient();

const seedWeekStart = new Date("2026-01-05T00:00:00.000Z");

type ExerciseSeed = {
  name: string;
  primaryMuscles: string[];
  secondaryMus?: string[];
  equipment: string[];
  pattern: string;
  difficulty: string;
};

type IngredientSeed = {
  canonicalName: string;
  defaultUnit: string;
  category: string;
  aisleOrder: number;
  densityGPerMl?: number;
  gramsPerPiece?: number;
  nutritionRef?: string;
  aliases: string[];
};

const exercises: ExerciseSeed[] = [
  {
    name: "Back Squat",
    primaryMuscles: ["quads", "glutes"],
    secondaryMus: ["hamstrings", "core"],
    equipment: ["barbell", "rack"],
    pattern: "squat",
    difficulty: "intermediate"
  },
  {
    name: "Goblet Squat",
    primaryMuscles: ["quads", "glutes"],
    secondaryMus: ["core"],
    equipment: ["dumbbell"],
    pattern: "squat",
    difficulty: "beginner"
  },
  {
    name: "Romanian Deadlift",
    primaryMuscles: ["hamstrings", "glutes"],
    secondaryMus: ["back"],
    equipment: ["barbell"],
    pattern: "hinge",
    difficulty: "intermediate"
  },
  {
    name: "Trap Bar Deadlift",
    primaryMuscles: ["glutes", "hamstrings", "quads"],
    secondaryMus: ["back", "core"],
    equipment: ["trap_bar"],
    pattern: "hinge",
    difficulty: "beginner"
  },
  {
    name: "Bench Press",
    primaryMuscles: ["chest"],
    secondaryMus: ["triceps", "front_delts"],
    equipment: ["barbell", "bench"],
    pattern: "horizontal_push",
    difficulty: "intermediate"
  },
  {
    name: "Push-Up",
    primaryMuscles: ["chest"],
    secondaryMus: ["triceps", "core"],
    equipment: ["bodyweight"],
    pattern: "horizontal_push",
    difficulty: "beginner"
  },
  {
    name: "Overhead Press",
    primaryMuscles: ["shoulders"],
    secondaryMus: ["triceps", "core"],
    equipment: ["barbell"],
    pattern: "vertical_push",
    difficulty: "intermediate"
  },
  {
    name: "Dumbbell Shoulder Press",
    primaryMuscles: ["shoulders"],
    secondaryMus: ["triceps"],
    equipment: ["dumbbells"],
    pattern: "vertical_push",
    difficulty: "beginner"
  },
  {
    name: "Pull-Up",
    primaryMuscles: ["lats", "upper_back"],
    secondaryMus: ["biceps"],
    equipment: ["pull_up_bar"],
    pattern: "vertical_pull",
    difficulty: "intermediate"
  },
  {
    name: "Lat Pulldown",
    primaryMuscles: ["lats"],
    secondaryMus: ["biceps", "upper_back"],
    equipment: ["cable_machine"],
    pattern: "vertical_pull",
    difficulty: "beginner"
  },
  {
    name: "One-Arm Dumbbell Row",
    primaryMuscles: ["upper_back", "lats"],
    secondaryMus: ["biceps"],
    equipment: ["dumbbell", "bench"],
    pattern: "horizontal_pull",
    difficulty: "beginner"
  },
  {
    name: "Seated Cable Row",
    primaryMuscles: ["upper_back", "lats"],
    secondaryMus: ["biceps"],
    equipment: ["cable_machine"],
    pattern: "horizontal_pull",
    difficulty: "beginner"
  },
  {
    name: "Split Squat",
    primaryMuscles: ["quads", "glutes"],
    secondaryMus: ["adductors", "core"],
    equipment: ["dumbbells"],
    pattern: "single_leg",
    difficulty: "intermediate"
  },
  {
    name: "Leg Curl",
    primaryMuscles: ["hamstrings"],
    equipment: ["machine"],
    pattern: "knee_flexion",
    difficulty: "beginner"
  },
  {
    name: "Cable Triceps Pressdown",
    primaryMuscles: ["triceps"],
    equipment: ["cable_machine"],
    pattern: "elbow_extension",
    difficulty: "beginner"
  },
  {
    name: "Dumbbell Curl",
    primaryMuscles: ["biceps"],
    equipment: ["dumbbells"],
    pattern: "elbow_flexion",
    difficulty: "beginner"
  }
];

const ingredients: IngredientSeed[] = [
  {
    canonicalName: "rolled oats",
    defaultUnit: "g",
    category: "pantry",
    aisleOrder: 10,
    densityGPerMl: 0.34,
    aliases: ["old fashioned oats", "oats", "oatmeal"]
  },
  {
    canonicalName: "banana",
    defaultUnit: "piece",
    category: "produce",
    aisleOrder: 10,
    gramsPerPiece: 118,
    aliases: ["bananas", "ripe banana"]
  },
  {
    canonicalName: "egg",
    defaultUnit: "piece",
    category: "dairy_eggs",
    aisleOrder: 10,
    gramsPerPiece: 50,
    aliases: ["eggs", "large egg", "whole egg"]
  },
  {
    canonicalName: "greek yogurt",
    defaultUnit: "g",
    category: "dairy_eggs",
    aisleOrder: 20,
    densityGPerMl: 1.03,
    aliases: ["plain greek yogurt", "nonfat greek yogurt", "yoghurt"]
  },
  {
    canonicalName: "chicken breast",
    defaultUnit: "g",
    category: "meat_seafood",
    aisleOrder: 10,
    aliases: ["boneless skinless chicken breast", "chicken breasts"]
  },
  {
    canonicalName: "brown rice",
    defaultUnit: "g",
    category: "pantry",
    aisleOrder: 20,
    densityGPerMl: 0.78,
    aliases: ["rice", "whole grain rice"]
  },
  {
    canonicalName: "broccoli",
    defaultUnit: "g",
    category: "produce",
    aisleOrder: 20,
    gramsPerPiece: 608,
    aliases: ["broccoli florets", "broccoli crown"]
  },
  {
    canonicalName: "olive oil",
    defaultUnit: "ml",
    category: "pantry",
    aisleOrder: 30,
    densityGPerMl: 0.91,
    aliases: ["extra virgin olive oil", "evoo"]
  },
  {
    canonicalName: "salmon fillet",
    defaultUnit: "g",
    category: "meat_seafood",
    aisleOrder: 20,
    aliases: ["salmon", "salmon filet"]
  },
  {
    canonicalName: "sweet potato",
    defaultUnit: "piece",
    category: "produce",
    aisleOrder: 30,
    gramsPerPiece: 130,
    aliases: ["sweet potatoes", "yam"]
  },
  {
    canonicalName: "spinach",
    defaultUnit: "g",
    category: "produce",
    aisleOrder: 40,
    densityGPerMl: 0.03,
    aliases: ["baby spinach", "fresh spinach"]
  },
  {
    canonicalName: "onion",
    defaultUnit: "piece",
    category: "produce",
    aisleOrder: 50,
    gramsPerPiece: 110,
    aliases: ["yellow onion", "brown onion", "onions"]
  },
  {
    canonicalName: "bell pepper",
    defaultUnit: "piece",
    category: "produce",
    aisleOrder: 60,
    gramsPerPiece: 120,
    aliases: ["red pepper", "green pepper", "sweet pepper"]
  },
  {
    canonicalName: "black beans",
    defaultUnit: "g",
    category: "pantry",
    aisleOrder: 40,
    densityGPerMl: 0.74,
    aliases: ["canned black beans", "beans"]
  },
  {
    canonicalName: "whole wheat tortilla",
    defaultUnit: "piece",
    category: "bakery",
    aisleOrder: 10,
    gramsPerPiece: 45,
    aliases: ["wheat tortilla", "tortillas", "wrap"]
  },
  {
    canonicalName: "avocado",
    defaultUnit: "piece",
    category: "produce",
    aisleOrder: 70,
    gramsPerPiece: 150,
    aliases: ["avocados"]
  },
  {
    canonicalName: "milk",
    defaultUnit: "ml",
    category: "dairy_eggs",
    aisleOrder: 30,
    densityGPerMl: 1.03,
    aliases: ["dairy milk", "2% milk"]
  },
  {
    canonicalName: "whey protein powder",
    defaultUnit: "g",
    category: "pantry",
    aisleOrder: 50,
    densityGPerMl: 0.41,
    aliases: ["protein powder", "whey"]
  },
  {
    canonicalName: "peanut butter",
    defaultUnit: "g",
    category: "pantry",
    aisleOrder: 60,
    densityGPerMl: 1.08,
    aliases: ["natural peanut butter", "pb"]
  },
  {
    canonicalName: "mixed berries",
    defaultUnit: "g",
    category: "frozen",
    aisleOrder: 10,
    densityGPerMl: 0.62,
    aliases: ["berries", "frozen berries", "blueberries"]
  }
];

async function main() {
  await enableWalMode();

  const exerciseMap = await seedExercises();
  const ingredientMap = await seedIngredients();
  const recipeMap = await seedRecipes(ingredientMap);

  await seedProgram(exerciseMap);
  await seedMealPlan(recipeMap);

  const [exerciseCount, ingredientCount, aliasCount, planCount, mealPlanCount] =
    await Promise.all([
      prisma.exercise.count(),
      prisma.ingredient.count(),
      prisma.ingredientAlias.count(),
      prisma.program.count({ where: { id: "seed-program-starter" } }),
      prisma.mealPlan.count({ where: { id: "seed-meal-plan-starter" } })
    ]);

  console.log(
    `Seed complete: ${exerciseCount} exercises, ${ingredientCount} ingredients, ${aliasCount} aliases, ${planCount} seed program, ${mealPlanCount} seed meal plan.`
  );
}

async function enableWalMode() {
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
}

async function seedExercises() {
  const entries = await Promise.all(
    exercises.map((exercise) =>
      prisma.exercise.upsert({
        where: { name: exercise.name },
        update: exerciseData(exercise),
        create: exerciseData(exercise)
      })
    )
  );

  return new Map(entries.map((exercise) => [exercise.name, exercise.id]));
}

function exerciseData(exercise: ExerciseSeed) {
  return {
    name: exercise.name,
    primaryMuscles: JSON.stringify(exercise.primaryMuscles),
    secondaryMus: JSON.stringify(exercise.secondaryMus ?? []),
    equipment: JSON.stringify(exercise.equipment),
    pattern: exercise.pattern,
    difficulty: exercise.difficulty
  };
}

async function seedIngredients() {
  const ingredientMap = new Map<string, string>();

  for (const ingredient of ingredients) {
    const row = await prisma.ingredient.upsert({
      where: { canonicalName: ingredient.canonicalName },
      update: ingredientData(ingredient),
      create: ingredientData(ingredient)
    });

    ingredientMap.set(row.canonicalName, row.id);

    for (const alias of ingredient.aliases) {
      await prisma.ingredientAlias.upsert({
        where: { alias },
        update: {
          ingredientId: row.id,
          source: "manual"
        },
        create: {
          alias,
          ingredientId: row.id,
          source: "manual"
        }
      });
    }
  }

  return ingredientMap;
}

function ingredientData(ingredient: IngredientSeed) {
  return {
    canonicalName: ingredient.canonicalName,
    defaultUnit: ingredient.defaultUnit,
    category: ingredient.category,
    aisleOrder: ingredient.aisleOrder,
    densityGPerMl: ingredient.densityGPerMl ?? null,
    gramsPerPiece: ingredient.gramsPerPiece ?? null,
    nutritionRef: ingredient.nutritionRef ?? null
  };
}

async function seedRecipes(ingredientMap: Map<string, string>) {
  const recipeSeeds = [
    {
      id: "seed-recipe-yogurt-oats",
      name: "Greek Yogurt Oats",
      ingredients: [
        recipeIngredient(ingredientMap, "rolled oats", "60 g rolled oats", 60, "g"),
        recipeIngredient(
          ingredientMap,
          "greek yogurt",
          "200 g plain Greek yogurt",
          200,
          "g"
        ),
        recipeIngredient(ingredientMap, "banana", "1 banana", 1, "piece"),
        recipeIngredient(ingredientMap, "mixed berries", "75 g berries", 75, "g")
      ],
      steps: [
        "Combine oats and yogurt.",
        "Top with sliced banana and berries."
      ],
      macrosPerServ: { kcal: 520, proteinG: 35, carbsG: 78, fatG: 8 },
      costEst: 4.25,
      timeMins: 8,
      tags: ["breakfast", "high_protein", "no_cook"]
    },
    {
      id: "seed-recipe-chicken-rice-bowl",
      name: "Chicken Rice Bowl",
      ingredients: [
        recipeIngredient(
          ingredientMap,
          "chicken breast",
          "170 g chicken breast",
          170,
          "g"
        ),
        recipeIngredient(ingredientMap, "brown rice", "85 g dry brown rice", 85, "g"),
        recipeIngredient(ingredientMap, "broccoli", "150 g broccoli", 150, "g"),
        recipeIngredient(ingredientMap, "olive oil", "10 ml olive oil", 10, "ml")
      ],
      steps: [
        "Cook rice until tender.",
        "Sear chicken and steam broccoli.",
        "Assemble with olive oil and seasoning."
      ],
      macrosPerServ: { kcal: 650, proteinG: 52, carbsG: 70, fatG: 18 },
      costEst: 6.5,
      timeMins: 35,
      tags: ["lunch", "batch"]
    },
    {
      id: "seed-recipe-salmon-sweet-potato",
      name: "Salmon Sweet Potato Plate",
      ingredients: [
        recipeIngredient(ingredientMap, "salmon fillet", "170 g salmon", 170, "g"),
        recipeIngredient(
          ingredientMap,
          "sweet potato",
          "1 medium sweet potato",
          1,
          "piece"
        ),
        recipeIngredient(ingredientMap, "spinach", "80 g spinach", 80, "g"),
        recipeIngredient(ingredientMap, "olive oil", "10 ml olive oil", 10, "ml")
      ],
      steps: [
        "Roast sweet potato until tender.",
        "Bake salmon and wilt spinach.",
        "Plate with olive oil and seasoning."
      ],
      macrosPerServ: { kcal: 610, proteinG: 42, carbsG: 48, fatG: 26 },
      costEst: 8.75,
      timeMins: 35,
      tags: ["dinner", "omega_3"]
    },
    {
      id: "seed-recipe-bean-wrap",
      name: "Black Bean Avocado Wrap",
      ingredients: [
        recipeIngredient(
          ingredientMap,
          "whole wheat tortilla",
          "1 whole wheat tortilla",
          1,
          "piece"
        ),
        recipeIngredient(ingredientMap, "black beans", "130 g black beans", 130, "g"),
        recipeIngredient(ingredientMap, "bell pepper", "1 bell pepper", 1, "piece"),
        recipeIngredient(ingredientMap, "onion", "0.5 onion", 0.5, "piece"),
        recipeIngredient(ingredientMap, "avocado", "0.5 avocado", 0.5, "piece")
      ],
      steps: [
        "Warm beans with diced pepper and onion.",
        "Fill tortilla and top with avocado."
      ],
      macrosPerServ: { kcal: 540, proteinG: 20, carbsG: 78, fatG: 18 },
      costEst: 4.9,
      timeMins: 20,
      tags: ["lunch", "vegetarian"]
    },
    {
      id: "seed-recipe-protein-smoothie",
      name: "Protein Banana Smoothie",
      ingredients: [
        recipeIngredient(ingredientMap, "milk", "300 ml milk", 300, "ml"),
        recipeIngredient(
          ingredientMap,
          "whey protein powder",
          "30 g whey protein",
          30,
          "g"
        ),
        recipeIngredient(ingredientMap, "banana", "1 banana", 1, "piece"),
        recipeIngredient(ingredientMap, "peanut butter", "20 g peanut butter", 20, "g")
      ],
      steps: ["Blend until smooth."],
      macrosPerServ: { kcal: 440, proteinG: 38, carbsG: 45, fatG: 14 },
      costEst: 3.6,
      timeMins: 5,
      tags: ["snack", "high_protein"]
    }
  ];

  const recipeMap = new Map<string, string>();

  for (const recipe of recipeSeeds) {
    const row = await prisma.recipe.upsert({
      where: { id: recipe.id },
      update: {
        name: recipe.name,
        ingredients: JSON.stringify(recipe.ingredients),
        steps: JSON.stringify(recipe.steps),
        macrosPerServ: JSON.stringify(recipe.macrosPerServ),
        costEst: recipe.costEst,
        timeMins: recipe.timeMins,
        tags: JSON.stringify(recipe.tags),
        sourceId: recipe.id,
        source: "manual"
      },
      create: {
        id: recipe.id,
        name: recipe.name,
        ingredients: JSON.stringify(recipe.ingredients),
        steps: JSON.stringify(recipe.steps),
        macrosPerServ: JSON.stringify(recipe.macrosPerServ),
        costEst: recipe.costEst,
        timeMins: recipe.timeMins,
        tags: JSON.stringify(recipe.tags),
        sourceId: recipe.id,
        source: "manual"
      }
    });

    recipeMap.set(row.id, row.id);
  }

  return recipeMap;
}

function recipeIngredient(
  ingredientMap: Map<string, string>,
  canonicalName: string,
  raw: string,
  qty: number,
  unit: string
) {
  const ingredientId = ingredientMap.get(canonicalName);

  if (!ingredientId) {
    throw new Error(`Missing ingredient seed for ${canonicalName}`);
  }

  return {
    ingredientId,
    raw,
    qty,
    unit
  };
}

async function seedProgram(exerciseMap: Map<string, string>) {
  const plannedItemsByDay = [
    [
      plannedItem(exerciseMap, "Goblet Squat", 3, "8-10", null, 7),
      plannedItem(exerciseMap, "Push-Up", 3, "8-12", null, 7),
      plannedItem(exerciseMap, "One-Arm Dumbbell Row", 3, "10-12", null, 7)
    ],
    [
      plannedItem(exerciseMap, "Romanian Deadlift", 3, "8-10", null, 7),
      plannedItem(exerciseMap, "Dumbbell Shoulder Press", 3, "8-10", null, 7),
      plannedItem(exerciseMap, "Lat Pulldown", 3, "10-12", null, 7)
    ],
    [
      plannedItem(exerciseMap, "Split Squat", 3, "8-10", null, 7),
      plannedItem(exerciseMap, "Seated Cable Row", 3, "10-12", null, 7),
      plannedItem(exerciseMap, "Cable Triceps Pressdown", 2, "12-15", null, 7)
    ]
  ];

  await prisma.program.upsert({
    where: { id: "seed-program-starter" },
    update: {
      goalType: "general_health",
      split: JSON.stringify({
        name: "Starter Full Body",
        days: ["Full Body A", "Full Body B", "Full Body C"]
      }),
      weeks: 4,
      progressionScheme: JSON.stringify({
        rule: "Add reps within range before adding load.",
        deloadTrigger: "Two consecutive sessions below target reps"
      }),
      inputConstraints: JSON.stringify({
        source: "seed",
        mode: "rules_only",
        hardConstraintsRespected: ["injuries", "equipment"]
      }),
      constraintsHash: "seed-program-v1",
      hashVersion: 1,
      calibrationWeeks: 1,
      degraded: true,
      status: "active"
    },
    create: {
      id: "seed-program-starter",
      goalType: "general_health",
      split: JSON.stringify({
        name: "Starter Full Body",
        days: ["Full Body A", "Full Body B", "Full Body C"]
      }),
      weeks: 4,
      progressionScheme: JSON.stringify({
        rule: "Add reps within range before adding load.",
        deloadTrigger: "Two consecutive sessions below target reps"
      }),
      inputConstraints: JSON.stringify({
        source: "seed",
        mode: "rules_only",
        hardConstraintsRespected: ["injuries", "equipment"]
      }),
      constraintsHash: "seed-program-v1",
      hashVersion: 1,
      calibrationWeeks: 1,
      degraded: true,
      status: "active"
    }
  });

  for (const [index, plannedItems] of plannedItemsByDay.entries()) {
    await prisma.workoutSession.upsert({
      where: { id: `seed-session-${index + 1}` },
      update: {
        programId: "seed-program-starter",
        date: addDays(seedWeekStart, index * 2),
        weekNo: 1,
        label: index === 0 ? "Calibration" : `Full Body ${String.fromCharCode(65 + index)}`,
        status: "planned",
        plannedItems: JSON.stringify(plannedItems),
        coachingNote:
          "Starter session: keep 2-3 reps in reserve and stop if anything hurts."
      },
      create: {
        id: `seed-session-${index + 1}`,
        programId: "seed-program-starter",
        date: addDays(seedWeekStart, index * 2),
        weekNo: 1,
        label: index === 0 ? "Calibration" : `Full Body ${String.fromCharCode(65 + index)}`,
        status: "planned",
        plannedItems: JSON.stringify(plannedItems),
        coachingNote:
          "Starter session: keep 2-3 reps in reserve and stop if anything hurts."
      }
    });
  }
}

function plannedItem(
  exerciseMap: Map<string, string>,
  exerciseName: string,
  targetSets: number,
  repRange: string,
  targetLoad: number | null,
  rpe: number
) {
  const exerciseId = exerciseMap.get(exerciseName);

  if (!exerciseId) {
    throw new Error(`Missing exercise seed for ${exerciseName}`);
  }

  return {
    exerciseId,
    exerciseName,
    targetSets,
    repRange,
    targetLoad,
    rpe
  };
}

async function seedMealPlan(recipeMap: Map<string, string>) {
  await prisma.mealPlan.upsert({
    where: { id: "seed-meal-plan-starter" },
    update: {
      weekStart: seedWeekStart,
      status: "active",
      inputConstraints: JSON.stringify({
        source: "seed",
        mode: "rules_only",
        mealsPerDay: 3,
        snacksPerDay: 1,
        allergies: []
      }),
      constraintsHash: "seed-meal-plan-v1",
      hashVersion: 1,
      degraded: true
    },
    create: {
      id: "seed-meal-plan-starter",
      weekStart: seedWeekStart,
      status: "active",
      inputConstraints: JSON.stringify({
        source: "seed",
        mode: "rules_only",
        mealsPerDay: 3,
        snacksPerDay: 1,
        allergies: []
      }),
      constraintsHash: "seed-meal-plan-v1",
      hashVersion: 1,
      degraded: true
    }
  });

  const slots = [
    ["breakfast", "seed-recipe-yogurt-oats"],
    ["lunch", "seed-recipe-chicken-rice-bowl"],
    ["dinner", "seed-recipe-salmon-sweet-potato"],
    ["snack", "seed-recipe-protein-smoothie"]
  ] as const;

  for (let day = 0; day < 7; day += 1) {
    for (const [slot, recipeId] of slots) {
      const alternatingLunch =
        slot === "lunch" && day % 2 === 1 ? "seed-recipe-bean-wrap" : recipeId;
      const finalRecipeId = recipeMap.get(alternatingLunch);

      if (!finalRecipeId) {
        throw new Error(`Missing recipe seed for ${alternatingLunch}`);
      }

      await prisma.plannedMeal.upsert({
        where: { id: `seed-meal-${day}-${slot}` },
        update: {
          planId: "seed-meal-plan-starter",
          day,
          slot,
          recipeId: finalRecipeId,
          servings: 1
        },
        create: {
          id: `seed-meal-${day}-${slot}`,
          planId: "seed-meal-plan-starter",
          day,
          slot,
          recipeId: finalRecipeId,
          servings: 1
        }
      });
    }
  }
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
