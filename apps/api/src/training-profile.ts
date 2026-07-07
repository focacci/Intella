import type { Prisma, TrainingProfile as PrismaTrainingProfile } from "@prisma/client";

import type { IntellaPrismaClient } from "./db.js";
import { parseStringArray, parseTypedArray } from "./json-fields.js";
import {
  baselineLiftSchema,
  injurySchema,
  type TrainingProfileInput,
  type TrainingProfileResponse
} from "./schemas.js";

/**
 * Read the single training profile. Returns null when none has been written yet
 * (mapped to 404 by the route). Unlike Profile, this row can't be defaulted —
 * experience/daysPerWeek/sessionMins/equipment are required with no schema
 * default — so "not created yet" is a real, distinct state.
 */
export async function getTrainingProfile(
  prisma: IntellaPrismaClient
): Promise<TrainingProfileResponse | null> {
  const row = await findTrainingProfile(prisma);
  return row ? serializeTrainingProfile(row) : null;
}

/** Create or update the single training profile. */
export async function putTrainingProfile(
  prisma: IntellaPrismaClient,
  input: TrainingProfileInput
): Promise<TrainingProfileResponse> {
  const existing = await findTrainingProfile(prisma);
  const data = toTrainingProfileWrite(input);

  const row = existing
    ? await prisma.trainingProfile.update({ where: { id: existing.id }, data })
    : await prisma.trainingProfile.create({ data });

  return serializeTrainingProfile(row);
}

async function findTrainingProfile(prisma: IntellaPrismaClient) {
  return prisma.trainingProfile.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" }
  });
}

// equipment/injuries/baselineLifts are JSON-string columns. injuries and
// baselineLifts are HARD/optional structured data (R9); the Zod input already
// validated them, so we serialize as-is. A create needs the required scalar
// columns, which the Zod input guarantees are present.
function toTrainingProfileWrite(
  input: TrainingProfileInput
): Prisma.TrainingProfileUncheckedCreateInput {
  return {
    experience: input.experience,
    daysPerWeek: input.daysPerWeek,
    sessionMins: input.sessionMins,
    equipment: JSON.stringify(input.equipment),
    injuries: JSON.stringify(input.injuries),
    baselineLifts: JSON.stringify(input.baselineLifts)
  };
}

function serializeTrainingProfile(
  row: PrismaTrainingProfile
): TrainingProfileResponse {
  return {
    id: row.id,
    experience: row.experience as TrainingProfileResponse["experience"],
    daysPerWeek: row.daysPerWeek,
    sessionMins: row.sessionMins,
    equipment: parseStringArray(row.equipment),
    injuries: parseTypedArray(row.injuries, injurySchema),
    baselineLifts: parseTypedArray(row.baselineLifts, baselineLiftSchema)
  };
}
