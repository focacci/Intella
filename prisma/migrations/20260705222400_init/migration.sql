-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "age" INTEGER,
    "sex" TEXT,
    "heightCm" REAL,
    "weightKg" REAL,
    "bodyFat" REAL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "unitSystem" TEXT NOT NULL DEFAULT 'metric',
    "activityLevel" TEXT NOT NULL DEFAULT 'moderate',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "clientId" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL DEFAULT 'outcome',
    "targetValue" REAL,
    "targetUnit" TEXT,
    "note" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "startDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "clientId" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TrainingProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experience" TEXT NOT NULL,
    "daysPerWeek" INTEGER NOT NULL,
    "sessionMins" INTEGER NOT NULL,
    "equipment" TEXT NOT NULL,
    "injuries" TEXT NOT NULL DEFAULT '[]',
    "baselineLifts" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "clientId" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DietProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pattern" TEXT,
    "restrictions" TEXT NOT NULL DEFAULT '[]',
    "allergies" TEXT NOT NULL DEFAULT '[]',
    "dislikes" TEXT NOT NULL DEFAULT '[]',
    "cuisines" TEXT NOT NULL DEFAULT '[]',
    "cookingSkill" TEXT,
    "effortMax" INTEGER,
    "kcal" INTEGER,
    "macros" TEXT,
    "budgetWeekly" REAL,
    "mealsPerDay" INTEGER NOT NULL DEFAULT 3,
    "snacksPerDay" INTEGER NOT NULL DEFAULT 1,
    "batchCooking" BOOLEAN NOT NULL DEFAULT true,
    "variety" TEXT NOT NULL DEFAULT 'moderate',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "clientId" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "primaryMuscles" TEXT NOT NULL,
    "secondaryMus" TEXT NOT NULL DEFAULT '[]',
    "equipment" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "goalType" TEXT NOT NULL,
    "split" TEXT NOT NULL,
    "weeks" INTEGER NOT NULL,
    "progressionScheme" TEXT NOT NULL,
    "inputConstraints" TEXT NOT NULL,
    "constraintsHash" TEXT,
    "hashVersion" INTEGER,
    "calibrationWeeks" INTEGER NOT NULL DEFAULT 0,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "clientId" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WorkoutSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "weekNo" INTEGER NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "plannedItems" TEXT NOT NULL,
    "coachingNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "clientId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkoutSession_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SetLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "setNo" INTEGER NOT NULL,
    "reps" INTEGER,
    "weight" REAL,
    "rpe" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "clientId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SetLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SetLog_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BodyMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "weightKg" REAL,
    "bodyFat" REAL,
    "measurements" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "clientId" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ingredients" TEXT NOT NULL,
    "steps" TEXT NOT NULL,
    "macrosPerServ" TEXT NOT NULL,
    "costEst" REAL,
    "timeMins" INTEGER,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "sourceId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'spoonacular',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalName" TEXT NOT NULL,
    "defaultUnit" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "aisleOrder" INTEGER,
    "densityGPerMl" REAL,
    "gramsPerPiece" REAL,
    "nutritionRef" TEXT,
    "providerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "IngredientAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alias" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IngredientAlias_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MealPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "weekStart" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "inputConstraints" TEXT NOT NULL,
    "constraintsHash" TEXT,
    "hashVersion" INTEGER,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "clientId" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PlannedMeal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "slot" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "servings" REAL NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "clientId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlannedMeal_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MealPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlannedMeal_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PantryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ingredientId" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "clientId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PantryItem_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroceryList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "clientId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GroceryList_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MealPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroceryListItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listId" TEXT NOT NULL,
    "ingredientId" TEXT,
    "displayName" TEXT NOT NULL,
    "qty" REAL,
    "unit" TEXT,
    "category" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "sourceMeals" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "clientId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GroceryListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "GroceryList" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroceryListItem_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domain" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "structured" TEXT,
    "freeText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'raw',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "clientId" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ChangeLog" (
    "serverSeq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tableName" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "clientId" TEXT,
    "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_name_key" ON "Exercise"("name");

-- CreateIndex
CREATE INDEX "WorkoutSession_date_idx" ON "WorkoutSession"("date");

-- CreateIndex
CREATE INDEX "WorkoutSession_status_idx" ON "WorkoutSession"("status");

-- CreateIndex
CREATE INDEX "SetLog_sessionId_idx" ON "SetLog"("sessionId");

-- CreateIndex
CREATE INDEX "SetLog_exerciseId_idx" ON "SetLog"("exerciseId");

-- CreateIndex
CREATE INDEX "BodyMetric_date_idx" ON "BodyMetric"("date");

-- CreateIndex
CREATE INDEX "Recipe_sourceId_idx" ON "Recipe"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_canonicalName_key" ON "Ingredient"("canonicalName");

-- CreateIndex
CREATE INDEX "Ingredient_category_idx" ON "Ingredient"("category");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientAlias_alias_key" ON "IngredientAlias"("alias");

-- CreateIndex
CREATE INDEX "IngredientAlias_ingredientId_idx" ON "IngredientAlias"("ingredientId");

-- CreateIndex
CREATE INDEX "MealPlan_weekStart_idx" ON "MealPlan"("weekStart");

-- CreateIndex
CREATE INDEX "PlannedMeal_planId_idx" ON "PlannedMeal"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "PlannedMeal_planId_day_slot_key" ON "PlannedMeal"("planId", "day", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "PantryItem_ingredientId_key" ON "PantryItem"("ingredientId");

-- CreateIndex
CREATE INDEX "GroceryList_planId_idx" ON "GroceryList"("planId");

-- CreateIndex
CREATE INDEX "GroceryListItem_listId_idx" ON "GroceryListItem"("listId");

-- CreateIndex
CREATE INDEX "GroceryListItem_category_idx" ON "GroceryListItem"("category");

-- CreateIndex
CREATE INDEX "Feedback_domain_idx" ON "Feedback"("domain");

-- CreateIndex
CREATE INDEX "Feedback_refType_refId_idx" ON "Feedback"("refType", "refId");

-- CreateIndex
CREATE INDEX "ChangeLog_tableName_rowId_idx" ON "ChangeLog"("tableName", "rowId");
