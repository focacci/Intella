# Intella — Product & Build Plan (Consolidated)

*Intelligent personal trainer + nutritionist and meal planner. Single-user, self-hosted, adaptive, explainable.*

**Version:** 0.9 (web-first build order) · **Date:** July 5, 2026 (build order revised 2026-07-27) · **Status:** Pre-code decisions locked (R1–R24). **Build sequence is web-first** — see §11. Web track in progress (Phase 2); the native/HealthKit track (Phase 6, then 12–16) is deferred until the web track ships.

> **What this document is.** A single consolidated spine that folds the whole design — the v0.2 foundation, the v0.3 adaptive-intelligence layer, the v0.4 ambient-capture layer, the v0.5 operational-hardening layer, the v0.6 data-residency/deployment layer, and the v0.7 preflight resolutions — into one plan. The five companion docs remain the deep-dive references; this file is the map. The build is split into **17 phases (0–16)**, and each phase has a self-contained, hand-off-ready epic in **`Intella_Epics_and_Stories.md`** — feed one epic to a coding agent and it can build that phase in one shot.

**Companion documents (deep-dive references):**

- `Intella Adaptive Intelligence Plan.md` (v0.3) — living profile, horizon planning, habit learning, trajectory analytics.
- `Intella_Ambient_Capture_and_Interaction.md` (v0.4) — sensor-first capture, assume-then-ratify, the interruption budget.
- `Intella_Operational_Completeness.md` (v0.5) — degraded modes, LLM gateway, backups, per-device tokens, safety boundary.
- `Intella_Data_Residency_and_Deployment.md` (v0.6) — residency map, offline sync protocol, Docker deployment.
- `Intella_Preflight_Resolutions.md` (v0.7) — every pre-code decision (R1–R24), each with a decision, a why, and a concrete change.
- `Intella_Epics_and_Stories.md` — the 17 phase-scoped build epics (the build hand-off documents).
- `schema.prisma` — the live Prisma 7 schema (source of truth for the data model).
- `openapi.yaml` — the API contract (v0.7.0) both clients are generated from.
- `Intella_Native_Wireframes.html` — high-fidelity native wireframes (iPhone, iPad, Watch).

---

## 1. Vision

Intella is a private, single-user coach that does three jobs well: it programs your training, plans your meals, and turns that plan into one clean, consolidated grocery list. It is *adaptive* — it learns from what you actually did (the workout you logged, the meal you swapped, what's in your pantry, what your Watch sensed) and re-parameterizes the next plan rather than handing you a static template.

**Guiding principles**

- **Personal first.** Every output is derived from *your* physiology, goals, history, and constraints — never a generic plan.
- **Adaptive, not static.** Feedback (logs, swaps, "felt easy/hard," sensor data) feeds the next cycle. *Reality overrides the formula.*
- **Affordable & doable.** Meals respect a budget (via recipe cost estimates), an effort ceiling, and your real cooking skill. Plans you won't follow are failures.
- **Private by default.** One user, self-hosted, your data on your machine.
- **Explainable.** The app can always answer "why this exercise / why this meal / why this much" — every artifact stores the `inputConstraints` that produced it.
- **It never just stops.** Every pillar keeps working on last-known-good data — no AI, a provider outage, a lost signal, or a week away never hard-stops the app.

---

## 2. The user & the inputs

You are the only user. The app is self-hosted on your desktop (Docker) and reached privately from your iPhone over Tailscale. Because it's single-user, auth stays minimal and the data model assumes one profile.

**Captured at onboarding** (5 steps; essentials-only, editable anytime):

1. **Physiology** — age, sex, height, weight, optional body-fat %, body measurements; **timezone** (R1), **unit-system display preference** (R6), **activity level** (R7).
2. **Goals** — structured target (`targetKind`/`targetValue`/`targetUnit` + human `note`) and `priority` (R4/R14); one or more concurrent goals.
3. **Training** — experience, days/week, session length, equipment, injuries/movement restrictions (hard constraints), optional **baseline lifts** for a warm start (R9).
4. **Nutrition** — dietary pattern, restrictions, allergies (hard excludes), dislikes, cuisines, cooking skill/effort ceiling, meals & snacks per day, weekly food budget (a **soft** guide, R12), variety tolerance.
5. **Review → "generating your first plan"** — hand-off into a populated Today screen.

**North-star outcomes:** you train consistently and progress; you eat to your goals without decision fatigue; you walk into the store with a complete, no-duplicates, pantry-aware list.

---

## 3. Product pillars & layers

Three pillars, a unifying **Today** view, and — layered on over time — an adaptive-intelligence engine, an ambient-capture layer, and operational resilience.

### Pillar 1 — Adaptive Training
Generate a multi-week program from profile + goal; daily session with target sets/reps/load and RPE pre-filled from last session; fast set logging; automatic progressive overload and deloads; exercise substitution (equipment, boredom, niggles); progress charts (volume, est-1RM, bodyweight); plain-language coaching notes. Safety envelope guards cap load jumps and rate of change (R for safety, §12).

### Pillar 2 — Meal Planning
Compute calorie/macro targets from profile + goal + activity level; generate a weekly plan within budget (soft), effort, time, and dietary constraints; recipe detail with steps and per-serving macros; one-tap constraint-aware swap; leftover/batch-cook awareness; running weekly cost estimate and macro adherence. Allergies are hard excludes the LLM can never override.

### Pillar 3 — Smart Grocery List
Aggregate every recipe ingredient for the week into consolidated quantities; canonicalize via an alias table and normalize units with density/piece data (R8); subtract pantry; round to real-world quantities; group by aisle; check items off as you shop (survives regeneration, R19); print/export. **Store-agnostic** — no prices or store accounts. Cross-store price optimization is explicitly deferred post-v1.

### Cross-cutting — Today dashboard & the adaptation loop
**Today** shows the day's workout, the day's meals, and a grocery nudge in one screen, with a coach-insight banner surfacing what the adaptation loop just changed and why. The **adaptation loop** is the spine: every log, swap, pantry update, and (later) sensor reading re-parameterizes the next generation.

### Layer A — Adaptive intelligence (v0.3 · Phases 7–11 · web track — build now)
A **living profile** in three tiers (declared facts → observed events → estimated parameters like TDEE, e1RM, adherence), continuously re-estimated on a scheduler. **Horizon planning** on one shared goal tree sized to the user's goals. **Habit learning** in three loops (fast/medium/slow). **Position & trajectory analytics** with an honest confidence cone and a plain-language "why it changed" log.

### Layer B — Ambient capture (v0.4 · Phases 12–16 · native track — deferred)
Sensor-first data acquisition on iOS/watchOS: HealthKit + CoreMotion feed the estimators passively. **Assume-then-ratify** — every sensed/inferred datum is written provisionally and drives the plan immediately; a non-blocking one-tap approval confirms or corrects it. A **capture ladder** (silent → ambient → notification → in-app) and a **value-of-information interruption budget** spend the user's attention as the scarce resource it is.

### Layer C — Operational resilience & residency (v0.5–v0.6 · woven throughout)
Degraded-mode ladder (every pillar works with no LLM), an LLM gateway (content-hash cache + local-model router + budget ceiling), nightly encrypted backups + restore test, per-device revocable tokens, a coach-not-clinician safety boundary, cold-start/re-baseline flows, and an offline sync protocol with a data-residency split (server = brain, device = offline cache + birthplace of in-the-moment data).

---

## 4. How the intelligence works (hybrid)

Every generator — training, meals, grocery, and each horizon node — follows the same three-layer pattern, which keeps cost low, output safe, and behavior explainable:

1. **Rules layer (deterministic):** compute hard constraints and numeric targets from your data. Cheap, reproducible, testable. This is where safety floors live.
2. **LLM layer:** make the human choices *within* those constraints — variety, substitutions, phrasing, interpreting free-text feedback. Always returns structured/tool-use JSON.
3. **Validator (deterministic):** reject/repair any LLM output that violates a constraint before it's saved.

| Pillar | Rules layer computes | LLM layer decides | Validator enforces |
|---|---|---|---|
| Training | Split from days/goal; weekly set-volume targets; progression (add reps→load, deload on stall); est-1RM (Epley); equipment/injury filter; safety envelope | Exercise selection & variety from the allowed menu; substitutions; coaching notes; parsing "knee felt off" | Volume within landmarks; no contraindicated/unavailable exercises; load jumps ≤ cap |
| Meals | BMR (Mifflin–St Jeor) × activity, goal-adjusted; macro & per-meal targets; budget/effort/time caps; allergy hard-excludes; calorie floor | Recipe choice/variety; recipe adaptation; batch-cook & leftover ideas | Macros within tolerance; zero allergens; cost **warns** (not rejects) when over budget (R12) |
| Grocery | Ingredient aggregation; canonicalization + unit normalization (density/piece); pantry subtraction; round to sensible quantities | Parse & clean each raw line into a shoppable item; assign aisle; substitution notes | Every ingredient covered; quantities sane; nothing left uncategorized; no LLM-invented density (R8) |

**The generate → validate → repair loop (R10), applied everywhere:** LLM returns tool-use JSON against a published, versioned schema → validator checks hard constraints → on violation, re-prompt with the specific violations (max 2 repairs) → still invalid, fall back to deterministic **degraded** output and persist the artifact with `degraded = true` + reason. **Never save invalid output; never hard-stop.** Provider/transport errors get their own retry-with-backoff, separate from validation repair.

**The LLM gateway (R20b, v0.5 §3).** Generators never call the Anthropic SDK directly; they call one gateway that does **cache-check → route → call → validate + log**. It looks up `hash(inputConstraints)` (canonical serialization: sorted keys, floats to 4 dp, explicit inclusion list covering referenced `PreferenceWeight`/`DietProfile`/`TrainingProfile`/`Goal` id + `updatedAt`) and returns the stored artifact with zero model calls on a hit. Routine, low-stakes calls route to a **local model** (Ollama); hard/creative calls go to **Claude**. The deterministic validator runs on either route, so a weaker local model can only dull quality — never emit an allergen or a contraindicated lift.

**Degraded-mode ladder (v0.5 §2.2).** Three named modes, all shippable: **Full** (Claude + local + providers), **Rules + local** (routine work on the local model, creative work templated/cached), **Rules-only** (no model reachable — targets computed, progression applied to the existing selection, last week's plan repeated or a built-in **seed** program/meal plan rendered for a blank-slate install (R18), grocery list fully built by deterministic aggregation + an ingredient→aisle lookup).

**Guardrails.** Allergies and injuries are *hard* rules the LLM can never override. Safety envelope guards (calorie floor, capped rate of change, capped load jumps) are deterministic limits in the rules layer. A red-flag detector defers anything medical to a professional (§12). Every generation stores the inputs that produced it, so results are reproducible and debuggable.

---

## 5. Data & integrations

**LLM.** Anthropic Claude API for hard/creative work; a local model (Ollama) for routine, structured calls — both behind the LLM gateway (cache + router + budget ceiling). Which generators the local model is good enough for is decided empirically by the eval set (R11); the router and the QA harness share one brain.

**Recipe & nutrition data.** **Spoonacular** primary (recipes, per-ingredient nutrition, ingredient→product mapping, meal-plan endpoint, free tier), behind a `NutritionProvider` interface. **USDA FoodData Central** as a free supplement (authoritative composition + portion/density data — also seeds ingredient density/piece values, R8). **Edamam** as a later fallback. Provider responses are **cached once, then reused** (R12): the provider is a fill source, not a request-time dependency; a single user converges on a stable ~50–100 recipe rotation, so provider dependence fades. A free-tier daily-call guard degrades gracefully rather than failing a week.

**Grocery list is store-agnostic.** It needs no price or store data. Recipe-level cost *estimates* drive the meal-plan budget check in Pillar 2, but they are estimates — never live prices — and the budget check is **soft** (validator warns, never rejects, R12).

**Deferred post-v1 (price optimization).** A `PriceProvider` interface (`KrogerPriceProvider` + a user-maintained `ManualPriceBook`) feeding a store-assignment optimizer, plus `Store`/`PriceEntry` entities. Bolts on without reworking the list. Omitted from v1 by design.

---

## 6. Information architecture (screens)

**Web — build now (Phases 0–5, then the adaptive-intelligence phases 7–11):** Onboarding · Today · Workout · Meal Plan · Grocery List · Settings, then the **Insights** surfaces (Position / Trajectory / Horizon). All render in the browser and need no native code — this is the full web-first track.

**Native — deferred (Phase 6, then 12–16):** the web screens above adapted for iPhone/iPad/Watch, plus the **Approvals & Capture** queue and the **iOS primitives** (Live Activity, home/lock widgets, Watch complication). None of these are built until the web track ships:

| Screen / surface | Purpose |
|---|---|
| **Onboarding** (5 steps) | Physiology · Goals · Training · Nutrition · Review → first-plan hand-off. |
| **Today** | Day's workout + meals + grocery nudge; coach-insight banner; degraded/offline indicators. |
| **Workout** | Session with live logging; exercise-swap picker (constraint-filtered + why); "something hurt" → adjust/safety flow; progress charts. |
| **Meal Plan** | Weekly grid; recipe detail; macro/cost-preserving swap options; running totals. |
| **Grocery List** | Consolidated, aisle-grouped list; check-off; pantry editor; export/print preview. |
| **Insights** (Position / Trajectory / Horizon) | State snapshot; projection fan-chart with confidence cone; horizon tree; "why it changed" log. |
| **Approvals & Capture** | Assume-then-ratify queue; micro-prompts; capture settings & interruption budget. |
| **System & Settings** | Edit forms for every profile area; masked API keys; system status/degraded mode; devices & sync; pairing/QR; restore/re-pair; safety flags. |
| **iOS primitives** | Live Activity (rest timer + active set); home/lock widgets; Watch complication. |

---

## 7. Data model (consolidated)

Single-user, so most tables carry no tenancy. Storage is **metric-canonical** (R6). SQLite has no native arrays/JSON, so list/blob fields are `String` holding JSON, parsed by Zod. Every generated artifact stores its `inputConstraints` (explainability) and a `constraintsHash`/`hashVersion` (cache, R20b). The full, authoritative definitions live in `schema.prisma`; this is the map.

**Sync conventions (R2/R3).** Syncable rows carry the **sync quartet** — `version Int`, `deletedAt DateTime?`, `clientId String?`, `updatedAt DateTime` — for offline merge. Ordering is one append-only **`ChangeLog`** table whose autoincrement PK *is* the monotonic `serverSeq` cursor. Polymorphic references use a discriminated `{refType, refId}` pair (closed enum; no cross-table FK); same-table trees use a real self-relation FK; id arrays stay advisory JSON. Reference/content tables (`Exercise`, `Recipe`, `Ingredient`, `IngredientAlias`) are server-seeded/cached and are **not** syncable.

### 7.1 Core (v1)

| Entity | Key fields | Notes |
|---|---|---|
| `Profile` | age, sex, heightCm, weightKg, bodyFat?, **timezone** (R1), **unitSystem** (R6), **activityLevel** (R7) | One row. |
| `Goal` | type, **targetKind/targetValue/targetUnit/note** (R4), **priority** (R14), startDate, status | Structured target; multi-goal via priority. |
| `TrainingProfile` | experience, daysPerWeek, sessionMins, equipment[], injuries[] (hard), **baselineLifts** (R9) | Drives program gen. |
| `DietProfile` | pattern, restrictions[], allergies[] (hard), dislikes[], cuisines[], cookingSkill, effortMax, kcal, macros{}, **budgetWeekly (soft, R12)**, mealsPerDay, snacksPerDay, batchCooking, variety | Allergy hard excludes. |
| `Exercise` | name, primaryMuscles[], equipment, pattern, difficulty, mediaUrl | Seeded library (reference). |
| `Program` | goalType, split, weeks, progressionScheme, inputConstraints, **calibrationWeeks** (R9), **degraded** (R10), status | A mesocycle. |
| `WorkoutSession` | programId, date, weekNo, label ("Calibration"), status, plannedItems[], coachingNote | One training day. |
| `SetLog` | sessionId, exerciseId, setNo, reps, weight, rpe | Append-only actuals (offline-authored). |
| `BodyMetric` | date, weightKg?, bodyFat?, measurements{} | Append-only progress. |
| `Recipe` | name, ingredients[], steps[], macrosPerServ{}, costEst, timeMins, tags[], sourceId, source | Provider-cached or LLM-adapted (reference). |
| `Ingredient` | canonicalName, defaultUnit, category, **aisleOrder/densityGPerMl/gramsPerPiece** (R8), nutritionRef | `category` drives aisle grouping (reference). |
| `IngredientAlias` | alias, ingredientId, source | Synonym → canonical (R8, reference). |
| `MealPlan` | weekStart, status, inputConstraints, constraintsHash, degraded | One per week. |
| `PlannedMeal` | planId, day, slot, recipeId, servings | A grid slot. |
| `PantryItem` | ingredientId, qty, unit | Subtracted from lists (device-authored). |
| `GroceryList` | planId, status (active/archived) | Archived, not deleted, on regen (R19). |
| `GroceryListItem` | listId, ingredientId?, displayName, qty, unit, category, checked, manual, sourceMeals[] | Check-off survives regen by `{listId, ingredientId}` (R19). |
| `Feedback` | domain, **refType/refId** (R3), structured, freeText, **status** raw/parsed (R5), clientId | User-authored signal only. |
| `ChangeLog` | serverSeq (PK, autoincr), tableName, rowId, op, clientId, ts | The sync cursor (R2). |

### 7.2 Adaptive intelligence (v0.3)

| Entity | Key fields | Notes |
|---|---|---|
| `MetricEstimate` | metric, value, confidence, windowStart/End, method, computedAt | Materialized Tier-3 state; scheduler-written. |
| `PlanNode` | level, parentId (self-FK, R3), goalId?, targets{}, milestones[], inputConstraints{}, status, projectedVsActual{} | The one shared horizon tree (R14). |
| `AdherenceEvent` | domain, plannedRef, actual, delta, causeParsed, cause{couldnt/wouldnt/unknown}, createdAt | Computed roll-up (distinct from Feedback, R5). |
| `PreferenceWeight` | domain, entityId, weight, lastUpdated | Recency-decayed learned weights. |
| `TrajectorySnapshot` | goalId, takenAt, projectedSeries[], confidence | Frozen projections for the cone/log history. |

### 7.3 Ambient capture (v0.4)

| Entity | Key fields | Notes |
|---|---|---|
| `SensorSample` | type, value, unit, source, start, end, ingestedAt | Raw Tier-2 events (HealthKit/CoreMotion); append-only. |
| `ContextState` | state, probability, start, end, inputs{} | Derived activity timeline; rolling window. |
| `Observation` | domain, refType/refId, value, **status** (inferred/assumed/confirmed/corrected), confidence, basis{}, createdAt, ratifiedAt | The assume-then-ratify belief record (R5/R17). |
| `CapturePrompt` | headline, assumedValue, chips[], resolvesRef, feedsEstimate, voiScore, contextGate[], surface, state, expiresAt | A materialized micro-prompt. |
| `ResponsivenessModel` | surface, hourBucket, answerRate, lastUpdated | Recency-decayed when/where the user responds. |
| `CaptureConfig` | dailyPushCap, quietHours{}, perSignalPolicy{}, connectedScale, calendarOptIn, locationOptIn, autoConfirmHours (72, R17) | Interruption budget + per-signal defaults. |

### 7.4 Operations (v0.5)

| Entity | Key fields | Notes |
|---|---|---|
| `ApiToken` | tokenHash, label, createdAt, lastUsedAt, revokedAt, expiresAt? | Per-device revocable auth (hash only). |
| `GenerationCache` | inputHash (unique), generator, artifactRef, model, route, constraintsHash, hashVersion, createdAt | Content-hash cache (R20b). |
| `LlmCall` | generator, route (local/claude), model, inputHash, tokensIn/Out, costEst, latencyMs, validatorPassed, createdAt | Cost + drift + router telemetry. |
| `SafetyFlag` | kind, detectedFrom, severity, message, acknowledgedAt, createdAt | Red-flag detector output. |
| `BackupRun` | path, sizeBytes, startedAt, finishedAt, ok, restoreTestedAt | Backup + restore-test log. |
| `OpsConfig` | dbPath, llmMonthlyCeiling, routerPolicy{}, localModelEndpoint, backupRetentionDays, safetyFloors{}, confidence/VOI constants (R13/R16/R16b) | User-tunable operational settings. |

Mutable rows that aren't event logs (`PlannedMeal.status`, `PantryItem`, `GroceryListItem.checked`, profile rows) carry `version` for conflict detection (R2/R3).

*Deferred post-v1:* `Store`, `PriceEntry` (+ `storeId`/`price` on grocery items) for price optimization.

---

## 8. API design

A single **`openapi.yaml` is the source of truth** (currently v0.7.0). The TypeScript web client and the Swift iOS client are both generated from it, so front-ends never drift from the backend. All routes are REST/JSON over bearer auth on the tailnet.

**Core & pillars (live at v0.7 surface):**

| Area | Endpoints |
|---|---|
| Profile | `GET/PUT /profile` · `GET/PUT /diet-profile` · `GET/PUT /training-profile` · `GET/PUT /goals` |
| Training | `POST /training/program:generate` · `GET /training/program/current` · `GET /training/session/today` · `POST /training/session/{id}/log` · `POST /training/session/{id}/feedback` · `GET /training/progress` · `GET /exercises` |
| Meals | `POST /meals/plan:generate` · `GET /meals/plan/current` · `PUT /meals/plan/{id}/meal/{slot}` · `GET /recipes/{id}` · `POST /meals/plan/{id}/feedback` |
| Grocery | `POST /grocery/list:generate` · `GET /grocery/list/current` · `PUT /grocery/list/item/{id}` · `GET/POST/PUT /pantry` |
| System | `GET /today` · `GET /health` |
| Sync/pair (stubs) | `POST /sync/push` · `GET /sync/pull?since=` · `GET /pair` |

**Added with their phases (documented, land per phase):**

| Layer | Endpoints |
|---|---|
| Estimates (v0.3) | `GET /estimates` · `GET /estimates/{metric}` |
| Horizons (v0.3) | `GET /plan/tree` · `GET /plan/node/{id}` · `POST /plan/node/{id}:regenerate` |
| Trajectory (v0.3) | `GET /trajectory/{goalId}` · `GET /trajectory/{goalId}/log` · `POST /adherence` |
| Signals/context/captures (v0.4) | `POST /signals/ingest` · `GET /context/current` · `GET /captures/pending` · `POST /captures/{id}:ratify` · `POST /captures/propose` · `GET/PUT /capture/config` |
| Auth/system/ops (v0.5) | `GET/POST/DELETE /auth/tokens` · `GET /system/status` · `GET/PUT /ops/config` · `GET /system/backups` · `GET /safety/flags` · `POST /safety/flags/{id}:acknowledge` |
| Sync (v0.6) | `POST /sync/push` (precedence apply, idempotent by clientId) · `GET /sync/pull?since=` (cursor + tombstones) · `GET /pair` (PIN-gated, R22) |

---

## 9. Tech architecture

**Backend (TypeScript):** Node + **Fastify** · **Prisma 7** ORM · **SQLite** (WAL mode) · **Zod** for request/response validation · Anthropic SDK behind the LLM gateway. Connection URL lives in `prisma.config.ts` (Prisma 7).

**Web (TypeScript):** **React + Vite** · **Tailwind CSS** + **shadcn/ui** · **TanStack Query** (server state) + Router. API client generated from OpenAPI.

**iOS (Phase 6+):** **SwiftUI**, separate codebase, Swift client generated from the same OpenAPI spec. Local store: **GRDB** (recommended, offline-first sync engine). Watch app for in-workout logging.

**Engines live in the API** as pure, unit-testable modules, each exposing `computeConstraints()` / `generate()` / `validate()` where applicable:

`training/` · `nutrition/` · `grocery/` — the three pillars.
`estimation/` (v0.3) — Tier-3 estimators + horizon planning + staleness; runs on a **scheduler**, not on request.
`capture/` (v0.4) — sensor ingest, context fusion, VOI scoring, prompt scheduling, ratification; part on-device, part server.
`llm/` (v0.5) — the gateway: router + content-hash cache + budget + degraded-mode enforcement.
`ops/` (v0.5) — backups (`VACUUM INTO`), retention, restore-test, migration helpers; on the scheduler.
`safety/` (v0.5) — red-flag detector (envelope guards live inside each engine's rules/validator).
`sync/` (v0.6) — push apply + precedence + pull cursor + tombstone purge.
`eval/` (v0.5, dev-time) — the golden-set quality harness; runs in CI, not shipped.

**Repo (pnpm monorepo):**

```
intella/
  openapi.yaml            # single source of truth for both clients
  schema.prisma           # data model
  prisma.config.ts        # Prisma 7 connection config
  compose.yaml            # Docker deployment bundle
  apps/api/               # Fastify + Prisma + SQLite + engines
  apps/web/               # React + Vite
  packages/shared/        # generated TS types/client, shared logic
  packages/eval/          # golden-set quality harness (dev-time)
  ios/                    # SwiftUI app + Watch (added Phase 6)
```

**Hosting & deployment (v0.6 §7).** Ship as a **Docker Compose** bundle (`restart: unless-stopped`) that runs identically on macOS, Windows (WSL2), and Linux. A `setup` entrypoint (safe to re-run) creates the data dir, enables WAL, runs Prisma migrations, seeds the exercise library + ingredient→aisle map, mints a per-device token, and renders a **pairing QR** behind a PIN-gated window (R22). Data + backups live in a bind-mounted `~/Documents/Intella`. Native-Node `pnpm dev` is the no-Docker fallback.

**Networking.** Tailscale on desktop + iPhone in one tailnet, MagicDNS, device approval on. Prefer **`tailscale serve`** for real HTTPS at `https://<machine>.<tailnet>.ts.net` (iOS App Transport Security wants HTTPS). No public ports.

**Auth.** **Per-device revocable bearer tokens** (`ApiToken`, hash-only). Mint one per device; revoke a lost one independently. Still a bearer token over Tailscale; no user system; the seam for real auth remains if it ever goes multi-user.

**Backups (R21).** Nightly `VACUUM INTO` a dated snapshot → **app-level symmetric encryption** (key in OS keystore: Keychain / DPAPI / libsecret) → configurable dir; retention ≈30 daily + a few monthly; a read-only restore smoke test each run; a "last good backup / last restore test" indicator in Settings. iCloud / Time Machine / offsite are optional replication targets, not the mechanism.

---

## 10. Data residency & offline (v0.6)

**Residency principle.** *The server is the system of record and the only brain; the device is a fast, offline-capable cache and the birthplace of anything that can only be captured in the moment.* The device never computes derived intelligence (estimators, LLM generation, provider lookups, aggregation/categorization, backups are all server-side). The device authors append-only events (which merge) or versioned mutable rows (which follow the precedence rule), queues them in a local outbox, and reconciles when the tailnet returns.

**Offline contract (R20).** The device can, offline: read last-synced plans; log every set; check off grocery and add manual items; mark meals eaten/swapped-to-cached; weigh in; edit pantry & settings; answer micro-prompts — all append-only/provisional. The device **cannot** generate or regenerate anything; on-device set pre-fill reads the last server-computed targets already on the session card. *The moment isn't blocked; the brain catches up.*

**Sync wire protocol (v0.6 §5).** `POST /sync/push` sends outbox rows in FIFO order; the server applies the **precedence merge** — append-only events upsert idempotently by `clientId` (they can't conflict); mutable rows resolve by the status lattice `corrected > confirmed > assumed > inferred` (R17), ties by last-writer. `GET /sync/pull?since={serverSeq}` returns every change past the cursor including tombstones, plus the new cursor — the channel by which server-computed derived data (fresh estimates, new plans, regenerated lists) reaches the device. Watch → iPhone → Server, one uplink via WatchConnectivity, de-duplicated by `clientId`.

**Auto-confirm ↔ correction-loss fix (R17).** Auto-confirm promotes `assumed → confirmed` only server-side, only after the 72 h window, and only if no pending device correction exists for that `refId`. Because `corrected` outranks `confirmed`, a late offline correction always wins.

---

## 11. The complete phased build plan

Each phase maps to exactly one self-contained epic in `Intella_Epics_and_Stories.md`.

> **Build order is now web-first (v0.9).** Phase numbers below are **stable identifiers**, but the *build sequence* is:
>
> - **Web track — build now** (no Apple Developer license; testable from the iPhone browser over Tailscale): **0 → 1 → 2 → 3 → 4 → 5 → 7 → 8 → 9 → 10 → 11**. Phases 7–11 are the adaptive-intelligence engines surfaced on **web** dashboards; they depend only on Phases 2–4 logging, not on the native app.
> - **Native track — deferred** (needs the Apple Developer Program + a Mac + devices on hand): **6**, then **12 → 13 → 14 → 15 → 16** — the SwiftUI/Watch app, offline sync, and all HealthKit/sensor capture.
>
> The table below stays in numeric order as a per-phase reference; follow the sequence above when deciding what to build next.

| Phase | Name | Delivers | Depends on |
|---|---|---|---|
| **0** | Foundations | Monorepo, Fastify skeleton, full schema (R1–R9 + `ChangeLog` + `IngredientAlias`), OpenAPI + client gen, web shell, seed data, backups, migration discipline, per-device tokens, `/system/status`, Docker setup + pairing, Tailscale Serve | — |
| **1** | Profile & onboarding | 5-step onboarding (structured goals, activity level, baseline lifts, timezone/units), profile/diet/training/goal endpoints, settings edit forms | 0 |
| **2** | Training engine | Exercise library, rules layer (+ calibration + safety guards), LLM layer, validator, generate→validate→repair loop, **LLM gateway**, **eval harness**, session view + logging, progression + feedback, progress charts, rules-only degraded mode | 1 |
| **3** | Nutrition engine | NutritionProvider/Spoonacular (+ cache + free-tier guard), macro rules (+ calorie floor), plan generation (soft budget), meal-plan UI, swap | 2 (gateway) |
| **4** | Grocery list | **Ingredient canonicalization + alias + density seed (T4.0)**, aggregation + pantry subtraction, categorization (LLM + validator), list UI with check-off + pantry editor + print/export | 3 |
| **5** | Integration & adaptation | Today dashboard, adaptation loop wired into all three generators, prototype hardening (empty/loading/error/offline/degraded), red-flag detector, calibration UX, eval in CI | 2–4 |
| **6** | iOS + sync + deployment | SwiftUI app + Watch, GRDB store, offline sync engine (push/pull/precedence/outbox), QR pairing + offline UX, Watch relay, Apple Developer + TestFlight | 5 |
| **7** | Estimation core | `MetricEstimate`, `estimation/` engine, TDEE/trend-weight/e1RM estimators, nightly recompute scheduler, confidence scoring (R13), cold-start constants (R16b) | 2–4 logging |
| **8** | Horizon planning | `PlanNode` tree, ladder derivation from goal dates, per-horizon generators, staleness → auto-regenerate, committed-vs-directional, feasibility validator (R15), multi-goal (R14) | 7 |
| **9** | Habit learning | `AdherenceEvent` + `PreferenceWeight`, medium-loop weekly modeling, couldn't-vs-wouldn't parsing, slow-loop method-check, re-baseline flow, learned weights into generators | 7–8 |
| **10** | Analytics surfaces | Position dashboard, trajectory fan-chart + confidence cone, `TrajectorySnapshot`, trajectory-delta "why it changed" log | 7–9 |
| **11** | Adaptive hardening | Cold-start priors → estimates, tunable-window config surface, empty/low-confidence states across new UI | 7–10 |
| **12** | Sensor bridge & context | HealthKit background delivery + CoreMotion ingest, `SensorSample` + `POST /signals/ingest`, context engine (R16), silent Rung-0 provisional `Observation`s | 6, 7 |
| **13** | Assume-then-ratify + capture ladder | `Observation` lifecycle (R17), approvals queue (Rung 3), notifications (Rung 2), widgets/Live Activities (Rung 1), App-Intent one-tap logging, sync precedence merge | 12 |
| **14** | VOI budget & scheduler | VOI scoring (R16), interruption budget + quiet hours + Focus/DND/context gating, right-moment delivery, batching/digest | 13 |
| **15** | Responsiveness learning & tuning | `ResponsivenessModel`, down-weight ignored prompts, concentrate pushes in responsive windows, per-signal policy surface | 14 |
| **16** | Ambient hardening | Graceful degradation on permission/type loss, no-scale/no-Watch fallbacks, cold-start context priors, confirmed-vs-assumed indicators across analytics | 12–15 |

---

## 12. Consolidated ticket index

Tickets are the atomic hand-off units; every one carries acceptance criteria (in the epics doc). **Build in the web-first sequence from §11** (0–5, then 7–11; the native track — 6 and 12–16 — is deferred); tickets within a phase parallelize where noted.

**Phase 0 — Foundations:** T0.1 Monorepo & tooling · T0.2 API skeleton + healthcheck · T0.3 Database & schema (R1–R9 + `ChangeLog` + `IngredientAlias`) · T0.4 OpenAPI scaffold + client gen · T0.5 Web shell · T0.6 Remote access (Tailscale) · T0.7 Backup & restore (OS-agnostic, R21) · T0.8 Migration discipline (expand/contract) · T0.9 Per-device tokens · T0.10 `GET /system/status` degraded-mode surface · T0.11 Sync metadata + `serverSeq`/`ChangeLog` · T0.12 Dockerized deployment + first-run setup + pairing (PIN, R22) · T0.13 Tailscale Serve HTTPS.

**Phase 1 — Profile & onboarding:** T1.1 Profile/diet/training/goal endpoints · T1.2 Onboarding flow (all 5 steps incl. activity level, structured goal, baseline lifts) · T1.3 Settings edit.

**Phase 2 — Training engine:** T2.1 Exercise library · T2.2 Rules layer (+ baseline/calibration, R9) · T2.3 LLM layer · T2.4 Validator + persistence · T2.5 Session view + logging · T2.6 Progression + feedback · T2.7 Progress charts · T2.8 LLM gateway (router + cache + rules-only) · T2.9 Golden-set eval · T2.10 Safety envelope guards (training).

**Phase 3 — Nutrition engine:** T3.1 NutritionProvider + Spoonacular (+ cache-once + free-tier guard, R12) · T3.2 Macro rules layer · T3.3 Plan generation (LLM + validator, soft budget) · T3.4 Meal-plan UI · T3.5 Swap · T3.6 Provider cache-first + quota backoff · T3.7 Local-model routing (eval-tuned) · T3.8 Safety envelope guards (nutrition — calorie floor).

**Phase 4 — Grocery list:** **T4.0 Ingredient canonicalization + alias + density seed (R8)** · T4.1 Aggregation + pantry · T4.2 Categorization (LLM + validator) · T4.3 Grocery list UI (check-off + pantry editor + print/export).

**Phase 5 — Integration & adaptation:** T5.1 Today dashboard · T5.2 Adaptation loop · T5.3 Prototype hardening (empty/loading/error/offline/degraded, R23) · T5.4 Generation-quality eval harness in CI (R11) · T5.5 Red-flag detector + `SafetyFlag` · T5.6 Calibration UX (cold-start).

**Phase 6 — iOS + sync + deployment:** T6.0 Apple Developer enrollment + TestFlight pipeline · T6.x Sync endpoints + engine (`/sync/push`·`/pull`, precedence, outbox) · T6.y iOS pairing + offline UX · T6.z Watch relay.

**Phase 7 — Estimation core:** T7.1 `MetricEstimate` + `estimation/` engine · T7.2 TDEE/trend-weight/e1RM estimators (R16b windows) · T7.3 Nightly recompute scheduler · T7.4 Confidence scoring (R13).

**Phase 8 — Horizon planning:** T8.1 `PlanNode` tree + ladder derivation (R14) · T8.2 Per-horizon generators · T8.3 Staleness detection + auto-regenerate · T8.4 Feasibility validator + advisory nodes (R15).

**Phase 9 — Habit learning:** T9.1 `AdherenceEvent` + `PreferenceWeight` · T9.2 Medium-loop weekly modeling · T9.3 Couldn't-vs-wouldn't parsing + slow-loop method-check · T9.4 Re-baseline / dead-month flow.

**Phase 10 — Analytics surfaces:** T10.1 Position dashboard · T10.2 Trajectory fan-chart + cone · T10.3 `TrajectorySnapshot` history · T10.4 Trajectory-delta log.

**Phase 11 — Adaptive hardening:** T11.1 Cold-start priors → estimates · T11.2 Tunable-window config surface · T11.3 Empty/low-confidence states.

**Phase 12 — Sensor bridge & context:** T12.1 HealthKit background delivery + CoreMotion ingest · T12.2 `SensorSample` + `POST /signals/ingest` · T12.3 Context engine (R16) · T12.4 Silent Rung-0 provisional `Observation`s.

**Phase 13 — Assume-then-ratify + capture ladder:** T13.1 `Observation` lifecycle (R17) · T13.2 Approvals queue (Rung 3) · T13.3 Actionable notifications (Rung 2) · T13.4 Widgets/Live Activities/App Intents (Rung 1) · T13.5 Sync precedence merge + idempotency keys.

**Phase 14 — VOI budget & scheduler:** T14.1 VOI scoring (R16) · T14.2 Interruption budget + quiet hours + gating · T14.3 Right-moment event-driven delivery · T14.4 Batching/digest.

**Phase 15 — Responsiveness learning & tuning:** T15.1 `ResponsivenessModel` · T15.2 Down-weight ignored / concentrate in responsive windows · T15.3 Per-signal policy surface.

**Phase 16 — Ambient hardening:** T16.1 Graceful degradation on permission/type loss · T16.2 No-scale / no-Watch fallbacks · T16.3 Cold-start context priors · T16.4 Confirmed-vs-assumed indicators.

---

## 13. Preflight resolutions quick reference (R1–R24)

Full detail in `Intella_Preflight_Resolutions.md`. Each epic embeds the resolutions it depends on.

- **R1** Timezone: `Profile.timezone` (IANA) + UTC storage define "today." *(Phase 0)*
- **R2** Sync ordering: one append-only `ChangeLog`, PK = `serverSeq`. *(Phase 0)*
- **R3** Polymorphic refs: `{refType, refId}` pair; sync quartet on syncable tables. *(Phase 0)*
- **R4** `Goal.target` structured (kind/value/unit + note) + `priority`. *(Phase 0/1)*
- **R5** `Feedback` = authored; `Observation`/`AdherenceEvent` separate. *(Phase 0)*
- **R6** Canonical-metric storage + `Profile.unitSystem` display pref. *(Phase 0/1)*
- **R7** `Profile.activityLevel` seeds TDEE. *(Phase 0/1)*
- **R8** Ingredient canonicalization: density/gramsPerPiece/aisleOrder + `IngredientAlias`. *(Phase 0/4)*
- **R9** First-program cold start: `baselineLifts` or a calibration week. *(Phase 2)*
- **R10** Generate → validate → repair (≤2), then deterministic `degraded` fallback. *(Phases 2–4)*
- **R11** Generation-quality eval harness (`eval/`, T5.4). *(Phase 5)*
- **R12** Provider cache-once + free-tier guard; budget check hard→**soft**. *(Phase 3)*
- **R13** Confidence = defined `[0,1]` formula with bands. *(Phase 7)*
- **R14** One shared horizon tree + `Goal.priority` for multi-goal. *(Phase 8)*
- **R15** Feasibility never blocks — auto-relax (timeline→rate→volume) + advisory node. *(Phase 8)*
- **R16** VOI + interruptionCost on `[0,1]`; weighted-evidence context engine + HR baseline. *(Phases 12/14)*
- **R16b** One reconciled cold-start constants table. *(Phase 7)*
- **R17** Precedence lattice `corrected > confirmed > assumed > inferred`; 72 h auto-confirm with no-pending-correction precondition. *(Phases 13/6)*
- **R18** Built-in seed program + meal plan for the blank-slate + LLM-down cell. *(Phases 0/2/3)*
- **R19** Check-off survives regen via `{listId, ingredientId}`; archive-not-delete. *(Phase 4/6)*
- **R20** Offline = loggable, not generatable; on-device pre-fill reads server targets. *(Phase 6)*
- **R20b** Canonical constraint-hash serialization + `constraintsHash`/`hashVersion`. *(Phase 2)*
- **R21** OS-agnostic app-level backup encryption. *(Phase 0)*
- **R22** `/pair` PIN-gated pairing window (403 otherwise). *(Phase 0)*
- **R23** Empty/loading/error/offline/degraded states + missing screens/flows (T5.3). *(Phase 5)*
- **R24** What only Michael can supply (data, not design) — see §14.

---

## 14. Open decisions — what still needs Michael (data, not design)

These are inputs, not design gaps; captured at onboarding or as a config value. They don't block Phase 0.

- **Real profile numbers** — age, height, weight, body-fat, **activity level** (R7), **baseline lifts** (R9).
- **Structured goal(s) + priority** (R4/R14) — e.g. `{kind: rate, value: -0.5, unit: kg_per_week, note: "cut for summer"}`.
- **Diet** — pattern, allergies (hard), dislikes, cuisines, cooking skill, meals/snacks per day, **weekly budget** (a soft guide now, R12), variety tolerance.
- **Grocery grouping default** — aisle (default) / recipe / flat.
- **Spoonacular vs. curated recipe set** — start with the API or curate a small personal library.
- **Monthly LLM dollar ceiling** — the number for `OpsConfig.llmMonthlyCeiling` (mechanism specified; single-digit dollars realistic).

**Device/infra calls (before their phase, not Phase 0):** GRDB vs SwiftData (before Phase 6) · Tailscale Serve vs ATS exception · local-notifications-first vs APNs (revisit Phase 12) · exact HealthKit type list + derived-only shipping (before Phase 12) · on-device retention window (~8–12 weeks) · local model choice (eval-tuned, a starting pick before Phase 3) · backup retention specifics + directory.

**Explicitly deferred post-v1:** cross-store price optimization & per-store pricing (Kroger API + manual price book + optimizer), send-to-cart (Instacart), whole-day scheduling & ecosystem integrations (Reminders/Notes/Calendar/Cozi/Fitbit), photo-based calorie logging, multi-user/social. Revisit once the three pillars are validated.

---

## 15. Suggested next steps

1. Supply the §14 inputs (onboarding captures most; the engines need real numbers to produce real plans).
2. Hand **Epic 0 (Phase 0 — Foundations)** from `Intella_Epics_and_Stories.md` to the coding agent to scaffold the repo, schema, OpenAPI contract, seed data, Docker setup, and remote access.
3. Proceed phase by phase, feeding one epic at a time; fill onboarding with real data after Phase 1 and pressure-test the engines as Phases 2–4 land.
4. Decide the device/infra calls above as each relevant phase approaches.

*This consolidated plan supersedes the v0.2 foundation as the working spine; the companion docs remain the detailed rationale for each layer.*
