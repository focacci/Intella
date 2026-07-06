# Migration Discipline (T0.8)

Intella stores irreplaceable, single-user history. Schema changes must never put
that data at risk. This document is the operating procedure.

## Non-negotiables

1. **Prisma Migrate with committed migrations.** Every schema change is a
   reviewed, committed `prisma/migrations/<timestamp>_<name>/migration.sql`.
   Migrations are the source of truth for how the database was built; the test
   database is rebuilt by replaying them in order.
2. **Never `db push` on real data.** `db push` mutates the schema with no
   migration record and no history — a silent, unrepeatable change. It is
   disabled: `pnpm db:push` fails with a pointer here. Use `pnpm prisma:migrate`.
3. **A snapshot precedes every migration.** `pnpm prisma:migrate` runs the
   pre-migrate hook first (`pnpm pre-migrate`), which takes a fresh encrypted
   snapshot (T0.7 / R21) of the live DB. A failed snapshot aborts the migration —
   we never migrate data we could not first back up. On an empty/new database the
   hook is a clean no-op.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm prisma:migrate` | Snapshot → `prisma migrate dev` (interactive; creates + applies a new migration in development). |
| `pnpm prisma:migrate:deploy` | Snapshot → `prisma migrate deploy` (non-interactive; applies committed migrations, e.g. in Docker/CI). |
| `pnpm migrate:verify` | Restores the **latest snapshot** to a throwaway DB and runs `migrate deploy` against it — a dry-run of the committed migrations (including any new one) against a copy of real, production-shaped data. |
| `pnpm db:push` | Disabled. Fails on purpose. |

### Adding a migration — the safe loop

1. Edit `schema.prisma`.
2. `pnpm prisma:migrate` — this snapshots first, then generates + applies the
   migration and regenerates the client.
3. Commit the new `prisma/migrations/**` folder alongside the schema change.
4. Before deploying to the live machine, run `pnpm migrate:verify` to prove the
   new migration applies cleanly to a restore of the latest snapshot.

> Note: the current toolchain (Prisma 7 + driver adapter) makes `migrate dev`
> interactive-only. In non-interactive contexts a migration is authored with
> `prisma migrate diff --from-config-datasource --to-schema schema.prisma
> --script` into a new `prisma/migrations/<timestamp>_<name>/migration.sql`, then
> applied with `pnpm prisma:migrate:deploy`.

## Expand / contract (non-additive changes)

Additive changes (new table, new nullable column, new index) are a single
migration — apply and move on. **Renames, type changes, drops, and new NOT NULL
columns are destructive if done in one step.** Split them across releases so the
running app is always compatible with the database on disk:

1. **Expand.** Add the new shape *alongside* the old. New column is nullable (or
   defaulted); new table coexists; the writer starts writing both.
2. **Backfill.** Migrate existing rows into the new shape (a data migration or a
   one-off script). Reads prefer the new shape, falling back to the old.
3. **Contract.** Once every row is migrated and no code reads the old shape,
   a later migration drops the old column/table (or adds the NOT NULL
   constraint).

Each of the three is its own committed migration. Never rename in place: model
it as *add new → backfill → drop old*. This keeps every deploy reversible to the
pre-migration snapshot and never breaks a client that is mid-sync.

## If a migration goes wrong

The pre-migrate snapshot is the recovery point. Decrypt and restore it
(`restoreSnapshot`, or boot against it as `pnpm backup:smoke` demonstrates),
verify with sanity queries, then re-apply corrected migrations. Restore + re-pair
is the documented disaster-recovery path (R21).
