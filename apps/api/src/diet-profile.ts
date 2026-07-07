import type { DietProfile as PrismaDietProfile, Prisma } from "@prisma/client";

import type { IntellaPrismaClient } from "./db.js";
import { parseStringArray, parseTypedObject } from "./json-fields.js";
import { macrosSchema, type DietProfileInput, type DietProfileResponse } from "./schemas.js";

/**
 * Read the single diet profile. Returns null when onboarding hasn't written one
 * yet (the route maps that to 404) — the web treats it as "not filled in yet".
 */
export async function getDietProfile(
  prisma: IntellaPrismaClient
): Promise<DietProfileResponse | null> {
  const row = await findDietProfile(prisma);
  return row ? serializeDietProfile(row) : null;
}

/** Create or update the single diet profile. Only provided fields are written. */
export async function putDietProfile(
  prisma: IntellaPrismaClient,
  input: DietProfileInput
): Promise<DietProfileResponse> {
  const existing = await findDietProfile(prisma);
  const data = toDietProfileWrite(input);

  const row = existing
    ? await prisma.dietProfile.update({ where: { id: existing.id }, data })
    : await prisma.dietProfile.create({ data });

  return serializeDietProfile(row);
}

async function findDietProfile(prisma: IntellaPrismaClient) {
  return prisma.dietProfile.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" }
  });
}

// kcal + macros are engine-computed (Phase 3), never accepted from a client, so
// they are absent from the input and untouched here. Arrays are stored as JSON
// strings (schema.prisma). Only keys present in the input are written, so a
// partial PUT leaves the rest of the row intact.
function toDietProfileWrite(input: DietProfileInput): Prisma.DietProfileUncheckedCreateInput {
  const data: Prisma.DietProfileUncheckedCreateInput = {};

  if (input.pattern !== undefined) data.pattern = input.pattern;
  if (input.restrictions !== undefined) data.restrictions = JSON.stringify(input.restrictions);
  if (input.allergies !== undefined) data.allergies = JSON.stringify(input.allergies);
  if (input.dislikes !== undefined) data.dislikes = JSON.stringify(input.dislikes);
  if (input.cuisines !== undefined) data.cuisines = JSON.stringify(input.cuisines);
  if (input.cookingSkill !== undefined) data.cookingSkill = input.cookingSkill;
  if (input.effortMax !== undefined) data.effortMax = input.effortMax;
  if (input.budgetWeekly !== undefined) data.budgetWeekly = input.budgetWeekly;
  if (input.mealsPerDay !== undefined) data.mealsPerDay = input.mealsPerDay;
  if (input.snacksPerDay !== undefined) data.snacksPerDay = input.snacksPerDay;
  if (input.batchCooking !== undefined) data.batchCooking = input.batchCooking;
  if (input.variety !== undefined) data.variety = input.variety;

  return data;
}

function serializeDietProfile(row: PrismaDietProfile): DietProfileResponse {
  return {
    id: row.id,
    pattern: row.pattern,
    restrictions: parseStringArray(row.restrictions),
    allergies: parseStringArray(row.allergies),
    dislikes: parseStringArray(row.dislikes),
    cuisines: parseStringArray(row.cuisines),
    cookingSkill: row.cookingSkill as DietProfileResponse["cookingSkill"],
    effortMax: row.effortMax,
    kcal: row.kcal,
    macros: parseTypedObject(row.macros, macrosSchema),
    budgetWeekly: row.budgetWeekly,
    mealsPerDay: row.mealsPerDay,
    snacksPerDay: row.snacksPerDay,
    batchCooking: row.batchCooking,
    variety: row.variety as DietProfileResponse["variety"]
  };
}
