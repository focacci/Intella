import type { Profile as PrismaProfile } from "@prisma/client";

import type { IntellaPrismaClient } from "./db.js";
import type { ProfileInput, ProfileResponse } from "./schemas.js";

export async function getProfile(
  prisma: IntellaPrismaClient
): Promise<ProfileResponse> {
  const profile = await findProfile(prisma);

  if (profile) {
    return serializeProfile(profile);
  }

  return serializeProfile(
    await prisma.profile.create({
      data: {}
    })
  );
}

export async function putProfile(
  prisma: IntellaPrismaClient,
  input: ProfileInput
): Promise<ProfileResponse> {
  const profile = await findProfile(prisma);
  const data = toProfileWrite(input);

  if (!profile) {
    return serializeProfile(
      await prisma.profile.create({
        data
      })
    );
  }

  return serializeProfile(
    await prisma.profile.update({
      where: {
        id: profile.id
      },
      data
    })
  );
}

async function findProfile(prisma: IntellaPrismaClient) {
  return prisma.profile.findFirst({
    where: {
      deletedAt: null
    },
    orderBy: {
      createdAt: "asc"
    }
  });
}

function toProfileWrite(input: ProfileInput) {
  const data = {
    timezone: input.timezone,
    unitSystem: input.unitSystem,
    activityLevel: input.activityLevel
  };

  return {
    ...data,
    ...(input.age !== undefined ? { age: input.age } : {}),
    ...(input.sex !== undefined ? { sex: input.sex } : {}),
    ...(input.heightCm !== undefined ? { heightCm: input.heightCm } : {}),
    ...(input.weightKg !== undefined ? { weightKg: input.weightKg } : {}),
    ...(input.bodyFat !== undefined ? { bodyFat: input.bodyFat } : {})
  };
}

function serializeProfile(profile: PrismaProfile): ProfileResponse {
  return {
    id: profile.id,
    age: profile.age,
    sex: profile.sex,
    heightCm: profile.heightCm,
    weightKg: profile.weightKg,
    bodyFat: profile.bodyFat,
    timezone: profile.timezone,
    unitSystem: profile.unitSystem as ProfileResponse["unitSystem"],
    activityLevel: profile.activityLevel as ProfileResponse["activityLevel"]
  };
}
