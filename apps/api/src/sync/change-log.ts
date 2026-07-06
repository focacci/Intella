import { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// ChangeLog / serverSeq mechanism (T0.11 · R2 · R3)
//
// The single append-only `ChangeLog` table is the sync cursor: its autoincrement
// PK IS the monotonic `serverSeq`. Every mutating write to a *syncable* table
// appends exactly one `ChangeLog` row, so any write advances `serverSeq`.
//
// This is implemented as a Prisma Client extension that intercepts write
// operations. For a syncable write it opens an interactive transaction on the
// *base* (unextended) client, re-issues the operation there, and appends the
// `ChangeLog` row in the same transaction — so the row and its cursor advance
// atomically, and the write is never recorded without its log entry (or vice
// versa). Re-issuing on the base client also means the inner delegate call does
// NOT re-enter this extension, so there is no recursion to guard against.
// ---------------------------------------------------------------------------

/**
 * The R3 syncable tables — the set that carries the sync quartet
 * (`version` / `deletedAt` / `clientId` / `updatedAt`). Reference/content tables
 * (`Exercise`, `Recipe`, `Ingredient`, `IngredientAlias`) are server-seeded and
 * NOT syncable; local-only tables (`ApiToken`, `BackupRun`) and the `ChangeLog`
 * itself never appear here.
 */
export const SYNCABLE_MODELS: ReadonlySet<string> = new Set([
  "Profile",
  "Goal",
  "TrainingProfile",
  "DietProfile",
  "Program",
  "WorkoutSession",
  "SetLog",
  "BodyMetric",
  "MealPlan",
  "PlannedMeal",
  "PantryItem",
  "GroceryList",
  "GroceryListItem",
  "Feedback"
]);

const WRITE_OPS: ReadonlySet<string> = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany"
]);

const DELETE_OPS: ReadonlySet<string> = new Set(["delete", "deleteMany"]);

export type ChangeOp = "upsert" | "delete";

type AffectedRow = { id: string; clientId: string | null };

// A Prisma transaction client indexed by delegate name for dynamic dispatch.
type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type WriteDelegate = {
  findMany: (args: unknown) => Promise<AffectedRow[]>;
  [op: string]: (args: unknown) => Promise<unknown>;
};

/**
 * Wrap a base `PrismaClient` so every mutating write to a syncable table appends
 * a `ChangeLog` row in the same transaction. Returns the extended client used by
 * the whole API.
 */
export function withChangeLog(base: PrismaClient) {
  return base.$extends({
    name: "changelog",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !SYNCABLE_MODELS.has(model) || !WRITE_OPS.has(operation)) {
            return query(args);
          }

          return base.$transaction((tx) => applyWrite(tx, model, operation, args));
        }
      }
    }
  });
}

async function applyWrite(
  tx: TxClient,
  model: string,
  operation: string,
  args: unknown
): Promise<unknown> {
  const delegate = delegateFor(tx, model);
  const op: ChangeOp = DELETE_OPS.has(operation) ? "delete" : "upsert";
  const where = readWhere(args);

  // `updateMany` / `deleteMany` only return a count, so resolve the affected row
  // ids up front (before a delete removes them, before an update can move them
  // out of the `where` filter).
  if (operation === "updateMany" || operation === "deleteMany") {
    const rows = await delegate.findMany({
      where,
      select: { id: true, clientId: true }
    });
    const result = await delegate[operation]!(args);
    await appendChangeLog(tx, model, op, rows);
    return result;
  }

  const result = await delegate[operation]!(args);
  const rows = affectedRows(result, args, operation);
  await appendChangeLog(tx, model, op, rows);
  return result;
}

async function appendChangeLog(
  tx: TxClient,
  model: string,
  op: ChangeOp,
  rows: AffectedRow[]
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  await tx.changeLog.createMany({
    data: rows.map((row) => ({
      tableName: model,
      rowId: row.id,
      op,
      clientId: row.clientId
    }))
  });
}

/**
 * Derive the affected `{ id, clientId }` rows from a write result. Single-row
 * writes (`create`/`update`/`upsert`/`delete`) return the row; `*AndReturn`
 * variants return an array; `createMany` returns only a count, so fall back to
 * any ids supplied in the write payload. As a last resort for a single
 * `update`/`delete`, use an id addressed directly in the `where` clause.
 */
function affectedRows(
  result: unknown,
  args: unknown,
  operation: string
): AffectedRow[] {
  if (Array.isArray(result)) {
    return result.filter(isRowWithId).map(toAffectedRow);
  }

  if (isRowWithId(result)) {
    return [toAffectedRow(result)];
  }

  const payload = readData(args);
  const entries = Array.isArray(payload) ? payload : payload ? [payload] : [];
  const fromPayload = entries.filter(isRowWithId).map(toAffectedRow);

  if (fromPayload.length > 0) {
    return fromPayload;
  }

  if (operation === "update" || operation === "delete") {
    const whereId = readWhereId(args);
    if (whereId) {
      return [{ id: whereId, clientId: null }];
    }
  }

  return [];
}

function delegateFor(tx: TxClient, model: string): WriteDelegate {
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  return (tx as unknown as Record<string, WriteDelegate>)[key]!;
}

function isRowWithId(value: unknown): value is { id: string; clientId?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof (value as { id: unknown }).id === "string"
  );
}

function toAffectedRow(row: { id: string; clientId?: unknown }): AffectedRow {
  return {
    id: row.id,
    clientId: typeof row.clientId === "string" ? row.clientId : null
  };
}

function readWhere(args: unknown): unknown {
  return isRecord(args) ? args.where : undefined;
}

function readWhereId(args: unknown): string | undefined {
  const where = readWhere(args);
  if (isRecord(where) && typeof where.id === "string") {
    return where.id;
  }
  return undefined;
}

function readData(args: unknown): unknown {
  return isRecord(args) ? args.data : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
