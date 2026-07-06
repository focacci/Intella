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
//
// The same interception maintains the sync quartet's `version` counter: every
// UPDATE/UPSERT of a syncable row bumps `version` (see `withVersionBump`) so the
// Phase 6 precedence merge can detect a stale-base mid-air collision. Creates
// start at the schema default (0).
//
// Scope note (matters from Phase 2 on): this records only the TOP-LEVEL row of a
// write. A Prisma nested write — e.g. `program.create({ data: { sessions:
// { create: [...] } } })` — logs the parent but NOT the nested children, so
// those child rows would never reach a device via `/sync/pull`. Write syncable
// children as their own top-level operations. Likewise, because each syncable
// write opens its own `base.$transaction`, wrapping several writes in one
// interactive `$transaction` on the EXTENDED client would nest transactions on
// SQLite's single writer — compose multi-row atomic writes on the base client.
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
  const writeArgs = withVersionBump(operation, args);

  // `updateMany` / `deleteMany` only return a count, so resolve the affected row
  // ids up front (before a delete removes them, before an update can move them
  // out of the `where` filter).
  if (operation === "updateMany" || operation === "deleteMany") {
    const rows = await delegate.findMany({
      where,
      select: { id: true, clientId: true }
    });
    const result = await delegate[operation]!(writeArgs);
    await appendChangeLog(tx, model, op, rows);
    return result;
  }

  const result = await delegate[operation]!(writeArgs);
  const rows = affectedRows(result, writeArgs, operation);
  await appendChangeLog(tx, model, op, rows);
  return result;
}

// --------------------------------------------------------------- Version bump

/**
 * Ops whose `data` payload should carry an atomic `version` increment. `upsert`
 * is handled separately (it bumps its `update` branch; the `create` branch
 * starts at the schema default). Creates and deletes never bump.
 */
const VERSION_BUMP_DATA_OPS: ReadonlySet<string> = new Set([
  "update",
  "updateMany",
  "updateManyAndReturn"
]);

/**
 * Advance the sync quartet's `version` on an update/upsert of a syncable row.
 * `version` is a monotonic per-row optimistic-concurrency counter (R3): the
 * Phase 6 push-merge compares a device's `baseVersion` against the server row to
 * detect a mid-air collision, so every server-side update must move it forward.
 * A caller that sets `version` explicitly (e.g. a future sync-apply replaying an
 * authoritative value) is left untouched. Args are copied, never mutated.
 */
function withVersionBump(operation: string, args: unknown): unknown {
  if (!isRecord(args)) {
    return args;
  }

  if (VERSION_BUMP_DATA_OPS.has(operation)) {
    return { ...args, data: withVersionIncrement(args.data) };
  }

  if (operation === "upsert") {
    return { ...args, update: withVersionIncrement(args.update) };
  }

  return args;
}

function withVersionIncrement(data: unknown): unknown {
  if (!isRecord(data) || "version" in data) {
    return data;
  }
  return { ...data, version: { increment: 1 } };
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
