# Intella — Phase 0 (Foundations) Review

**Version:** 1.0 · **Date:** July 5, 2026 · **Reviewer:** Claude (Opus 4.8) · **Branch:** `Phase0`

> A code review of Phase 0 against Epic 0 (`Intella_Epics_and_Stories.md`, tickets **T0.1–T0.13**) and the consolidated build plan. It records the verdict, a per-ticket scorecard, every finding with severity, the hardening changes made in response, and the items deliberately deferred (with rationale) so they aren't rediscovered under pressure in a later phase.

---

## 1. Verdict

**Phase 0 is complete to a high standard and unlocks Phase 1.** The monorepo builds, the full v1 schema is migrated and seeded, the OpenAPI contract generates an in-sync TypeScript client, per-device tokens + PIN-gated pairing work, nightly encrypted backups actually round-trip (encrypt → restore → sanity-query), and the whole thing is Docker + Tailscale-Serve deployable. This is a genuinely well-engineered, heavily-documented foundation — not a skeleton with TODOs.

The review found **one** gap worth closing before Phase 1 (an inert `version` counter — precisely the "retrofit onto live data" risk Phase 0 exists to prevent) plus a handful of smaller ones. All four low-risk items were fixed in a follow-up hardening pass (§4); the rest are deferred with rationale (§5).

---

## 2. Verification evidence

| Check | Result (post-hardening) |
|---|---|
| `pnpm test` | **39/39 pass** across 9 suites |
| `pnpm typecheck` | clean (shared → scripts → eval → api → web) |
| `pnpm lint` | clean |
| `pnpm openapi:generate` → git diff | no drift (client regenerates identically) |
| Seed | 26 exercises, 24 ingredients, 21 alias sets, seed program (calibration week + `degraded`), seed meal plan |
| Backup gate (`backup.test.ts`) | encrypted snapshot written, DB stays writable, restore smoke test passes |
| Secrets / DBs committed | none (`.env`, `*.db`, `backups/`, `.backup-key` all gitignored) |

---

## 3. Ticket scorecard (T0.1–T0.13)

| Ticket | Status | Notes |
|---|---|---|
| T0.1 Monorepo & tooling | ✅ | pnpm workspace, strict TS, ESLint/Prettier, root `dev` script |
| T0.2 API skeleton + health | ✅ | Fastify + bearer hook; authed 200 / unauthed 401 |
| T0.3 DB & schema + seed | ✅ | Full v1 core, all R1–R9 fields, `ChangeLog`, `IngredientAlias`; seed + round-trip verified |
| T0.4 OpenAPI + client gen | ✅ | v0.7.0 spec → TS client; profile round-trip test drives the generated client |
| T0.5 Web shell | ✅ | React/Vite/Tailwind/shadcn, all 6 screens, TanStack Query; live `/health`+`/profile`+`/system/status` |
| T0.6 Remote access (Tailscale) | ✅ doc/config | Runbook §1/§5; loopback-only publish |
| T0.7 Backup & restore | ✅ | `VACUUM INTO` → AES-256-GCM → GFS retention → restore smoke test → `BackupRun`; 8 tests |
| T0.8 Migration discipline | ✅ | Committed migrations, pre-migrate snapshot hook, `migrate:verify` dry-run, `db:push` disabled |
| T0.9 Per-device tokens | ✅ | Hashed `ApiToken`, mint/list/revoke, `lastUsedAt` stamp, independent revoke; 3 tests |
| T0.10 `/system/status` | ✅ *(was 🟡)* | Now reads `lastBackupAt` from the newest successful `BackupRun` (fixed — §4.2) |
| T0.11 Sync metadata + `serverSeq` | ✅ | Quartet everywhere; `ChangeLog` extension appends per write; `clientId` unique on event tables; `version` now bumps (fixed — §4.1) |
| T0.12 Docker + setup + pairing | ✅ | compose + multi-stage Dockerfile; setup = migrate+seed+WAL+PIN+QR; `/pair` 403 outside window, single-use; 9 tests |
| T0.13 Tailscale Serve HTTPS | ✅ doc/config | Runbook §4; `publicBaseUrl` feeds the QR |

---

## 4. Findings fixed in the hardening pass

### 4.1 The sync-quartet `version` counter was never incremented *(medium — fixed)*

**Finding.** Every syncable row carries the R3 quartet (`version` / `deletedAt` / `clientId` / `updatedAt`), and `ChangeLog`/`serverSeq` ordering worked — but the per-row `version` optimistic-concurrency counter was **never advanced**. `putProfile` did `update({ data })` with no increment, so `version` sat at `0` forever. That is exactly the "born sync-ready so nothing is retrofitted onto live data" guarantee Phase 0 exists to provide, and Phase 1 is about to multiply write sites (diet/training/goal PUTs + Settings edits).

**Fix.** Folded version-bumping into the existing `ChangeLog` client extension (the natural home — it already re-issues each syncable write inside a transaction). Every `update` / `updateMany` / `updateManyAndReturn` / `upsert` of a syncable row now injects an atomic `version: { increment: 1 }`; creates start at the schema default `0`; an explicitly-supplied `version` (e.g. a future sync-apply replaying an authoritative value) is left untouched. Args are copied, never mutated.
- `apps/api/src/sync/change-log.ts` — `withVersionBump` / `withVersionIncrement`
- Tests: `change-log.test.ts` — "bumps the sync-quartet version on each update, leaving creates at 0"; "respects an explicitly supplied version instead of bumping"

### 4.2 `/system/status` reported a static backup time, not the real one *(low/medium — fixed)*

**Finding.** `buildSystemStatus` was a pure function over env config: `lastBackupAt`/`lastSyncAt` came from `INTELLA_LAST_BACKUP_AT` etc., **never from the DB** — despite the `BackupRun` schema comment explicitly stating *"`GET /system/status.lastBackupAt` reads the newest successful row."* A doc/impl contradiction, and the "honest status" surface could show a stale/fake backup time.

**Fix.** `buildSystemStatus` is now async and reads `lastBackupAt` from the newest successful `BackupRun` (`finishedAt ?? startedAt`), falling back to config then `null`; an explicit test override still wins. `lastSyncAt` deliberately stays config/override-driven — it has no real value to report until the Phase 6 sync engine exists, and inventing one from `ChangeLog.ts` would misrepresent "last synced."
- `apps/api/src/system-status.ts`, `apps/api/src/server.ts`
- Test: `system-status.test.ts` — "surfaces the newest successful backup time from the database" (and ignores a later *failed* run)

### 4.3 `/sync/push` + `/sync/pull` were documented but unrouted *(low — fixed)*

**Finding.** Both endpoints are in `openapi.yaml` (marked *STUB — lands with its phase*) and in the generated client, but the server registered **no route**, so a generated-client call would `404` — ambiguous between "typo" and "not built yet."

**Fix.** Registered both as explicit **501 Not Implemented** stubs (auth still applies — an unauthenticated call `401`s first), and added a reusable `NotImplemented` response to `openapi.yaml` referenced by both operations, so server ↔ spec ↔ client stay aligned. A future phase swaps the `501` for the documented `200`.
- `apps/api/src/server.ts` — `sendNotImplemented`; `openapi.yaml` — `components.responses.NotImplemented` + `501` on both sync ops
- Tests: `sync/stubs.test.ts` — 501 when authed, 401 when not

### 4.4 The API booted with a well-known default token in production *(low — fixed)*

**Finding.** `INTELLA_AUTH_TOKEN` defaults to `"dev-token"`. A forgotten token silently ships a production API protected only by a guessable string (Tailscale + device tokens are the real defense, but this is an avoidable footgun).

**Fix.** Extracted `parseApiConfig(env)` which **refuses to boot** when `NODE_ENV=production` and the token is still `"dev-token"` (or unset → defaulted). Dev/test keep the convenient default.
- `apps/api/src/config.ts` — `parseApiConfig`, `DEFAULT_DEV_TOKEN`
- Tests: `config.test.ts` — 4 cases (prod+default throws, prod+unset throws, prod+strong passes, dev/test allow default)

---

## 5. Deferred — documented, to address in their natural phase

### 5.1 `ChangeLog` extension: nested writes & interactive transactions *(bites Phase 2)*

The extension records only the **top-level** row of a write. A Prisma **nested create** — e.g. `program.create({ data: { sessions: { create: [...] } } })` — logs the parent but **not** the nested `WorkoutSession` children, so those rows would never reach a device via `/sync/pull`. Separately, because each syncable write opens its own `base.$transaction`, wrapping several writes in one interactive `$transaction` on the *extended* client would nest transactions on SQLite's single writer.

**Action taken now:** documented the constraint directly in `change-log.ts` (write syncable children as their own top-level operations; compose multi-row atomic writes on the base client). **To do in Phase 2** when the training generator lands its first multi-row write: either follow the convention or extend the interceptor to walk nested writes. Left as-is now because no Phase 0 code path hits it and the right fix wants a real caller to test against.

### 5.2 `GET /profile` has a write side-effect *(minor — revisit in Phase 1)*

`getProfile` auto-creates an empty `Profile` (which advances `serverSeq`) when none exists — a "read" that mutates. Defensible for a singleton, but Phase 1 onboarding is the first real writer; consider returning an unpersisted default object until the first `PUT`. Not changed now to avoid destabilizing the web Settings screen that reads it.

### 5.3 No CI pipeline yet *(recommended before the codebase grows)*

The gates (`test` / `typecheck` / `lint`) exist and are green, but nothing runs them automatically. Eval-in-CI is formally Phase 5 (T5.4), but a basic build/test gate is worth having now. Tests build their own DB by replaying committed migration SQL (`test-helpers.ts`), so CI needs only install + generate + the three gates. Drop-in workflow:

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main, Phase0] }
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile   # postinstall runs `prisma generate`
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
```

> Not committed as part of this pass because it can't be verified green without a first push (native `better-sqlite3` build, runner specifics). Add it when a GitHub remote is wired up.

### 5.4 `lastSyncAt` remains a placeholder *(by design — Phase 6)*

`GET /system/status.lastSyncAt` stays config/override-driven and defaults to `null`. There is no genuine "last synced" moment until the Phase 6 sync engine exists; it wires up then.

---

## 6. Forward-looking notes for later phases

- **Phase 1** — the four profile endpoints should adopt a single validated write path so the §4.1 `version` bump and Zod-at-the-edge stay uniform as write sites multiply; revisit the §5.2 `GET /profile` side-effect.
- **Phase 2** — resolve §5.1 before the training generator's first multi-row atomic write; this is also where the `constraintsHash`/`hashVersion` (R20b) and the LLM gateway get exercised for real.
- **Phase 6** — the `version` counter (now live) is the basis for the push-merge collision check; `/sync/push`+`/pull` graduate from 501 to the documented 200 contract.

---

*Companion to `Intella_Product_and_Build_Plan.md` and `Intella_Epics_and_Stories.md` (Epic 0). Where this review and those files disagree, the source files + code win and this doc should be corrected.*
