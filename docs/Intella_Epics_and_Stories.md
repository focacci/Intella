# Intella — Epics & Stories (Build Hand-off)

**Version:** 0.9 (web-first build order) · **Date:** July 5, 2026 (build order revised 2026-07-27) · **Status:** Web track in progress. One epic per phase (0–16); the **build sequence is now web-first** — see *Revised build order* in the Global Build Context.

*Companion to `Intella_Product_and_Build_Plan.md` (the consolidated spine). This document is the build hand-off: **17 phase-scoped epics**, each a self-contained brief a coding agent can build in one shot.*

---

## How to use this document

Each epic corresponds to exactly one build phase and is **self-contained**: it states the outcome, the user stories, and an embedded **context pack** — the schema models, API endpoints, preflight resolutions (Rxx), and key algorithms that phase needs — plus tickets with acceptance criteria and a definition of done.

**To hand a phase to a coding agent:** paste the **Global Build Context** block below, then the single epic for that phase. Together they are enough to build the phase without reading the other companion documents. The agent should also have the repo's `schema.prisma` and `openapi.yaml` on hand (the epic tells it which slice matters); where an epic and those files ever disagree, the files win and the epic should be corrected.

**Conventions in every epic:**
- *Stories* are in Michael's voice — "As Michael, I want … so that …".
- *Context pack → Schema* uses compact Prisma-style field lists; the authoritative definitions live in `schema.prisma`.
- *Tickets* use the id scheme from the build plan (`T<phase>.<n>`); *AC* = acceptance criteria.
- *Rxx* pointers reference `Intella_Preflight_Resolutions.md`.

---

## Global Build Context (read once, prepend to every epic)

**Product.** Intella is a single-user, self-hosted, adaptive coach: training + meal planning + a store-agnostic grocery list, later extended with adaptive intelligence and ambient (sensor) capture. One user, one profile, private on the tailnet, **explainable** (every generated artifact stores the `inputConstraints` that produced it). Nothing is ever a generic template.

**Posture (never violate).** Single-user (no tenancy, no user system). Self-hosted on the user's desktop, reached from iPhone over **Tailscale** (bearer auth). Allergies and injuries are **hard constraints the LLM can never override**. The app **never hard-stops** — it degrades to last-known-good, marks what's provisional with confidence/provenance, and reconciles when reality returns.

**Stack.**
- *Backend:* TypeScript · Fastify · Prisma 7 (URL in `prisma.config.ts`) · SQLite (WAL) · Zod validation · Anthropic SDK behind an LLM gateway.
- *Web:* React + Vite · Tailwind + shadcn/ui · TanStack Query + Router · API client generated from OpenAPI.
- *iOS (deferred — native track; see "Revised build order" below):* SwiftUI · GRDB local store · Swift client generated from the same OpenAPI spec · Watch app for in-workout logging. **Not built until the entire web track (Phases 0–5 and 7–11) ships.**

**Repo (pnpm monorepo).**
```
intella/
  openapi.yaml            # single source of truth for both clients
  schema.prisma           # data model (Prisma 7)
  prisma.config.ts        # connection config
  compose.yaml            # Docker deployment
  apps/api/               # Fastify + Prisma + engines
  apps/web/               # React + Vite
  packages/shared/        # generated TS types/client, shared logic
  packages/eval/          # golden-set quality harness (dev-time)
  ios/                    # SwiftUI + Watch (Phase 6)
```

**Engines (in `apps/api/`), each a pure, unit-testable module.** `training/`, `nutrition/`, `grocery/` expose `computeConstraints()` / `generate()` / `validate()`. Later: `estimation/` (scheduler-driven), `capture/`, `llm/` (gateway), `ops/`, `safety/`, `sync/`, and dev-time `eval/`.

**The three-layer generator pattern (every generator, every horizon node).**
1. **Rules (deterministic):** compute hard constraints + numeric targets. Safety floors live here.
2. **LLM:** choose within constraints (variety, phrasing, parsing free text). Returns tool-use JSON against a published, versioned schema.
3. **Validator (deterministic):** reject/repair violations before persisting.

**The generate → validate → repair loop (R10).** LLM JSON → validator → on violation re-prompt with the specific violations (**max 2 repairs**) → still invalid → deterministic **degraded** fallback (rules-only / seed / last-known-good), persisted with `degraded = true` + reason. **Never save invalid output; never hard-stop.** Provider/transport errors get separate retry-with-backoff.

**The LLM gateway (from Phase 2 on).** Generators call `llm.generate(spec)`, never the SDK directly. The gateway does **cache-check → route → call → validate + log**: look up `hash(inputConstraints)` (canonical serialization — sorted keys, floats→4 dp, explicit inclusion list covering referenced `PreferenceWeight`/`DietProfile`/`TrainingProfile`/`Goal` id+`updatedAt`; store `constraintsHash`/`hashVersion`, R20b); route routine→local model (Ollama), hard/creative→Claude; run the validator on either route; log an `LlmCall`. Enforces **degraded modes**: Full → Rules+local → Rules-only.

**Data-model conventions.**
- Storage is **metric-canonical** (kg, cm, g, ml, kcal); `Profile.unitSystem` is display-only (R6).
- SQLite has no arrays/JSON, so list/blob fields are `String` holding JSON, doc-commented with their shape and parsed by Zod. (Postgres later = one mechanical pass.)
- **Sync quartet** on every syncable row: `version Int`, `deletedAt DateTime?`, `clientId String?`, `updatedAt DateTime` (R3). Reference/content tables (`Exercise`, `Recipe`, `Ingredient`, `IngredientAlias`) are server-seeded/cached and are **not** syncable.
- Ordering: one append-only **`ChangeLog`** (PK = autoincrement `serverSeq`); every mutating write appends a row; `GET /sync/pull?since=` reads it (R2).
- Polymorphic refs = discriminated `{refType, refId}` (closed enum; no cross-table FK); same-table trees = self-relation FK; id arrays = advisory JSON (R3).
- Every generated artifact stores `inputConstraints` (explainability) + `constraintsHash`/`hashVersion` (cache).

**Coding conventions.** TypeScript strict. **OpenAPI-first** — define the route in `openapi.yaml`, regenerate the client, then implement. Zod schemas mirror the OpenAPI request/response shapes. **Prisma Migrate** with committed migration files, never `db push` on real data; expand/contract for non-additive changes; a pre-migrate backup hook. Pure engine logic is unit-tested exhaustively (that's where safety lives); LLM output is checked by property assertions, not exact matches.

**Revised build order (web-first — supersedes strict numeric phase order).** Phase *numbers* stay stable identifiers (ticket ids, R-pointers, cross-references), but the **build sequence is web-first**: ship everything that runs in the browser before writing any native code. HealthKit and every other iOS/watchOS feature are deferred until the web track is complete.

- **Web track — build now** *(no Apple Developer license required; the web UI is reached from the iPhone's **browser** over Tailscale, so it is fully testable away from home with no cable):* Phase 0 → 1 → 2 → 3 → 4 → 5, then **Phase 7 → 8 → 9 → 10 → 11**. The adaptive-intelligence phases (7–11) are server-side engines surfaced on web dashboards (Position / Trajectory / Horizon); they depend only on Phases 2–4 logging — **not** on the Phase 6 native app — so they slot in immediately after Phase 5.
- **Native track — deferred** *(needs the paid Apple Developer Program + a Mac with Xcode + your devices on hand):* **Phase 6** (SwiftUI/Watch app, offline sync, TestFlight), then **Phase 12 → 13 → 14 → 15 → 16** (HealthKit/CoreMotion ambient capture). Build **none** of these until the web track above is done.

The native track waits on exactly the things the web track doesn't need (a developer license, a Mac, physical devices) — which is the point of building web-first.

---

# Web track (build now) · Phases 0–5 — The web prototype

---

## Epic 0 — Foundations

**Phase 0 · Stand up the whole skeleton so every later phase has a schema, a contract, a shell, and a safe place to run.**

**Build outcome (definition of done).** A pnpm monorepo with a running Fastify API (per-device bearer auth, `GET /health`, `GET /system/status`), the **complete** Prisma schema migrated to SQLite (WAL) with seed data, an `openapi.yaml` that generates the TypeScript client, and a React web shell that navigates to all six screen stubs. Nightly encrypted backups run with a restore test; the API ships as a Docker Compose bundle whose `setup` seeds and renders a PIN-gated pairing QR; it's reachable from the iPhone over Tailscale with HTTPS. No feature logic yet — but the schema is born sync-ready, timezone/units-aware, and canonicalization-ready, so nothing downstream is ever retrofitted onto live data.

**Depends on:** — · **Unlocks:** every phase.

### Stories
- As Michael, I want the repo, database, and API contract scaffolded so every later phase builds on a stable foundation.
- As Michael, I want the schema born sync-ready and timezone/units-aware so I never have to retrofit columns onto real data.
- As Michael, I want to reach the API privately from my iPhone over Tailscale with HTTPS so the native app can connect later with no security workarounds.
- As Michael, I want a consistent nightly backup that's actually restore-tested so my irreplaceable history is safe from day one.
- As Michael, I want to deploy with one command and pair my phone by scanning a QR, so setup isn't a 40-character-token chore.

### Context pack

**Schema (this phase migrates the *entire* v1 core — full definitions in `schema.prisma`).** Model inventory: `Profile`, `Goal`, `TrainingProfile`, `DietProfile`, `Exercise`, `Program`, `WorkoutSession`, `SetLog`, `BodyMetric`, `Recipe`, `Ingredient`, `IngredientAlias`, `MealPlan`, `PlannedMeal`, `PantryItem`, `GroceryList`, `GroceryListItem`, `Feedback`, `ChangeLog`. The preflight fields that MUST be present in the first migration:

```prisma
model Profile {
  id            String   @id @default(cuid())
  age Int?  sex String?  heightCm Float?  weightKg Float?  bodyFat Float?
  timezone      String   @default("UTC")       // IANA — defines "today" (R1)
  unitSystem    String   @default("metric")    // display only; storage metric (R6)
  activityLevel String   @default("moderate")  // TDEE seed (R7)
  createdAt DateTime @default(now())
  version Int @default(0)  deletedAt DateTime?  clientId String?  updatedAt DateTime @updatedAt  // sync quartet (R3)
}
model Goal {                                    // structured target (R4) + priority (R14)
  id String @id @default(cuid())  type String
  targetKind String @default("outcome")  // "rate"|"absolute"|"outcome"
  targetValue Float?  targetUnit String?  note String?   // note = display only; engines read structured
  priority Int @default(1)  startDate DateTime @default(now())  status String @default("active")
  createdAt DateTime @default(now())
  version Int @default(0)  deletedAt DateTime?  clientId String?  updatedAt DateTime @updatedAt
}
model Feedback {                                // user-authored signal ONLY (R5)
  id String @id @default(cuid())  domain String
  refType String?  refId String?               // discriminated ref (R3)
  structured String?  freeText String?  status String @default("raw")  // "raw"|"parsed"
  createdAt DateTime @default(now())
  version Int @default(0)  deletedAt DateTime?  clientId String?  updatedAt DateTime @updatedAt
  @@index([refType, refId])
}
model Ingredient {                              // canonicalization core (R8) — reference data, NOT syncable
  id String @id @default(cuid())  canonicalName String @unique  defaultUnit String  category String
  aisleOrder Int?  densityGPerMl Float?  gramsPerPiece Float?    // volume/count ↔ weight
  nutritionRef String?  providerId String?  aliases IngredientAlias[]
}
model IngredientAlias { id String @id @default(cuid())  alias String @unique  ingredientId String  source String @default("manual") }
model ChangeLog {                               // the single sync cursor (R2)
  serverSeq Int @id @default(autoincrement())   // IS the monotonic cursor
  tableName String  rowId String  op String     // "upsert"|"delete"
  clientId String?  ts DateTime @default(now())
  @@index([tableName, rowId])
}
```
`TrainingProfile.baselineLifts String @default("[]")` and `Program.calibrationWeeks Int @default(0)` (R9) also land now. Every syncable table carries the R3 quartet; `Program`/`MealPlan` carry `inputConstraints` + `constraintsHash`/`hashVersion` (R20b) + `degraded` (R10). Reference tables (`Exercise`, `Recipe`, `Ingredient`, `IngredientAlias`) omit the quartet.

**API (scaffold surface — full spec in `openapi.yaml`, already at v0.7.0).** Implement now: `GET /health` (authed 200 / unauthed 401), `GET /system/status` (skeleton: `mode`, LLM up/down, provider up/down, `lastBackupAt`, `lastSyncAt`, `spendMTD`), `GET/PUT /profile` (proves the contract → client → DB round-trip), `GET/POST/DELETE /auth/tokens`, and stubs for `POST /sync/push` · `GET /sync/pull?since=` · `GET /pair`.

**Resolutions in force:** **R1** timezone/UTC · **R2** `ChangeLog`=`serverSeq` · **R3** sync quartet + `{refType,refId}` · **R4** structured goal · **R5** Feedback authored · **R6** metric + `unitSystem` · **R7** activityLevel · **R8** ingredient density/alias fields · **R9** baselineLifts/calibrationWeeks fields · **R21** OS-agnostic encrypted backups · **R22** PIN-gated `/pair`.

**Seed data (R18).** `Exercise` library (compound + accessory, tagged muscle/equipment/pattern); `Ingredient`→aisle map with density/piece seeds (from USDA FoodData Central portion data + a curated table) and common `IngredientAlias` rows; a built-in deterministic **seed program** and **seed meal plan** for the blank-slate + LLM-down cell. The real *profile* comes from onboarding, not the seed.

### Tickets
**T0.1 Monorepo & tooling.** pnpm workspace (`apps/api`, `apps/web`, `packages/shared`, `packages/eval`); TS strict; ESLint/Prettier; root `dev` script. *AC:* `pnpm install` + `pnpm dev` starts api and web; shared imports resolve.

**T0.2 API skeleton + healthcheck.** Fastify server, env config, bearer-auth middleware, `GET /health`. *AC:* authed `GET /health` → 200; unauthed → 401.

**T0.3 Database & schema.** Prisma + SQLite (WAL); migrate **all** §7 entities incl. every R1–R9 field, `ChangeLog`, `IngredientAlias`; seed script (exercises, ingredient→aisle + density/alias, seed program/meal plan). *AC:* `prisma migrate` creates the DB; seed inserts the exercise library, ingredient map, and seed plans; a sample `Profile` round-trips with `timezone`/`unitSystem`/`activityLevel` set.

**T0.4 OpenAPI scaffold + client gen.** `openapi.yaml` (health + profile + system/status) generates the TS client into `packages/shared`. *AC:* the generated client calls `/health` and `GET/PUT /profile` from web successfully.

**T0.5 Web shell.** React+Vite+Tailwind+shadcn; layout with nav to all six screens (stubs); TanStack Query provider + generated client wired. *AC:* nav renders; each route loads its stub; a live `/health` call succeeds from the shell.

**T0.6 Remote access.** Document/configure Tailscale; API reachable from iPhone Safari over MagicDNS. *AC:* a phone on the tailnet loads `/health` from the desktop API.

**T0.7 Backup & restore (OS-agnostic, R21).** Nightly job: enable WAL; `VACUUM INTO` a dated snapshot; **app-level symmetric encryption** (key in Keychain/DPAPI/libsecret); prune to retention (≈30 daily + monthly); read-only restore smoke test; write a `BackupRun` row; `setup` warns if the backup dir lacks encryption/offsite coverage. *AC:* a snapshot appears nightly while the DB stays writable; a deliberately induced restore of yesterday's snapshot boots the API and passes sanity queries.

**T0.8 Migration discipline.** Prisma Migrate with committed migrations; a pre-migrate hook that triggers a fresh snapshot; document expand/contract. *AC:* a sample additive migration runs against a restored copy of the latest snapshot; `db push` is disabled in scripts.

**T0.9 Per-device tokens.** `ApiToken` table (hashed); mint/list/revoke endpoints; auth middleware validates against it and stamps `lastUsedAt`. *AC:* two device tokens authenticate; revoking one 401s that token while the other still works.

**T0.10 `GET /system/status` degraded-mode surface (skeleton).** Return `mode:{full|rules_local|rules_only}`, LLM up/down, provider up/down, `lastBackupAt`, `lastSyncAt`, `spendMTD` vs ceiling. *AC:* returns a well-formed status object; `mode` reflects a forced-local/forced-rules toggle.

**T0.11 Sync metadata + `serverSeq`.** The R3 quartet on every syncable entity + the `ChangeLog`/`serverSeq` mechanism; middleware appends a `ChangeLog` row on every mutating write; regenerate OpenAPI + clients. *AC:* every syncable entity carries its columns; any write advances `serverSeq`; `clientId` is unique on event tables (`SetLog`/`BodyMetric`/`Feedback`).

**T0.12 Dockerized deployment + first-run setup (R22).** `compose.yaml` (`restart: unless-stopped`, bind-mounted `~/Documents/Intella`, optional Ollama service); `setup` entrypoint = WAL + migrate + seed + mint token + **open a time-boxed pairing window, print a short-lived PIN, render a pairing QR** (base URL + PIN). *AC:* `docker compose up` on a clean machine yields a reachable, seeded API and a scannable pairing QR; `/pair` returns 403 outside the window; data survives `down`/`up`.

**T0.13 Tailscale Serve HTTPS.** Document + optional serve config for TLS at the tailnet name. *AC:* API reachable at `https://…ts.net`; a client connects with no ATS exception.

### One-shot build checklist
- [ ] Monorepo builds; `pnpm dev` runs api + web together.
- [ ] Full schema migrated with all R1–R9 fields, `ChangeLog`, `IngredientAlias`; seed populates exercises, ingredient map, seed plans.
- [ ] OpenAPI generates the TS client; `/health`, `/system/status`, `GET/PUT /profile` work end-to-end.
- [ ] Web shell navigates all six stubs.
- [ ] Per-device tokens mint/revoke; every write advances `serverSeq`.
- [ ] Nightly encrypted backup + restore test writes a `BackupRun`.
- [ ] `docker compose up` seeds and renders a PIN-gated pairing QR; reachable at the HTTPS tailnet name from the iPhone.

---

## Epic 1 — Profile & Onboarding

**Phase 1 · Turn the empty schema into a real, editable profile the engines can read.**

**Build outcome (definition of done).** A 5-step onboarding flow (Physiology → Goals → Training → Nutrition → Review → "generating your first plan") writes `Profile`, `Goal`(s), `TrainingProfile`, and `DietProfile` through validated endpoints, capturing everything the engines need: timezone, unit-system preference, activity level, a **structured** goal with priority, optional baseline lifts, and the diet constraints (allergies as hard excludes, a soft weekly budget). Every onboarding field is editable later from Settings, with allergies/injuries clearly flagged as hard constraints. Essentials-only: optional fields can be skipped and filled in anytime.

**Depends on:** Epic 0 · **Unlocks:** Epics 2–4 (the engines read this profile).

### Stories
- As Michael, I want onboarding to capture my physiology, goal, training, and diet once so the app can produce a real plan, not a generic one.
- As Michael, I want my goal captured as a structured target (a rate, an absolute, or an outcome) with a priority so the engines and the horizon planner can actually read it.
- As Michael, I want to optionally enter my current lifts so my first program starts at the right loads instead of from zero.
- As Michael, I want to set my timezone and whether I see kg or lb, so "today" and every number match my life.
- As Michael, I want to edit any of this later, with allergies and injuries clearly marked as hard limits, so my constraints are never quietly ignored.

### Context pack

**Schema (created in Phase 0; this phase populates & edits).**
```prisma
Profile{ age, sex, heightCm, weightKg, bodyFat?, timezone(R1), unitSystem(R6), activityLevel(R7) }
Goal{ type, targetKind, targetValue?, targetUnit?, note?, priority(R14), status }   // one or more
TrainingProfile{ experience, daysPerWeek, sessionMins, equipment[](json), injuries[](json,HARD), baselineLifts[](json,R9) }
DietProfile{ pattern?, restrictions[], allergies[](HARD), dislikes[], cuisines[], cookingSkill?, effortMax?,
             kcal?, macros?, budgetWeekly?(SOFT,R12), mealsPerDay, snacksPerDay, batchCooking, variety }
```
`Goal.targetUnit` ∈ `kg_per_week | kg | pct_bodyfat | reps | kg_1rm | none`. `injuries` = `[{ area, note, avoidPatterns[] }]`. `baselineLifts` = `[{ pattern|exerciseId, estWeight, estReps }]`.

**API.** `GET/PUT /profile` · `GET/PUT /diet-profile` · `GET/PUT /training-profile` · `GET/PUT /goals` — CRUD with Zod validation, reflected in OpenAPI; invalid payloads → 422.

**Resolutions in force:** **R1** capture timezone (default from device) · **R4** structured `Goal.target` (`note` is display-only) · **R6** store metric, convert at the UI per `unitSystem` · **R7** capture `activityLevel` · **R9** optional `baselineLifts` · **R14** `Goal.priority` for multiple goals · **R23** onboarding-completeness (all 5 steps) folds into T1.2.

### Tickets
**T1.1 Profile/diet/training/goal endpoints.** CRUD per the API above with Zod validation; reflect in OpenAPI. *AC:* round-trip create/read/update for each; invalid payloads → 422; units stored metric regardless of input display unit.

**T1.2 Onboarding flow (web).** Multi-step form covering all 5 steps, persisting via T1.1, ending in a "generating your first plan" hand-off into a populated Today. Structured goal builder (kind/value/unit + note + priority), activity level, optional baseline-lifts capture, timezone (defaulted from browser), unit-system pick. *AC:* completing onboarding writes all records; resuming shows saved values; a goal persists as structured fields; skipping optional fields still completes.

**T1.3 Settings edit (web).** Edit any onboarding field later; allergies/injuries clearly flagged as hard constraints; masked API-key entry (Anthropic, Spoonacular). *AC:* edits persist and are read back by generators; API keys are masked and never rendered in plaintext after save.

### One-shot build checklist
- [ ] Four profile endpoints validate (Zod) and round-trip; 422 on bad input.
- [ ] 5-step onboarding writes Profile/Goal/TrainingProfile/DietProfile; structured goal + priority; activity level; optional baseline lifts; timezone + unit system.
- [ ] Units display per `unitSystem` but persist metric.
- [ ] Settings edits every field; allergies/injuries flagged hard; API keys masked.
- [ ] Onboarding ends in the first-plan hand-off.

---

## Epic 2 — Training Engine

**Phase 2 · The first full three-layer generator, the LLM gateway it runs through, and the eval harness that proves it's good.**

**Build outcome (definition of done).** From a profile + goal, Intella generates a multi-week `Program` via `rules → LLM → validator`, persists it with its `inputConstraints`, and serves today's session with targets pre-filled from the last performance. Michael logs sets fast; progression advances loads or deloads on a stall; free-text feedback ("felt easy," "knee off") measurably changes the next generation; progress charts render. All LLM calls go through the **LLM gateway** (cache + local/Claude router + budget), the training generator has a working **rules-only degraded mode** and **safety envelope guards**, and a **golden-set eval** asserts the plans are actually good. This is where the architecture's spine is proven; Phases 3–4 reuse it.

**Depends on:** Epic 1 · **Unlocks:** Epics 3–5 (they reuse the gateway, the repair loop, the eval harness).

### Stories
- As Michael, I want a program matched to my goal and training days so I don't have to design one.
- As Michael, I want today's lifts pre-filled with target weights based on last session so I just confirm and go.
- As Michael, when I report a set felt easy or a joint felt off, I want the next session adjusted.
- As Michael, I want my first program to start at sensible loads — from my baseline lifts if I gave them, or a calibration week if I didn't.
- As Michael, I want training to still work with the AI completely unreachable, so I'm never blocked.
- As Michael, I want hard limits on how aggressive a program can get — capped load jumps — that the AI can never override.
- As Michael, I want Intella to reuse a program when nothing that shaped it changed, so I'm not paying to regenerate the same block twice.

### Context pack

**Schema.**
```prisma
Exercise{ name, primaryMuscles[], secondaryMus[], equipment[], pattern, difficulty, mediaUrl? }   // reference
Program{ goalType, split(json), weeks, progressionScheme(json), inputConstraints(json),
         constraintsHash?, hashVersion?(R20b), calibrationWeeks(R9), degraded(R10), status }
WorkoutSession{ programId, date, weekNo, label?("Calibration"), status, plannedItems[](json), coachingNote? }
SetLog{ sessionId, exerciseId, setNo, reps?, weight?, rpe? }   // append-only, clientId
BodyMetric{ date, weightKg?, bodyFat?, measurements? }         // append-only
Feedback{ domain:"training", refType/refId, structured, freeText, status raw→parsed }
// Gateway tables introduced here (v0.5 ops):
GenerationCache{ inputHash @unique, generator, artifactRef, model, route, constraintsHash, hashVersion, createdAt }
LlmCall{ generator, route:{local|claude}, model, inputHash, tokensIn/Out, costEst, latencyMs, validatorPassed, createdAt }
OpsConfig{ llmMonthlyCeiling, routerPolicy, localModelEndpoint, safetyFloors{} }   // read for budget + guards
```
`plannedItems` = `[{ exerciseId, targetSets, repRange, targetLoad, rpe }]`. `progressionScheme` = `{ rule, incrementLb, deloadTrigger }`.

**API.** `POST /training/program:generate` · `GET /training/program/current` · `GET /training/session/today` · `POST /training/session/{id}/log` · `POST /training/session/{id}/feedback` · `GET /training/progress` · `GET /exercises` (filterable by equipment/muscle).

**Resolutions in force:** **R9** seed loads from `baselineLifts` or a calibration week (`Program.calibrationWeeks`, `WorkoutSession.label="Calibration"`) · **R10** generate→validate→repair (≤2) then `degraded=true` fallback · **R18** built-in seed program covers blank-slate + LLM-down · **R20b** canonical constraint-hash for the cache.

**Engine `training/`.** `computeTrainingConstraints(profile, goal)` → split, weekly set-volume targets, progression scheme, est-1RM (Epley `1RM ≈ w·(1+reps/30)`), equipment/injury filter, **safety envelope** (capped session-to-session load jumps). `generate(constraints)` → gateway call selecting exercises within the allowed menu + coaching notes. `validate(output)` → volume within landmarks, no contraindicated/unavailable exercises, load-jump cap. Progression: add reps → add load → deload on stall; next session pre-fills from last `SetLog`.

**Engine `llm/` (gateway — first use).** `llm.generate(spec)`: cache-check `hash(inputConstraints)` → route (routine→local, hard/creative→Claude; program design is a Claude call) → call → run the validator hook → log `LlmCall`. Enforces Rules-only (no model) and Rules+local modes. Force-local / force-Claude per generator.

**Dev-time `eval/` (golden set).** ~15–30 saved `inputConstraints` cases → property assertions (volume within landmarks, no contraindicated pattern, variety floor, valid progression) + a rubric-scored LLM-as-judge for "is this program sensible." Stored as a JSON artifact; the router uses eval results to decide which calls are local-safe (§3.5 v0.5).

### Tickets
**T2.1 Exercise library.** Seed a starter library tagged by muscle/equipment/pattern; `GET /exercises` with filters. *AC:* filterable by equipment and muscle.

**T2.2 Rules layer.** `computeTrainingConstraints(profile,goal)` → split, weekly set targets, progression scheme, est-1RM, equipment/injury filter; seed loads from `baselineLifts` or emit a calibration week (R9). Pure + unit-tested. *AC:* unit tests cover ≥3 goal/day combos, an injury exclusion, and both the baseline-seeded and calibration-week paths.

**T2.3 LLM layer.** `generateProgram(constraints)` via the gateway → structured output selecting exercises within the allowed menu + coaching notes. *AC:* output validates against the published schema; only allowed exercises appear.

**T2.4 Validator + persistence.** Enforce volume landmarks & exclusions; repair/reject per R10; persist `Program` + `WorkoutSession`s with `inputConstraints`. Wire `POST /training/program:generate`. *AC:* a contrived bad LLM output is caught and repaired-or-degraded (never saved invalid); a valid program saves and is retrievable.

**T2.5 Session view + logging (web).** `GET /training/session/today`; log sets (reps/weight/RPE); `POST .../log`. *AC:* logging persists; revisiting shows logged sets.

**T2.6 Progression + feedback.** Next session pre-fills targets from last performance; `POST .../feedback` parses free text and influences the next generation. *AC:* a logged easy session raises the next target; an injury note removes the offending pattern.

**T2.7 Progress charts (web).** Volume, est-1RM, bodyweight over time. *AC:* charts render from logged data.

**T2.8 LLM gateway.** Router (local vs Claude), content-hash cache keyed on `inputConstraints` (R20b), validator hook, `LlmCall` logging, forced **rules-only** path. *AC:* an unchanged input returns a cached artifact with zero model calls; with the API disabled, training still returns a valid deterministic result; a routed local call is validated identically to a Claude call.

**T2.9 Golden-set eval.** ~15–30 cases; harness asserting validator-pass + quality properties; run stored as JSON. *AC:* editing a prompt and re-running reports a pass-rate delta; a contrived quality regression is caught.

**T2.10 Safety envelope guards (training).** Deterministic capped load jumps in the rules layer. *AC:* inputs that would breach the cap are clamped before generation; unit-tested at the boundaries.

### One-shot build checklist
- [ ] `computeTrainingConstraints` is pure + unit-tested (goals, injury, baseline vs calibration).
- [ ] Program generates through the gateway; validator repairs-or-degrades; `inputConstraints` persisted.
- [ ] Today's session pre-fills from last `SetLog`; logging + progression work; deload on stall.
- [ ] Feedback parses and measurably changes the next generation.
- [ ] Gateway: cache hit = 0 model calls; rules-only mode returns a valid program with the API down; local and Claude routes validated identically.
- [ ] Golden-set eval runs and catches a regression; load-jump cap enforced deterministically.

---

## Epic 3 — Nutrition Engine

**Phase 3 · A weekly meal plan that hits macros within budget and effort — and never contains an allergen.**

**Build outcome (definition of done).** From profile + goal + activity level, Intella computes calorie/macro targets and generates a weekly `MealPlan` (through the gateway + repair loop) that averages the macro targets within tolerance, contains **zero allergens**, respects effort/time caps, and **warns** (never rejects) when the estimated cost exceeds the soft budget. Recipes come from Spoonacular behind a `NutritionProvider` interface that **caches once then reuses** and guards the free-tier daily budget. The weekly grid renders with recipe detail and running macro/cost totals; one-tap swaps return constraint-aware alternatives that keep the day's macros/cost roughly intact. A calorie-floor safety guard is deterministic.

**Depends on:** Epic 2 (gateway, repair loop, eval harness) · **Unlocks:** Epic 4 (grocery aggregates this plan's recipes), Epic 5.

### Stories
- As Michael, I want a week of meals that average my macro targets and stay under budget.
- As Michael, I want to swap a dinner I don't feel like for one that keeps the day's macros and cost roughly intact.
- As Michael, I want meals that fit my skill and time, not 90-minute recipes on a weeknight.
- As Michael, I want an allergen to never appear in a plan, no matter what the AI picks.
- As Michael, I want routine nutrition work done by a local model and only the hard weekly generation sent to the paid API, so cost stays low.
- As Michael, I want the plan to keep working when Spoonacular is down or over quota, by reusing recipes it already cached.

### Context pack

**Schema.**
```prisma
DietProfile{ pattern?, restrictions[], allergies[](HARD), dislikes[], cuisines[], cookingSkill?, effortMax?,
             kcal?, macros{proteinG,carbsG,fatG}?, budgetWeekly?(SOFT,R12), mealsPerDay, snacksPerDay, batchCooking, variety }
Recipe{ name, ingredients[](json:[{ingredientId?,raw,qty,unit}]), steps[], macrosPerServ{kcal,proteinG,carbsG,fatG},
        costEst?(per-serving estimate, NOT live price), timeMins?, tags[], sourceId?, source }   // reference/cache
MealPlan{ weekStart, status active|archived, inputConstraints(json), constraintsHash?, hashVersion?, degraded }
PlannedMeal{ planId, day(0–6), slot:"breakfast"|"lunch"|"dinner"|"snack", recipeId, servings }
```

**API.** `POST /meals/plan:generate` · `GET /meals/plan/current` · `PUT /meals/plan/{id}/meal/{slot}` (swap) · `GET /recipes/{id}` · `POST /meals/plan/{id}/feedback`.

**Resolutions in force:** **R7** TDEE = `BMR(Mifflin–St Jeor) × activityMultiplier[activityLevel]` until the estimator supersedes it (Phase 7) · **R10** repair loop → `degraded` fallback (repeat last week / cached recipes / seed plan) · **R12** provider **cache-once then local**; free-tier daily-call guard; budget check **hard→soft** (validator *warns* when `costEst`>budget) · **R18** seed meal plan for blank-slate + LLM-down.

**Engine `nutrition/`.** `computeNutritionTargets(profile,goal)` → kcal (Mifflin–St Jeor × activity, goal-adjusted), macros, per-meal split, budget/effort/time caps, allergy hard-excludes, **calorie floor** (safety envelope). `generate(constraints)` → gateway call selecting/varying recipes to hit weekly macro averages. `validate(output)` → macros within tolerance, **zero allergens**, cost warns-not-rejects, effort/time within caps. Swap returns constraint-aware alternatives preserving day macros/cost.

**Provider `NutritionProvider` (Spoonacular impl).** Recipe search, per-serving nutrition, ingredient mapping behind the interface; **every response cached into `Recipe`/`Ingredient`** and reused (personal single-user caching per ToS); a daily-call budget guard degrades to cached/LLM-adapted recipes on exhaustion. USDA FoodData Central supplements thin ingredients.

### Tickets
**T3.1 NutritionProvider + Spoonacular impl (R12).** Recipe search, nutrition, ingredient mapping behind an interface; **cache-once** into `Recipe`/`Ingredient`; free-tier daily-budget guard. *AC:* fetch a recipe with per-serving macros; provider swappable via config; a second request for the same recipe hits the cache with no provider call.

**T3.2 Macro rules layer.** `computeNutritionTargets(profile,goal)` → kcal, macros, per-meal split, budget/effort/time caps; allergies → hard excludes; calorie floor. *AC:* unit tests for cut/maintain/bulk; allergies become hard excludes; a below-floor calorie target is clamped.

**T3.3 Plan generation (LLM + validator, R12).** `generateMealPlan(constraints)` via gateway hits weekly macro averages within budget/effort; validator enforces macro tolerance, zero allergens, effort/time; budget **warns** not rejects. Wire `POST /meals/plan:generate`. *AC:* a generated week averages within tolerance; no allergen ever present; cost warns (not rejects) when over budget.

**T3.4 Meal-plan UI (web).** Weekly grid; recipe detail (steps + macros); running macro/cost totals. *AC:* the grid reflects the plan; totals update.

**T3.5 Swap.** `PUT .../meal/{slot}` returns constraint-aware alternatives keeping day macros/cost roughly intact; feedback recorded. *AC:* a swap preserves constraints; the choice influences future selection.

**T3.6 Provider cache-first + quota backoff.** Cache-first reads; track remaining quota; as it runs low, stop fetching new recipes and reuse the cached set. *AC:* with the provider disabled, a plan still regenerates from the local recipe library.

**T3.7 Local-model routing (eval-tuned).** Route the routine nutrition calls (e.g., recipe-line cleanup, coaching phrasing) to the local model where the eval set clears the quality bar; keep weekly generation on Claude. *AC:* a routine call runs local and passes the validator identically; the eval set gates which calls are local.

**T3.8 Safety envelope guard (nutrition — calorie floor).** Deterministic minimum-calorie floor and capped rate of loss/gain in the rules layer. *AC:* inputs that would breach the floor are clamped/rejected before generation; unit-tested at the boundary.

### One-shot build checklist
- [ ] `computeNutritionTargets` pure + unit-tested (cut/maintain/bulk, allergies, calorie floor).
- [ ] Weekly plan generates through the gateway; validator guarantees macro tolerance + zero allergens; budget warns-not-rejects.
- [ ] Spoonacular behind `NutritionProvider`; cache-once; free-tier guard; regenerates from cache when the provider is down.
- [ ] Grid + recipe detail + running totals render; swap preserves day macros/cost.
- [ ] Routine calls route local per the eval set; weekly generation stays on Claude.

---

## Epic 4 — Smart Grocery List

**Phase 4 · Turn the week's meal plan into one consolidated, pantry-aware, aisle-grouped list — the pillar that only works if unit normalization actually works.**

**Build outcome (definition of done).** From the current meal plan, Intella produces one `GroceryList`: every recipe ingredient parsed and matched to a canonical `Ingredient` (via `IngredientAlias`), normalized to a common base unit using density/piece data, aggregated across the week with nothing double-counted, pantry stock subtracted, rounded to shoppable quantities, and grouped by aisle. The list UI lets Michael check items off (persisted, and surviving regeneration), edit the pantry, and print/export. The 80% of this pillar that's hard — converting "1 cup chopped onion" and "2 medium onions" to a common unit — is real, deterministic, and tested; the LLM only cleans lines and assigns aisles within a validator that never lets it invent a density.

**Depends on:** Epic 3 (aggregates its recipes) · **Unlocks:** Epic 5.

### Stories
- As Michael, I want my week's meals turned into one grocery list with nothing double-counted.
- As Michael, I don't want the list to include what I already have in the pantry.
- As Michael, I want it grouped by aisle so shopping is quick, and I'll hunt for sales myself.
- As Michael, I want a check I made in the store to survive the list being regenerated, so I never lose my place.

### Context pack

**Schema.**
```prisma
Ingredient{ canonicalName @unique, defaultUnit, category, aisleOrder?, densityGPerMl?, gramsPerPiece?, aliases[] }  // reference
IngredientAlias{ alias @unique, ingredientId, source }   // "yellow onion"/"brown onion" → canonical (R8)
PantryItem{ ingredientId @unique, qty, unit }            // device-authored; subtracted
GroceryList{ planId, status active|archived }            // regen ARCHIVES, never deletes (R19)
GroceryListItem{ listId, ingredientId?, displayName, qty?, unit?, category, checked, manual, sourceMeals[](advisory json) }
```

**API.** `POST /grocery/list:generate` (from the current plan) · `GET /grocery/list/current` · `PUT /grocery/list/item/{id}` (check off / edit qty) · `GET/POST/PUT /pantry`.

**Resolutions in force:** **R8** the canonicalization pipeline (the core of this pillar) · **R3/R19** `sourceMeals` is advisory JSON rewritten on regen; check-off references `{listId, ingredientId}` and carries forward by canonical-ingredient match; old lists archived · **R10** categorization runs the repair loop; rules-only falls back to a deterministic ingredient→aisle lookup.

**Engine `grocery/` — the R8 pipeline (Phase-4 spec).**
`recipe raw line → LLM parse {name, qty, unit, prep} → match to canonical Ingredient (alias → lexical → embedding) → normalize to base unit (g/ml/piece) via densityGPerMl / gramsPerPiece → aggregate across the week → subtract pantry (also normalized) → round to a shoppable quantity → assign aisle (aisleOrder)`. Density/piece seeds from USDA FoodData Central portion data + a curated seed table; **the LLM may propose a density but the validator requires a numeric fallback and never invents one silently.** Aggregation, normalization, and pantry subtraction are **pure + unit-tested**; only line-cleaning and aisle assignment touch the LLM.

### Tickets
**T4.0 Ingredient canonicalization + alias + density seed (R8) — precedes T4.1.** Ensure `Ingredient.densityGPerMl`/`gramsPerPiece`/`aisleOrder` + the `IngredientAlias` table are seeded; wire the recipe-line → canonical-ingredient → base-unit normalize pipeline. *AC:* provider/synonym strings map to one canonical ingredient; volume/count lines normalize to g/ml/piece with a numeric fallback (never LLM-invented).

**T4.1 Aggregation + pantry.** Consolidate the week's ingredients, normalize units, subtract `PantryItem`s, round to sensible quantities. Pure + unit-tested. *AC:* duplicate ingredients merge; pantry stock reduces quantities; units normalized.

**T4.2 Categorization (LLM + validator).** Clean each ingredient into a shoppable line and assign an aisle/category; validator ensures every ingredient is covered and categorized. *AC:* messy ingredient strings become tidy lines; each item has a category; nothing dropped.

**T4.3 Grocery list UI.** `POST /grocery/list:generate` from the current plan; list grouped by category; check items off; pantry editor; print/export. *AC:* generate from the current plan; items grouped by aisle; check-offs persist; a regeneration preserves prior check-offs by ingredient (R19); the list prints/exports cleanly.

### One-shot build checklist
- [ ] Density/piece/alias seeds present; the canonicalization pipeline maps synonyms and normalizes volume/count → base unit with a numeric fallback.
- [ ] Aggregation + pantry subtraction + rounding are pure + unit-tested; nothing double-counted.
- [ ] Categorization covers every ingredient; rules-only falls back to a deterministic aisle lookup.
- [ ] List UI groups by aisle; check-off persists and survives regeneration; pantry editor works; print/export clean.

---

## Epic 5 — Integration & Adaptation

**Phase 5 · Tie the three pillars into one Today, prove the adaptation loop, and harden the prototype into something usable end-to-end from the phone.**

**Build outcome (definition of done).** A Today dashboard aggregates the day's workout + meals + grocery nudge with quick actions and a coach-insight banner. The adaptation loop is demonstrably wired: training/meal/pantry feedback measurably re-parameterizes the next generation, with a documented before/after for each pillar. Every surface has empty/loading/error/offline/degraded states. A red-flag detector defers medical concerns to a professional instead of silently adjusting a number. Weeks 1–3 render as honest **calibration** (estimate labels, wide bands, a short "calibrate me" ask). The golden-set eval runs in CI. The whole flow works cold start → onboarding → all three pillars from the iPhone over Tailscale.

**Depends on:** Epics 2–4 · **Unlocks:** Epic 6 (iOS builds on a validated web prototype).

### Stories
- As Michael, I want one screen showing today's workout, meals, and a grocery nudge with quick actions, so I know what to do at a glance.
- As Michael, I want every log, swap, and pantry update to visibly change the next plan, so I can trust the app is actually adapting.
- As Michael, when I mention real pain or something that looks medical, I want Intella to flag it and point me to a professional rather than just adjusting a number.
- As Michael, I want my first weeks framed as calibration, with plans that hedge and numbers labeled as estimates, so I trust the app precisely because it isn't faking precision.
- As Michael, I want a failed plan refresh to leave my current plan in place rather than show me an error, so a bad moment for the API is never a bad moment for me.

### Context pack

**Schema.**
```prisma
SafetyFlag{ kind, detectedFrom, severity, message, acknowledgedAt?, createdAt }   // red-flag detector output (v0.5)
// reads existing: Program/MealPlan/GroceryList (+ inputConstraints), Feedback, PantryItem
```

**API.** `GET /today` (aggregate: day's workout + meals + grocery nudge) · `GET /health` · `GET /system/status` (degraded surface, wired to UI) · `GET /safety/flags` · `POST /safety/flags/{id}:acknowledge`.

**Resolutions in force:** **R10/R18** degraded-mode surfacing (a "generated without Claude — rules-only" indicator on Today/Meals) · **R11** the generation-quality eval harness runs in CI (T5.4) · **R23** empty/loading/error/offline/degraded states + a conflict-resolution surface (owned by T5.3) · cold-start calibration UX (T5.6) · coach-not-clinician boundary + red-flag detector (T5.5).

**Engine `safety/`.** Red-flag detector scans parsed feedback/free-text (sharp/persistent pain, dizziness, fainting) and adherence + weight-trend patterns (disordered-eating signature); emits a `SafetyFlag` and surfaces a *"this is beyond what I should coach — consider a professional"* message instead of only adjusting a number. Envelope guards themselves live inside each engine's rules/validator (Phases 2–3), not here.

### Tickets
**T5.1 Today dashboard.** `GET /today` aggregate; web view of day's workout + meals + grocery nudge with quick actions and a coach-insight banner. *AC:* one screen shows all three with working quick links.

**T5.2 Adaptation loop.** Ensure training/meal/pantry feedback measurably re-parameterizes the next generation; document the signals. *AC:* a documented before/after for each pillar showing feedback changed the next output.

**T5.3 Prototype hardening (R23).** Error/empty/loading/offline/degraded states across every pillar surface; a conflict-resolution surface stub; basic e2e happy-path test; README run/host instructions. *AC:* cold start → onboarding → all three pillars works end-to-end from the iPhone over Tailscale; each surface renders its empty/loading/error/offline/degraded state.

**T5.4 Generation-quality eval harness in CI (R11).** The `eval/` golden set → property assertions (macros in tolerance, zero allergens, volume within landmarks, budget respected, no contraindicated exercises, variety floor) + a rubric-scored LLM-as-judge; runs in CI on a fixed seed set. *AC:* the golden set runs in CI; a contrived quality regression fails the run.

**T5.5 Red-flag detector + `SafetyFlag`.** `safety/` scan of parsed feedback + adherence/weight patterns; emits `SafetyFlag`; UI surfaces a defer-to-professional message. *AC:* a "sharp knee pain" feedback string raises a flag and shows the message instead of only adjusting the plan.

**T5.6 Calibration UX (cold-start).** Low-confidence framing for weeks 1–3: estimate labels, wide bands, a short "calibrate me" ask for high-VOI inputs. *AC:* a fresh profile shows estimate/low-confidence labeling everywhere; confidence visibly increases as sample data is logged.

### One-shot build checklist
- [ ] Today aggregates all three pillars with quick actions + a coach-insight banner.
- [ ] Adaptation loop documented before/after for each pillar.
- [ ] Every surface has empty/loading/error/offline/degraded states; degraded generations are visibly labeled.
- [ ] Red-flag detector raises a `SafetyFlag` and defers to a professional.
- [ ] Weeks 1–3 render as calibration with estimate labels and wide bands.
- [ ] Golden-set eval runs in CI and fails on a regression; full flow works from the iPhone over Tailscale.

---

# Native track (deferred) · Phase 6 — Native app, offline, and distribution

> **Deferred under the web-first build order.** Do **not** build this phase until the entire web track — Phases 0–5 **and** 7–11 — is done. It needs the paid **Apple Developer Program**, a **Mac** with Xcode, and your devices on hand: exactly what building web-first is meant to avoid needing up front. Until then Intella is used from the iPhone's **browser** over Tailscale. (The server-side sync endpoints in this phase are only useful once a second, offline client — the native app — exists, so they defer along with it.)

---

## Epic 6 — iOS, Offline Sync & Deployment

**Phase 6 · Put Intella in Michael's pocket: a native app that logs everywhere, syncs when it can, and installs without a cable.**

**Build outcome (definition of done).** A SwiftUI app (generated Swift client from the same OpenAPI spec) with a GRDB local store renders every screen offline from last-synced data and authors in-the-moment writes into a local **outbox**. An offline sync engine pushes the outbox to `POST /sync/push` (idempotent by `clientId`, server applies the precedence merge) and pulls server changes from `GET /sync/pull?since=` (cursor + tombstones). The app pairs by scanning the setup QR into the Keychain, shows an honest "Synced 2m ago / Offline — changes saved" indicator, and is fully **loggable** in airplane mode (log sets, check off grocery, mark meals, weigh in, edit pantry — never generate). A Watch app logs sets and relays through the phone. Distribution is Apple Developer + TestFlight internal testing (OTA, no 7-day expiry).

**Depends on:** Epic 5 (validated web prototype) + the Phase 0 sync columns/`ChangeLog` · **Unlocks:** Epics 12–16 (the sensors are native).

### Stories
- As Michael, I want a native app with the same three pillars so I can train, plan, and shop from my phone.
- As Michael, I want to log a set or check off groceries in airplane mode and have it sync exactly once when I'm back on the tailnet, so being offline never loses data.
- As Michael, I want to pair my phone by scanning a QR, and see at a glance whether I'm synced or offline.
- As Michael, I want to log sets from my Watch and have them reach the server through my phone, de-duplicated, so the Watch is a real logging surface.
- As Michael, I want the app installed over-the-air via TestFlight so it doesn't die every 7 days.

### Context pack

**Residency & offline contract (must hold).** *Server = system of record + only brain; device = offline cache + birthplace of in-the-moment data.* Offline the device can read last-synced plans, log sets, check off grocery + add manual items, mark meals eaten/swap-to-cached, weigh in, edit pantry/settings, answer prompts — all append-only/provisional. The device **cannot generate or regenerate anything**; on-device set pre-fill reads the **last server-computed targets already on the session card** (R20). *The moment isn't blocked; the brain catches up.*

**On-device schema (GRDB) = server subset + sync columns + two device tables.**
```
Outbox   { clientId(UUID), entity, op(upsert|delete), payload(json), baseVersion?, clientUpdatedAt, attempts }  // FIFO, never evicted until acked
SyncState{ lastPullCursor(serverSeq), lastSyncAt }
```
Retention: current period + ~8–12 weeks; recipe images/`mediaUrl` in a size-capped on-disk image cache (never in DB/sync); server base URL + device token in the **Keychain**.

**Server sync wire protocol.**
- `POST /sync/push` — batch of outbox rows FIFO. **Append-only events** (`SetLog`, `BodyMetric`, `Feedback`, later `SensorSample`/`Observation`) upsert idempotently by `clientId` (can't conflict). **Mutable rows** (`PlannedMeal.status`, `PantryItem`, `GroceryListItem.checked`, profile rows) resolve by precedence `corrected > confirmed > assumed > inferred` (R17), ties last-writer by `clientUpdatedAt`. Response returns the authoritative row per `clientId`.
- `GET /sync/pull?since={serverSeq}` — every change past the cursor incl. tombstones (`deletedAt`), plus the new cursor. Carries server-computed derived data (fresh plans, regenerated lists) to the device.
- **Watch → iPhone → Server:** the Watch has no independent API access; it relays via `WatchConnectivity` (`transferUserInfo` queued, `sendMessage` mid-set) into the phone's outbox; the phone de-duplicates by `clientId` and is the single uplink.

**Resolutions in force:** **R17** precedence lattice + 72 h auto-confirm precondition · **R19** an offline check-off survives server regeneration (re-applied by `{listId, ingredientId}` to the active list) · **R20** loggable-not-generatable; pre-fill reads server targets · **R22** pairing QR carries base URL + short-lived PIN, redeemed for the token only inside the open window.

**Engine `sync/` (server) + iOS sync engine (GRDB).** Server: push-apply + precedence + pull cursor + tombstone purge, on the existing scheduler. iOS: outbox + watermark; sync fires on foreground, network-regain, and background refresh; every failure is non-blocking.

**Distribution.** Enroll in the paid Apple Developer Program ($99/yr — required for stable 1-year signing and the HealthKit-background / Live-Activity entitlements the ambient layer needs). Build in Xcode → App Store Connect → add self as internal tester → install via TestFlight (no Beta App Review, OTA updates).

### Tickets
**T6.0 Distribution.** Enroll in the Apple Developer Program; set up a TestFlight internal-testing pipeline for personal installs. *AC:* a build installs on the iPhone via TestFlight and updates over-the-air with no cable.

**T6.x Sync endpoints + engine.** `/sync/push` (precedence apply, idempotent by `clientId`) and `/sync/pull` (cursor + tombstones); iOS GRDB store + outbox + watermark. *AC:* airplane-mode writes replay exactly once on reconnect; pull applies a server-side delete; a mutable-row conflict resolves by R17 precedence.

**T6.y iOS pairing + offline UX.** QR pairing → Keychain; last-synced indicator; foreground/network/background sync triggers; the full six-screen SwiftUI app on the generated client. *AC:* pair via QR; the app is fully usable in airplane mode for logging and check-off; it reconciles on reconnect; the indicator reflects sync state honestly.

**T6.z Watch relay.** Watch store (live session, rest timer, HR, one-tap set-complete + RPE chips) + `WatchConnectivity` transfer into the phone outbox. *AC:* a set logged on the Watch offline reaches the server via the phone, de-duplicated by `clientId`.

### One-shot build checklist
- [ ] SwiftUI app renders all six screens offline from GRDB; generated Swift client from OpenAPI.
- [ ] Outbox authors offline writes; `/sync/push` replays exactly once (idempotent by `clientId`); `/sync/pull` applies changes + tombstones.
- [ ] Mutable-row conflict resolves by R17 precedence; offline check-off survives regeneration (R19).
- [ ] On-device pre-fill reads server targets — no on-device generation (R20).
- [ ] QR pairing (PIN-gated) into Keychain; honest sync/offline indicator.
- [ ] Watch logs sets and relays through the phone, de-duplicated; app installs + updates via TestFlight OTA.

---

# Web track (build now) · Phases 7–11 — Adaptive intelligence (web dashboards)

*Build these **right after Phase 5, before any native work.** They are server-side engines surfaced on **web** screens (Position / Trajectory / Horizon) and depend only on Phases 2–4 logging — **not** on the Phase 6 native app — so they belong to the web track. They assume the web prototype (0–5) is logging real data — the estimators need Tier-2 history to fit against. Design tenet throughout: **reality overrides the formula.***

---

## Epic 7 — A Living Model of Me (Estimation Core)

**Phase 7 · Stop trusting onboarding formulas forever — infer the numbers plans actually depend on from what Michael actually does.**

**Build outcome (definition of done).** An `estimation/` engine, run on a **nightly scheduler**, materializes Tier-3 estimates — true maintenance calories (TDEE), estimated 1RM per lift, adherence rate, rate of weight change — from the Tier-2 event history already being logged (`SetLog`, `BodyMetric`, session status, meals eaten). Each estimate carries a defined `[0,1]` **confidence** that rises with data and decays with staleness, and drives real behavior: low confidence → conservative planning and wider bands. Generators read the current estimate, never a form field. Before the minimums are met, estimates fall back to onboarding formulas stamped low-confidence (cold-start is just the low-confidence end of the same system).

**Depends on:** Epics 2–4 logging · **Unlocks:** Epics 8–11 (they consume estimates + confidence).

### Stories
- As Michael, I want my true maintenance calories inferred from my logged intake and weight trend so my plan corrects itself instead of trusting an onboarding estimate forever.
- As Michael, I want my strength and bodyweight read from trends rather than single noisy days so the app reacts to real change, not water weight.
- As Michael, I want every estimate to show how confident it is so I know which parts of my plan are well-grounded and which are still guesses.
- As Michael, I want my plans to hedge when the data is thin and get assertive when it's solid so I'm never pushed hard on a bad estimate.

### Context pack

**Schema.**
```prisma
MetricEstimate{ metric, value, confidence, windowStart, windowEnd, method, computedAt }  // one current row per metric + history
// reads Tier-2 event history: SetLog, BodyMetric, WorkoutSession.status, PlannedMeal (eaten/swapped)
OpsConfig{ ...confidence & cold-start constants (R13/R16b) }
```

**API.** `GET /estimates` · `GET /estimates/{metric}` (current Tier-3 state + confidence for the position dashboard). Estimates are **written only by the scheduler**, read by clients.

**Estimators (from v0.3 §1, windows governed by R16b).**
- **Bodyweight trend** — EMA, ~10-day half-life (kills water noise, turns within ~2 weeks). Never surface raw weight; the trend is a derived read of `BodyMetric`.
- **TDEE** — `TDEE ≈ mean_daily_intake − (Δ trend_weight_kg × 7700 / days_in_window)`; rolling 21-day regression of intake vs trend-weight change, updated daily.
- **e1RM per lift** — Epley on the best recent working set, EMA-smoothed over 3–5 sessions; the *slope* matters more than the instantaneous value (feeds trajectory).
- **Adherence** — completed ÷ planned, trailing 28 days.

**Resolutions in force:** **R13** confidence formula —
```
conf = w_n·sat(n/n_target) + w_r·exp(−Δt/halfLife) + w_d·(1 − dispersion_norm)   // clamp [0,1], w_n+w_r+w_d=1
bands: <0.4 low (hedge hard, widen cone, eligible to interrupt)  ·  0.4–0.7 medium  ·  >0.7 high
```
**R16b** one reconciled cold-start table (all in `estimation/` config): warmup 14 d; TDEE min 14 intake+weight days; e1RM min 3 sessions/lift; adherence min 7 days; confidence-decay onset 10 days (half-life 14 d); soft re-baseline gap ≥14 d; hard re-baseline gap ≥30 d.

**Engine `estimation/`.** `recompute(metric)` re-fits a Tier-3 estimate from Tier-2 events; runs on the nightly scheduler (not on request). "Backfilling" a new estimate = running `recompute()` once over existing history, not a migration.

### Tickets
**T7.1 `MetricEstimate` + `estimation/` engine.** Model + module skeleton reading Tier-2 events; one current row per metric + history. *AC:* `recompute(metric)` writes a `MetricEstimate` from existing logs.
**T7.2 TDEE / trend-weight / e1RM / adherence estimators (R16b windows).** Implement the four estimators with the specified windows/smoothing. *AC:* TDEE tracks a contrived intake-vs-weight scenario; e1RM smooths across sessions; adherence over 28 days; unit-tested against fixtures.
**T7.3 Nightly recompute scheduler.** A scheduled job recomputes all estimates; confidence decays on staleness. *AC:* estimates refresh nightly; a 10-day data gap lowers confidence per R16b.
**T7.4 Confidence scoring (R13).** The `[0,1]` formula with bands, constants in `OpsConfig`; generators read the estimate + confidence and hedge on low. *AC:* a thin-data estimate reads low-confidence and the plan hedges; more data raises it.

### One-shot build checklist
- [ ] `estimation/` recomputes TDEE / trend-weight / e1RM / adherence from Tier-2 history on a nightly scheduler.
- [ ] Confidence is the R13 `[0,1]` formula with bands; decays on staleness per R16b.
- [ ] Generators read the current estimate (never a form field) and hedge when confidence is low.
- [ ] Cold-start falls back to onboarding formulas stamped low-confidence; `GET /estimates` serves the dashboard.

---

## Epic 8 — Planning Across My Horizons

**Phase 8 · One goal tree, sized to Michael's goals: long horizons set direction, short horizons touch reality, evidence rewrites the long ones.**

**Build outcome (definition of done).** A single shared `PlanNode` horizon tree materializes only the rungs the furthest goal needs (Year → Quarter → Month → Week → Day), with each `Goal` attaching milestone nodes at the right rung by priority. Every node runs the same `rules → LLM → validator` flow, storing `inputConstraints` so it can answer "why is my January block a cut?". Lower horizons report a trajectory delta upward; when accumulated drift crosses a threshold, the next horizon up is marked **stale** and re-planned — so a 6-month plan is rewritten when evidence says its assumptions are wrong, not daily. Committed horizons (Quarter and below) are concrete; directional ones (6-month+) are stored aspiration + slope, not a pre-planned decade. Infeasible timelines **never block** — the planner auto-relaxes and emits an advisory node.

**Depends on:** Epic 7 (projections need estimates + slope) · **Unlocks:** Epics 9–11.

### Stories
- As Michael, I want the app to plan only as far out as my goals actually require so I'm never handed a fake five-year plan for a six-month goal.
- As Michael, I want a long-term ambition to produce real milestones at every horizon between now and then so I can see the path, not just the destination.
- As Michael, I want my near-term plans concrete and far-term ones directional so the app is committed where it can be and honest where it can't.
- As Michael, I want a horizon to re-plan itself when my actual results drift from what it assumed so my long-term plan never quietly goes stale.
- As Michael, when a milestone isn't reachable in time, I want the app to tell me and adjust, not promise something impossible or refuse to plan.

### Context pack

**Schema.**
```prisma
PlanNode{ level, parentId(self-relation FK, R3), goalId?(null on structural rungs), targets(json),
          milestones[](json), inputConstraints(json), status, projectedVsActual(json) }
// level ∈ {day, week, month, quarter, 6mo, 1yr, 2yr, 5yr, 10yr} — materialize only rungs a goal needs
Goal{ ...priority(R14) }   // multi-goal conflict ordering
```

**API.** `GET /plan/tree` (full tree + per-node status) · `GET /plan/node/{id}` (node + its `inputConstraints` — the "why") · `POST /plan/node/{id}:regenerate` (also auto-triggered on staleness). `PUT /goals` gains the side effect of **rebuilding the horizon ladder** to match new target dates.

**Resolutions in force:** **R14** one shared tree (root = synthetic `Horizon`); goals attach milestones by rung; conflicts (bulk vs cut at a rung) resolve by `Goal.priority` + a feasibility validator that sequences (phase A then B) or emits a conflict advisory node — never silently blocks. **R15** an infeasible goal/timeline does **not** block generation: auto-relax order **timeline → rate → volume**, emit an advisory `PlanNode` ("−0.5 kg/wk by March needs +3 weeks or a steeper deficit — I chose +3 weeks; change it in Goals"); Michael accepts or overrides.

**Engine `estimation/` (horizon functions).** `project(goal, horizon)` → projection series + confidence; `checkStaleness(planNode)` → trajectory delta, flags higher horizons for regeneration. Direction flows down (parent targets), truth flows up (child actuals). Committed = Quarter and below; directional = 6-month+.

### Tickets
**T8.1 `PlanNode` tree + ladder derivation (R14).** Build the shared tree; derive rungs from goal target dates; attach goal milestones by priority; self-relation FK for `parentId`. *AC:* a 6-month goal materializes only through the 6-month rung; a 10-year goal extends the ladder; `PUT /goals` rebuilds it.
**T8.2 Per-horizon generators.** Each node runs `rules → LLM → validator` with parent targets + child actuals in the constraint object; stores `inputConstraints`. *AC:* a node explains itself from its `inputConstraints` via `GET /plan/node/{id}`.
**T8.3 Staleness detection + auto-regenerate.** Weekly job computes projected-vs-actual deltas; crossing a threshold marks the next horizon up stale and re-plans it. *AC:* a contrived drift marks a higher node stale and regenerates it; steady data does not.
**T8.4 Feasibility validator + advisory nodes (R15).** Auto-relax timeline→rate→volume; emit an advisory node; never block. *AC:* an impossible timeline yields the best feasible plan + an advisory node Michael can accept/override; generation never hard-stops.

### One-shot build checklist
- [ ] One shared `PlanNode` tree materializes only needed rungs; goals attach by priority (R14).
- [ ] Each node generates via the three-layer pattern and explains itself from `inputConstraints`.
- [ ] Drift marks higher horizons stale and auto-regenerates them; steady data doesn't.
- [ ] Infeasible timelines auto-relax + emit an advisory node; never block (R15); `PUT /goals` rebuilds the ladder.

---

## Epic 9 — Learning My Habits

**Phase 9 · Bend future plans toward what Michael actually does — without mistaking a one-off disruption for a lasting preference.**

**Build outcome (definition of done).** Three learning loops run at three clocks. The **medium (weekly)** loop is the new high-value work: meals swapped away repeatedly get down-weighted, re-cooked ones up-weighted, hard sessions stop landing on chronically-skipped days — all as recency-decayed `PreferenceWeight`s wired into the meal and training generators, learned without asking. A **"couldn't vs. wouldn't"** cause (a one-tap chip or parsed free text) keeps a work-trip skip from being learned as avoidance. The **slow (monthly)** loop re-fits estimators and asks whether the *method* is working: high adherence + flat outcome ⇒ change the progression scheme, don't nag. A gap beyond the re-baseline threshold triggers a welcome-back/re-baseline flow.

**Depends on:** Epics 7–8 · **Unlocks:** Epics 10–11.

### Stories
- As Michael, I want meals I keep swapping away to stop showing up, even if I never said I disliked them, so the plan learns my tastes from my actions.
- As Michael, I want the app to stop scheduling hard sessions on days I consistently miss so my plan fits the life I actually live.
- As Michael, I want a one-off skip for a work trip treated differently from a pattern of avoidance so the app doesn't learn the wrong lesson from a bad week.
- As Michael, when I'm adherent but not progressing, I want the app to change its method rather than tell me to try harder.
- As Michael, after a long gap I want the app to re-baseline rather than pick up where I left off, so a month off doesn't hand me last month's loads.

### Context pack

**Schema.**
```prisma
AdherenceEvent{ domain, plannedRef, actual, delta, causeParsed, cause:{couldnt|wouldnt|unknown}, createdAt }  // computed roll-up (distinct from Feedback, R5)
PreferenceWeight{ domain, entityId, weight, lastUpdated }   // recency-decayed learned weights (meals, exercises, slots)
// reads: PlannedMeal (swaps/skips), WorkoutSession.status by slot, Feedback (free-text cause)
```

**API.** `POST /adherence` (record a planned-vs-actual event with optional free-text cause). Learned weights are read internally by the meal/training generators' constraint step.

**Resolutions in force:** **R5** `AdherenceEvent` is a distinct computed table, not an extension of `Feedback`; the free-text cause is authored `Feedback` parsed into a structured cause. **R16b** re-baseline thresholds: soft gap ≥14 d (widen cones, re-open calibration), hard gap ≥30 d (treat as cold-start).

**The three loops (v0.3 §3).** Fast (per session/day, largely built in Phase 2). **Medium (weekly)** — model each entity as a recency-decayed weight; a meal swapped away 3× is a revealed dislike (down-weight); a re-cooked one is a favorite (up-weight); a 60%-skipped Friday stops getting the hardest session. **Slow (monthly)** — re-fit estimators; if adherence is high but outcome flat, the *method* is wrong → escalate to a mesocycle change. Guardrail: "couldn't" (noise) vs "wouldn't" (signal) disambiguated by the cause chip/text so spurious habits aren't learned.

### Tickets
**T9.1 `AdherenceEvent` + `PreferenceWeight`.** Models + the weekly roll-up that computes planned-vs-actual and updates recency-decayed weights. *AC:* repeated swaps of one meal lower its weight; a re-cooked meal raises it; weights decay with recency.
**T9.2 Medium-loop weekly modeling wired into generators.** Feed `PreferenceWeight`s into the meal + training constraint step (and the cache inclusion list, R20b). *AC:* a down-weighted meal appears less; a chronically-skipped slot stops getting the hardest session.
**T9.3 Couldn't-vs-wouldn't parsing + slow-loop method-check.** Parse the skip/swap cause into `{couldnt|wouldnt|unknown}`; monthly, detect high-adherence-flat-outcome and escalate to a method change. *AC:* a "work trip" cause is not learned as avoidance; a high-adherence stall triggers a progression-scheme change, not a nag.
**T9.4 Re-baseline / dead-month flow.** A gap beyond threshold enters calibration mode rather than resuming old loads; injury cause engages the hard-constraint path + a return deload. *AC:* a 30-day gap re-enters cold-start; a 14-day gap widens cones; an injury gap engages the hard path.

### One-shot build checklist
- [ ] `PreferenceWeight`s are recency-decayed and wired into meal + training generation (and the cache hash).
- [ ] Repeated swaps down-weight; re-cooks up-weight; chronically-skipped slots avoid the hardest session.
- [ ] Couldn't-vs-wouldn't cause prevents spurious-habit learning; slow loop changes method on adherent-but-flat.
- [ ] Re-baseline flow triggers on the R16b gap thresholds; injury engages the hard-constraint path.

---

## Epic 10 — Seeing Where I Stand and Where I'm Headed

**Phase 10 · Three honest surfaces: current state, projected trajectory with real uncertainty, and a plain-language record of why the plan changed.**

**Build outcome (definition of done).** A **position** dashboard shows Michael's current state — estimated TDEE with its confidence band, current e1RMs, trend bodyweight (never raw), 28-day adherence, macro-hit rate, weekly volume per muscle vs landmarks — each labeled with freshness/confidence. A **trajectory** view plots actual-to-date plus a projection **cone (fan chart)** per goal that widens with low confidence and narrows as data accumulates, marks milestones, and labels on-track/ahead/behind. A **trajectory-delta log** narrates, in plain language, exactly why the plan changed over time — mostly a diff between successive `inputConstraints` snapshots. `TrajectorySnapshot`s freeze periodic projections so the cone and log have history.

**Depends on:** Epics 7–9 · **Unlocks:** Epic 11.

### Stories
- As Michael, I want a single snapshot of my current state — burn, strength, weight trend, adherence — each labeled with how fresh and trustworthy it is.
- As Michael, I want a projection toward each goal that widens when I'm inconsistent and tightens when I'm steady so I can see that consistency literally shrinks my uncertainty.
- As Michael, I want to know at a glance whether I'm on track, ahead, or behind each milestone, and what the app did about it when I fell behind.
- As Michael, I want a running log of why my plan changed over time so I can trust that every adjustment had a reason.

### Context pack

**Schema.**
```prisma
TrajectorySnapshot{ goalId, takenAt, projectedSeries[](json), confidence }   // frozen projections → cone + log history
// reads: MetricEstimate (+confidence), PlanNode.inputConstraints (successive diffs = the delta log), BodyMetric (trend)
```

**API.** `GET /trajectory/{goalId}` (actual-to-date + projection cone + milestones + on-track status) · `GET /trajectory/{goalId}/log` (the plain-language trajectory-delta history) · `GET /estimates` (position dashboard).

**Resolutions in force:** **R13** confidence drives cone width (low → wide, high → narrow) and the on-track bands. Charts show raw points with an EMA/trend line overlaid; projections render as a shaded band — all on the existing chart stack, no new dependency.

**Surfaces (v0.3 §4).** Position = a state snapshot (not a chart), every number showing freshness/confidence. Trajectory = a fan chart per active goal driven by the current fitted slope; when behind, the panel states what changed and what Intella did (extended timeline, raised volume, widened deficit). Delta log = v0.2's transparency window applied across *time*, e.g. *"Week 7 — measured TDEE revised 2,150 → 2,240 kcal (weight held flat); deficit widened 150 kcal to keep the fat-loss rate on target for the March milestone."*

### Tickets
**T10.1 Position dashboard.** State snapshot from `GET /estimates`, each number with freshness/confidence; trend weight never raw. *AC:* the dashboard renders TDEE band, e1RMs, trend weight, adherence, volume-vs-landmarks with confidence labels.
**T10.2 Trajectory fan-chart + cone.** Per-goal actual-to-date + projection cone that widens/narrows with confidence; milestones + on-track/ahead/behind labels. *AC:* lower confidence visibly widens the cone; a behind-milestone shows what changed and what the app did.
**T10.3 `TrajectorySnapshot` history.** Periodically freeze projections so the cone/log have "what we predicted vs. what happened." *AC:* snapshots accumulate and a past projection can be compared to actuals.
**T10.4 Trajectory-delta log.** Narrate the diff between successive `inputConstraints` snapshots into a plain-language history. *AC:* a constraint change (e.g., TDEE revision) produces a readable log entry explaining the adjustment.

### One-shot build checklist
- [ ] Position dashboard labels every number with freshness/confidence; trend weight never raw.
- [ ] Trajectory cone widens on low confidence, narrows on high; milestones + on-track labels render.
- [ ] `TrajectorySnapshot`s give the cone/log history; the delta log narrates constraint diffs in plain language.

---

## Epic 11 — Adaptive Hardening

**Phase 11 · Make the adaptive layer graceful on sparse data and honest at its edges.**

**Build outcome (definition of done).** The estimators behave well on sparse data — cold-start priors fall back to onboarding formulas and hand off to fitted estimates as data arrives, with no jarring jumps. Every estimator window and threshold is exposed in a tunable config surface. Every new adaptive UI (position, trajectory, horizons) has an explicit empty / low-confidence state ("not enough data to estimate yet") rather than a falsely precise number.

**Depends on:** Epics 7–10 · **Unlocks:** (adaptive layer complete).

### Stories
- As Michael, I want the app to behave sensibly before it has much data — priors that hand off cleanly to real estimates — so early weeks aren't broken or fake.
- As Michael, I want to tune how reactive the estimators are so I can trade steadiness for responsiveness on my own terms.
- As Michael, I want every insight that lacks data to say so plainly rather than show me a made-up number.

### Context pack

**Schema / config.** No new tables — this phase hardens Epics 7–10. All windows/thresholds live in `OpsConfig` / `estimation/` config (the R16b table + R13 weights), now surfaced for editing.

**API.** `GET/PUT /ops/config` (tunable windows/weights). Reuses `GET /estimates`, `GET /trajectory/{goalId}`.

**Resolutions in force:** **R16b** cold-start constants govern the prior→estimate handoff; **R13** low-confidence bands drive the empty/low-confidence UI states (aligns with T5.6 calibration UX, now applied to the adaptive surfaces).

### Tickets
**T11.1 Cold-start priors → estimates.** Backfill behavior on sparse data: onboarding formulas as low-confidence priors that hand off to fitted estimates once R16b minimums are met, with no discontinuity. *AC:* an estimate transitions from prior to fitted at the minimum threshold without a visible jump; confidence rises across the handoff.
**T11.2 Tunable-window config surface.** Expose estimator windows/weights + confidence constants in `GET/PUT /ops/config`. *AC:* changing a window in config changes estimator behavior on the next recompute.
**T11.3 Empty / low-confidence states.** Every new adaptive UI renders an explicit "not enough data yet" / wide-band state. *AC:* a fresh profile shows low-confidence/empty states across position, trajectory, and horizons rather than precise numbers.

### One-shot build checklist
- [ ] Cold-start priors hand off to fitted estimates at R16b minimums with no discontinuity.
- [ ] Estimator windows/weights/confidence constants are tunable via `/ops/config`.
- [ ] Position, trajectory, and horizon surfaces all have explicit empty/low-confidence states.

---

# Native track (deferred) · Phases 12–16 — Ambient capture (HealthKit)

> **Deferred under the web-first build order — this is the HealthKit / sensor block.** Build only after Phase 6 (which itself waits on the whole web track). Everything here rides on iOS/watchOS sensors (HealthKit, CoreMotion, the Watch), so none of it can be exercised from the web and all of it is parked until the native track begins.

*iOS/watchOS-native by necessity (the sensors live on the devices), so these depend on the Phase 6 app and sit on top of the Phase 7 estimators (there must be an estimator to feed). Design tenets: **sense first, ask last · assume then ratify · every question is a one-tap correction of a pre-filled guess · sensors override self-report · confidence is the throttle.** Grounded in iOS 26 reality: no food or screen-usage sensing; rich passive biometrics; one-tap notification/widget logging.*

---

## Epic 12 — Capture Without Interruption (Sensor Bridge & Context)

**Phase 12 · Feed the estimators from the sensors Michael already wears — silently.**

**Build outcome (definition of done).** The iOS app reads HealthKit (via observer queries + `enableBackgroundDelivery`) and CoreMotion in the background and ships **derived** events to `POST /signals/ingest`, which stores them as append-only `SensorSample`s — the Tier-2 fuel the estimators fit against. A server + on-device **context engine** fuses those signals into a confidence-scored `ContextState` timeline ("what is Michael doing right now"), used to gate interruptions and pre-fill guesses. Silent Rung-0 capture writes provisional `Observation`s so sleep, weight (via a connected scale), workouts-happened, and activity flow in with zero logging. The payoff: the estimators now run on *measured* inputs instead of self-report.

**Depends on:** Epic 6 (native app) + Epic 7 (estimators to feed) · **Unlocks:** Epics 13–16.

### Stories
- As Michael, I want my sleep, workouts, weight, and daily activity captured automatically from my Watch and scale so I almost never log anything by hand.
- As Michael, I want Intella to tell what I'm doing — training, sitting, commuting, sleeping — so it never interrupts me at the wrong moment.
- As Michael, I want the activity multiplier in my calorie math to come from my real movement, not an onboarding guess.

### Context pack

**What's sensable (design against this, not wishes — iOS 26).** *Silent/passive:* heart rate + resting/walking HR, HRV (SDNN), sleep stages, workouts (type/duration/HR/energy — confirms a session happened, **not** reps/loads), steps/distance/flights/active+basal energy, VO₂max/respiratory/SpO₂, body mass + body-fat (**smart scale** → HealthKit), CoreMotion motion state (stationary/walking/running/cycling/automotive). *Not sensable — must be asked:* what/when he ate, reps/weights/RPE per set, couldn't-vs-wouldn't. **Screen Time is dropped** — third-party apps get only opaque tokens; don't build capture on it. HealthKit permissions are per-type and silently revocable → degrade gracefully.

**Schema.**
```prisma
SensorSample{ type, value, unit, source, start, end, ingestedAt }   // raw Tier-2 events; append-only; clientId
ContextState{ state, probability, start, end, inputs(json) }        // derived timeline; rolling window (only confirmed events persist long-term)
Observation{ domain, refType/refId, value, status:{inferred|assumed|confirmed|corrected}, confidence, basis(json), createdAt, ratifiedAt }
```

**API.** `POST /signals/ingest` (batch upload from background delivery — derived events, **not** the raw firehose) · `GET /context/current` (state + probability, debug/dashboard).

**Resolutions in force:** **R16** context engine = a **transparent weighted-evidence score** (not ML): each candidate state scores from CoreMotion class match + HR-vs-baseline band + time-of-day prior + optional Calendar/location; pick argmax, confidence = softmax margin. **HR baseline** = trailing 7-day resting/active HealthKit percentiles; cold-start (no baseline) = CoreMotion + time-of-day priors only, low confidence. Migration note: absence of an `Observation` = implicit `confirmed` (hand-entered history is user-truth); only new sensor/inferred data creates `assumed` records.

**Context states** (not mutually exclusive; each carries a probability): `asleep`, `working_out`, `commuting`, `sedentary_focused`, `active_moving`, `post_workout`, `meal_window`, `winding_down`, `unknown`. Two jobs: **gate interruptions** (never mid-set/drive/sleep) and **pre-fill guesses** (a 40-min `working_out` block overlapping the planned Push day → assume Push happened at targets).

**Engine `capture/`.** `ingest(sample)` → normalize a HealthKit/CoreMotion sample into `SensorSample`, write the provisional `Observation`. `deriveContext()` → fuse signals into the `ContextState` timeline. Runs partly on-device (owns the sensors) and partly server-side (source-of-truth store).

### Tickets
**T12.1 HealthKit background delivery + CoreMotion ingest (iOS).** Observer queries + `enableBackgroundDelivery` for the scoped HealthKit types; CoreMotion `CMMotionActivity`; convert to derived events. *AC:* a new HealthKit sample wakes the app and produces a derived event even when closed; per-type permission loss degrades gracefully.
**T12.2 `SensorSample` + `POST /signals/ingest`.** Batch upload of derived events; append-only store; idempotent by `clientId`. *AC:* a batch ingests once and is replay-safe; the raw firehose is not shipped.
**T12.3 Context engine (R16).** Weighted-evidence state scoring with the HR baseline; `ContextState` timeline; `GET /context/current`. *AC:* a workout block scores `working_out` with high confidence; cold-start (no baseline) falls back to motion + time priors marked low-confidence.
**T12.4 Silent Rung-0 provisional `Observation`s.** Sleep, weight (scale), workout-happened, activity written as `assumed` with confidence + basis. *AC:* an overnight sleep block and a scale reading appear as provisional observations with zero user logging.

### One-shot build checklist
- [ ] HealthKit background delivery + CoreMotion feed derived events to `POST /signals/ingest` as append-only `SensorSample`s.
- [ ] Context engine scores states by transparent weighted evidence with a 7-day HR baseline; cold-start degrades gracefully.
- [ ] Silent Rung-0 capture writes provisional `Observation`s (sleep/weight/workout/activity) with no logging.
- [ ] Estimators now run on measured inputs; per-type permission loss degrades gracefully.

---

## Epic 13 — It Keeps Working When I'm Busy (Assume-then-Ratify + Capture Ladder)

**Phase 13 · Every guess is written immediately and drives the plan; Michael confirms or corrects it whenever convenient — the plan never waits.**

**Build outcome (definition of done).** The `Observation` status lifecycle (`inferred → assumed → confirmed | corrected`, plus `expired_assumed`) is live: sensed/inferred data is `assumed` and active immediately; ratifying upgrades confidence; a correction is a learning signal that humbles the next inference. One `MicroPrompt` object renders onto four capture surfaces — silent (Rung 0), ambient widget/complication/Live Activity (Rung 1), actionable notification (Rung 2), and the in-app approvals queue (Rung 3) — always as a **one-tap correction of a pre-filled guess** (chip[0] = the assumed value), with optional free text. A week of assumptions can be bulk-ratified in one pass. The sync precedence merge (R17) makes a late offline correction always win.

**Depends on:** Epic 12 · **Unlocks:** Epics 14–16.

### Stories
- As Michael, I want Intella to assume its best guess and keep planning even if I don't respond for days, so being busy never breaks my program.
- As Michael, I want the things a sensor can't know — what I ate, how a set felt, why I skipped — asked as a single tap on a pre-filled guess, not a blank form.
- As Michael, I want to answer from the notification or a widget without opening the app, so logging costs me seconds.
- As Michael, I want to confirm or fix a week of assumptions in one quick pass whenever I choose, so ratifying is never a chore.
- As Michael, I want my corrections to make Intella's future guesses better, so the app earns the right to assume more over time.

### Context pack

**Schema.**
```prisma
Observation{ ...status:{inferred|assumed|confirmed|corrected|expired_assumed}, confidence, basis(json), ratifiedAt }
CapturePrompt{ headline, assumedValue, chips[](json), resolvesRef, feedsEstimate, voiScore, contextGate[], surface, state:{pending|answered|expired}, expiresAt }
// a MicroPrompt tap CREATES a Feedback row (user-authored, R5) and may update an Observation
```

**MicroPrompt (one object, many surfaces).** `headline` (one human line) · `assumed` (pre-filled best guess, already written provisionally) · `chips[2–4]` (chip[0] = the assumed value) · optional `freeText` · `resolves` (the datapoint) · `feeds` (which estimate → drives VOI) · `context` (when it may fire) · `cost` · `expires` (→ stays `assumed` if unanswered). Render: notification (headline + 2 chips in banner, 4 on expand, inline text) · widget/complication (tap = App Intent writing straight through) · in-app card (swipe-to-confirm en masse).

**API.** `GET /captures/pending` (the Rung-3 queue) · `POST /captures/{id}:ratify` (confirm/correct/reject an assumed observation).

**Resolutions in force:** **R17** strict precedence lattice `corrected > confirmed > assumed > inferred`; auto-confirm promotes `assumed → confirmed` only server-side, only after the **72 h** window, and only if no pending device correction exists for that `refId` — so a late offline `corrected` always wins (closes the correction-loss bug). **R5** a MicroPrompt tap is authored `Feedback`; the `Observation` is the system belief it updates.

**Capture ladder (always use the lowest rung that works; escalate only when value justifies).** Rung 0 silent → Rung 1 ambient (pull, no interruption) → Rung 2 notification (budgeted, Phase 14) → Rung 3 in-app queue. Bias is downward: most data enters at 0–1 and is ratified at Rung 3 on next app open.

**Engine `capture/` (+ iOS).** `ratify(promptId, response)` → confirm/correct the `Observation`, emit the correction as a learning signal. iOS owns App Intents (interactive widgets / Live Activities / one-tap logging) + UserNotifications (actionable + text-input).

### Tickets
**T13.1 `Observation` lifecycle (R17).** The status machine + confidence weights; `assumed` is active immediately; `corrected` outranks `confirmed`. *AC:* an assumed value drives the plan before ratification; a later correction overrides an auto-confirmed value.
**T13.2 Approvals queue (Rung 3, in-app).** The pending-prompt queue; identical cards; swipe/bulk confirm. *AC:* a week of `assumed` records confirms in one pass; `GET /captures/pending` drives it.
**T13.3 Actionable notifications (Rung 2).** One-tap chips (2 in banner, 4 expanded) + inline text; tapping a chip ratifies without opening the app. *AC:* answering from the notification ratifies the observation and never opens the app.
**T13.4 Widgets / Live Activities / App Intents (Rung 1).** Home/lock/StandBy widget, Watch complication, in-workout Live Activity; App-Intent one-tap logging writes straight through. *AC:* ticking a widget chip writes an observation via App Intent with the app closed; the Live Activity shows the active set + rest timer.
**T13.5 Sync precedence merge + idempotency keys.** The R17 precedence apply on `/sync/push`; record versioning + idempotency keys so a replayed offline queue can't double-apply. *AC:* an offline correction pushed after a server auto-confirm still wins; a replayed batch is a no-op.

### One-shot build checklist
- [ ] `Observation` lifecycle live; `assumed` drives the plan immediately; `corrected > confirmed` (R17).
- [ ] One `MicroPrompt` object renders onto Rungs 0–3; chip[0] is always the assumed value.
- [ ] Notification + widget/App-Intent answering ratifies without opening the app; Live Activity shows the active set.
- [ ] Bulk-ratify clears a week in one pass; corrections feed back as learning signals.
- [ ] Sync precedence merge makes a late offline correction win; replays are idempotent.

---

## Epic 14 — Ask Me Only What Matters, Only When It Helps (VOI Budget & Scheduler)

**Phase 14 · Treat attention as the scarcest resource — interrupt only when the answer would change a plan, at a moment Michael can actually respond.**

**Build outcome (definition of done).** Every candidate prompt scores a value-of-information (VOI) and only reaches Rung 2 (a push) when it clears a value-vs-cost bar *and* the daily budget has room; everything else waits quietly at Rung 1/3. Pushes respect a hard daily cap, system Focus/DND, `asleep`/`working_out`/`commuting` context, and user quiet hours. Non-urgent prompts batch into one end-of-day/next-open digest at a calm moment the context engine picks. Prompts are event-driven (workout-confirm at session end, weigh-in nudge on wake, meal-confirm inside the meal window) so each lands answerable in one tap.

**Depends on:** Epic 13 · **Unlocks:** Epics 15–16.

### Stories
- As Michael, I want Intella to interrupt me only when knowing the answer would actually change my plan, so a notification always feels worth it.
- As Michael, I want a hard limit on how often Intella pushes me, with everything else waiting quietly for when I next open the app.
- As Michael, I want questions batched and timed to calm moments — after a workout, in the evening — rather than pinged at me all day.

### Context pack

**Schema.**
```prisma
CaptureConfig{ dailyPushCap, quietHours(json), perSignalPolicy(json), connectedScale, calendarOptIn, locationOptIn, autoConfirmHours(72) }
// reads CapturePrompt.voiScore, ContextState, MetricEstimate.confidence
```

**API.** `POST /captures/propose` (server-side VOI scoring + scheduling decision for candidate prompts) · `GET/PUT /capture/config` (interruption budget, quiet hours, per-signal policy, opt-ins).

**Resolutions in force:** **R16** VOI + cost on comparable `[0,1]` scales —
```
VOI            = uncertaintyResolved × planImpact
                 uncertaintyResolved = (1 − confidence) of the target estimate (R13)
                 planImpact ∈ static per-signal table (intake/weight ≈ 1.0 … step-count ≈ 0.1)
interruptionCost = base(context) + budgetPenalty(spentToday / dailyBudget) + timeOfDayPenalty
push  ⟺  (VOI − interruptionCost) > threshold   AND   budget_remaining > 0
```
All constants in `CaptureConfig`. High-VOI example: "did you eat the planned dinner?" (unsensable **and** the biggest TDEE input). ~0-VOI: "did you really sleep 7h12m?" (already sensed).

**Rules (v0.4 §6).** Hard daily cap (default small, ≤2–3, user-tunable); over-cap degrades to Rung 1/3, never vanishes. Quiet by construction (Focus/DND, context, quiet hours). Batch by default into one digest at a `winding_down` moment. Right-moment, event-driven, not clock-time.

**Engine `capture/`.** `proposePrompts()` → candidate `CapturePrompt`s with VOI scores. `schedule()` → apply budget/quiet/right-moment rules, pick a surface per prompt.

### Tickets
**T14.1 VOI scoring (R16).** Compute VOI from `(1 − confidence) × planImpact` with the per-signal impact table. *AC:* a high-impact unsensable prompt scores high VOI; an already-sensed one scores ~0.
**T14.2 Interruption budget + quiet hours + gating.** Hard daily cap; Focus/DND + context + quiet-hours gates; over-cap → Rung 1/3. *AC:* pushes never exceed the cap or fire in quiet/forbidden contexts; over-cap prompts degrade, not vanish.
**T14.3 Right-moment event-driven delivery.** Workout-confirm at session end, weigh-in on wake, meal-confirm in the meal window. *AC:* each prompt fires at its event, answerable in one tap.
**T14.4 Batching / digest.** Non-urgent prompts accumulate into one calm-moment digest. *AC:* multiple non-urgent prompts surface as a single end-of-day/next-open digest, not N pings.

### One-shot build checklist
- [ ] VOI + interruptionCost on `[0,1]` per R16; push only when `(VOI − cost) > threshold` and budget remains.
- [ ] Hard daily cap + Focus/DND + context + quiet-hours gating; over-cap degrades to Rung 1/3.
- [ ] Prompts are event-driven (session-end / wake / meal-window) and answerable in one tap.
- [ ] Non-urgent prompts batch into one calm-moment digest.

---

## Epic 15 — Learning My Rhythm (Responsiveness & Tuning)

**Phase 15 · Stop asking what Michael keeps ignoring; concentrate the few pushes where he actually answers.**

**Build outcome (definition of done).** A `ResponsivenessModel` (habit-learning turned on the capture layer itself) tracks which prompts, at which times, on which surfaces Michael actually answers, and feeds the scheduler: routinely-ignored prompts are down-weighted, and pushes concentrate in his responsive windows (if he always clears the queue at night but ignores midday pushes, Intella stops pushing midday). An ignored prompt is never repeated — the assumed value simply stands. A per-signal policy surface in Settings lets him set each signal's silent/confirm/ask default and his quiet hours.

**Depends on:** Epic 14 · **Unlocks:** Epic 16.

### Stories
- As Michael, I want Intella to stop asking things I routinely ignore and learn the times I actually respond, so it fits my rhythm instead of fighting it.
- As Michael, I never want an ignored prompt re-pinged — let the best guess stand and fold the question into the next natural moment.
- As Michael, I want to set how each kind of signal is handled — sensed silently, confirmed, or asked — so the app matches my preferences.

### Context pack

**Schema.**
```prisma
ResponsivenessModel{ surface, hourBucket, answerRate, lastUpdated }   // recency-decayed when/where he responds
// reads CapturePrompt outcomes; writes into schedule() weighting
CaptureConfig{ ...perSignalPolicy(json) }   // per-signal silent/confirm/ask defaults, surfaced in Settings
```

**API.** `GET/PUT /capture/config` (per-signal policy + quiet hours). Responsiveness feeds `schedule()` internally.

**Resolutions in force:** reuses the v0.3 habit-learning machinery (recency-decayed weights, §3) applied to the capture layer; ties to R16's budget (adherence-aware spend — quieter when estimates are healthy, spend only when a plan-critical estimate goes stale). No-nag rule: never repeat an ignored prompt.

### Tickets
**T15.1 `ResponsivenessModel`.** Track answer rate by surface × hour bucket, recency-decayed. *AC:* answering nightly in-app but ignoring midday pushes raises the night bucket and lowers midday.
**T15.2 Down-weight ignored / concentrate in responsive windows.** Feed responsiveness into `schedule()`; never repeat an ignored prompt (assumed stands). *AC:* routinely-ignored prompt types stop pushing; pushes concentrate in responsive windows; an ignored prompt is not re-pinged.
**T15.3 Per-signal policy surface (Settings).** Each signal's silent/confirm/ask default + quiet hours editable. *AC:* setting a signal to "silent" stops its prompts; quiet-hours edits take effect.

### One-shot build checklist
- [ ] `ResponsivenessModel` learns answer rate by surface × time, recency-decayed.
- [ ] Scheduler down-weights ignored prompts and concentrates pushes in responsive windows; ignored prompts never re-ping.
- [ ] Per-signal policy + quiet hours editable in Settings.

---

## Epic 16 — Ambient Hardening

**Phase 16 · Make the ambient layer graceful when sensors go dark and honest about what's assumed.**

**Build outcome (definition of done).** The layer degrades gracefully when a HealthKit type or permission goes dark, when there's no smart scale (fall back to the VOI-gated weigh-in nudge, never a daily nag), and when there's no Watch (phone-only capture). Before the context engine has priors it behaves sensibly (motion + time-of-day only, low confidence). Across the v0.3 analytics surfaces, confirmed data is visibly distinguished from assumed, so Michael always knows how much of "where I stand" rests on ratified fact vs. Intella's assumptions — and that ratifying tightens it.

**Depends on:** Epics 12–15 · **Unlocks:** (ambient layer complete).

### Stories
- As Michael, I want the app to keep working when a sensor permission is off or a device is missing, so my setup choices never break capture.
- As Michael, I want a weigh-in only nudged when my weight trend is actually going stale, never a daily nag.
- As Michael, I want to see which parts of my record are confirmed versus still assumed, so I always know what's solid.

### Context pack

**Schema / config.** No new tables — hardens Epics 12–15. Per-signal degradation policy in `CaptureConfig`; confirmed-vs-assumed rendering reads `Observation.status` into the Epic 10 analytics surfaces.

**Resolutions in force:** **R17** confirmed/assumed distinction drives the analytics honesty indicators; **R16b** cold-start context priors; body-metrics playbook — scale reading is `confirmed`-grade (hardware, not a guess); no-scale weigh-in nudge fires **only** when trend-weight confidence is decaying (VOI gate), on wake.

**Fallback playbooks (v0.4 §8).** No HealthKit type → that signal goes dark, its `Observation`s stop, the estimator widens/decays. No scale → VOI-gated morning nudge. No Watch → phone-only motion/activity, no passive sleep/HRV, more reliance on prompts. Screen habits → not collected (an opt-in DeviceActivity focus-threshold nudge is the only feasible option and knows nothing about usage).

### Tickets
**T16.1 Graceful degradation on permission/type loss.** A revoked HealthKit type stops its capture cleanly; dependent estimators widen/decay rather than break. *AC:* revoking a type stops its `Observation`s and lowers dependent confidence without errors.
**T16.2 No-scale / no-Watch fallbacks.** VOI-gated weigh-in nudge when no scale; phone-only capture when no Watch. *AC:* with no scale, weigh-in is nudged only on decaying trend confidence; with no Watch, capture continues phone-only.
**T16.3 Cold-start context priors.** Before an HR baseline exists, the context engine uses motion + time-of-day priors marked low-confidence. *AC:* a fresh install classifies context at low confidence without a baseline and sharpens as the 7-day baseline fills.
**T16.4 Confirmed-vs-assumed indicators.** Analytics surfaces (Epic 10) distinguish confirmed from assumed data; ratifying visibly tightens confidence. *AC:* the position/trajectory surfaces show what rests on ratified vs. assumed data; confirming an observation tightens the relevant band.

### One-shot build checklist
- [ ] Revoked HealthKit type / permission degrades cleanly; dependent estimators widen, don't break.
- [ ] No-scale → VOI-gated weigh-in nudge; no-Watch → phone-only capture; screen habits not collected.
- [ ] Context engine cold-starts on motion + time priors and sharpens with the 7-day HR baseline.
- [ ] Analytics distinguish confirmed vs. assumed; ratifying tightens confidence.

---

*End of epics. Phases 0–16 each map to exactly one epic above; feed one epic (plus the Global Build Context) to a coding agent to build that phase in one shot. See `Intella_Product_and_Build_Plan.md` for the consolidated spine and `Intella_Preflight_Resolutions.md` for the full R1–R24 detail.*
