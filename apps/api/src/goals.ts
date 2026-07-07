import type { Goal as PrismaGoal, Prisma } from "@prisma/client";

import type { IntellaPrismaClient } from "./db.js";
import type { GoalInput, GoalResponse } from "./schemas.js";

/** List every live goal, highest priority first (R14), then oldest first. */
export async function listGoals(
  prisma: IntellaPrismaClient
): Promise<GoalResponse[]> {
  const rows = await prisma.goal.findMany({
    where: { deletedAt: null },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
  });

  return rows.map(serializeGoal);
}

export type PutGoalResult =
  | { ok: true; goal: GoalResponse }
  | { ok: false; reason: "not_found" };

/**
 * Upsert one structured goal (R4). With an `id` it updates that goal (404 if it
 * no longer exists); without one it creates a new goal. Multiple goals coexist
 * by calling this repeatedly, each carrying its own `priority` (R14).
 */
export async function putGoal(
  prisma: IntellaPrismaClient,
  input: GoalInput
): Promise<PutGoalResult> {
  const data = toGoalWrite(input);

  if (input.id) {
    const existing = await prisma.goal.findFirst({
      where: { id: input.id, deletedAt: null }
    });
    if (!existing) {
      return { ok: false, reason: "not_found" };
    }

    const updated = await prisma.goal.update({ where: { id: input.id }, data });
    return { ok: true, goal: serializeGoal(updated) };
  }

  const created = await prisma.goal.create({ data });
  return { ok: true, goal: serializeGoal(created) };
}

// `note` is display-only; engines read the structured fields (R4). A PUT is a
// full-resource replace, so unset optionals become null. `status` is only
// written when supplied, so a create falls to the schema default ("active") and
// an update without it leaves the current status untouched.
function toGoalWrite(input: GoalInput): Prisma.GoalUncheckedCreateInput {
  return {
    type: input.type,
    targetKind: input.targetKind,
    targetValue: input.targetValue ?? null,
    targetUnit: input.targetUnit ?? null,
    note: input.note ?? null,
    priority: input.priority,
    ...(input.status !== undefined ? { status: input.status } : {})
  };
}

function serializeGoal(row: PrismaGoal): GoalResponse {
  return {
    id: row.id,
    type: row.type as GoalResponse["type"],
    targetKind: row.targetKind as GoalResponse["targetKind"],
    targetValue: row.targetValue,
    targetUnit: row.targetUnit as GoalResponse["targetUnit"],
    note: row.note,
    priority: row.priority,
    startDate: row.startDate.toISOString(),
    status: row.status as GoalResponse["status"]
  };
}
