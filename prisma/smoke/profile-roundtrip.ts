import { createPrismaClient } from "../client.js";

process.env.DATABASE_URL ??= "file:./prisma/intella.db";

const prisma = createPrismaClient();

async function main() {
  const created = await prisma.profile.create({
    data: {
      age: 37,
      sex: "male",
      heightCm: 180.3,
      weightKg: 82.1,
      timezone: "America/New_York",
      unitSystem: "imperial",
      activityLevel: "very_active"
    }
  });

  const readBack = await prisma.profile.findUniqueOrThrow({
    where: { id: created.id }
  });

  assertEqual(readBack.timezone, "America/New_York", "timezone");
  assertEqual(readBack.unitSystem, "imperial", "unitSystem");
  assertEqual(readBack.activityLevel, "very_active", "activityLevel");

  await prisma.profile.delete({
    where: { id: created.id }
  });

  console.log(
    "Profile round-trip passed with timezone/unitSystem/activityLevel set."
  );
}

function assertEqual(actual: string, expected: string, field: string) {
  if (actual !== expected) {
    throw new Error(`${field} mismatch: expected ${expected}, got ${actual}`);
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
