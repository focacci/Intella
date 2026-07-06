# Intella — Operational Completeness & Resilience

*How Intella stays trustworthy, affordable, durable, and safe once it's a real system you run for years — by extending the principles it already has rather than bolting on new ones.*

**Version:** 0.5 (planning) · **Date:** July 4, 2026 · **Status:** Feature design — hardens v0.2–v0.4 scope
**Companion to:** `Intella_Product_and_Build_Plan.md` (v0.2), `Intella Adaptive Intelligence Plan.md` (v0.3), `Intella_Ambient_Capture_and_Interaction.md` (v0.4), `Intella_Epics_and_Stories.md`, `Intella_UI_Wireframes.html`, `openapi.yaml`

---

## 0. What this document adds

v0.2–v0.4 defined *what* Intella produces, how it adapts, and how it captures data with minimal friction. They assumed the happy path: the Claude API answers, Spoonacular is up, the database is intact, the phone syncs, and there's enough history to estimate from.

This document closes the operational gaps that surface when those assumptions break — the ones between "a great design" and "a system I can depend on for years." It covers eight areas raised in review: operational resilience, cost control, data durability, schema migrations, LLM quality assurance, security, iOS distribution, cold-start/degraded states, the coaching-vs-medical boundary, and offline sync conflicts.

**The central claim of this document:** these are not eight new subsystems. They are mostly the *same principle* — the one already running through v0.3 and v0.4 — applied to new failure surfaces. Where that's true, the "fix" is cheap because the machinery exists. Where something genuinely new is needed, it's small and additive. Nothing here breaks the locked posture: single-user, self-hosted, Tailscale-private, hybrid `rules → LLM → validator` intelligence, store-agnostic grocery list.

---

## 1. The unifying principle — graceful degradation to last-known-good

Three ideas already committed to are, on inspection, one idea:

- **Assume-then-ratify** (v0.4 §7): every datum is written provisionally and drives the plan immediately; the plan never blocks on the user.
- **Confidence as the throttle** (v0.3 §1.4, §4): every estimate carries confidence; low confidence → conservative behavior and wider projection bands.
- **Fail soft** (Michael's resilience rule): automated failures fail silently, log, and retry later; interactive failures are caught, logged, surfaced non-blockingly, and the user continues.

Collapse them and you get **Intella's operating principle:**

> *Always degrade to the last-known-good state, mark what's provisional with confidence and provenance, reconcile when reality returns, and never hard-stop.*

Read that way, most of the "gaps" are instances of the same pattern. The table below maps each operational risk to the existing mechanism it reuses — which is why the plan gets *more complete without getting much bigger*.

| Operational risk | Existing mechanism it reuses | Net-new work |
|---|---|---|
| Claude API times out / returns junk | Persisted `inputConstraints` + validator → last plan stands (like `expired_assumed`) | Retry policy + a named degraded mode |
| Spoonacular/USDA outage or quota | `NutritionProvider` interface + local recipe cache | Cache-first read + quota backoff |
| Cost overrun | Everything already keyed on `inputConstraints` | A model router + a content-hash cache |
| Thin data at startup (cold-start) | Confidence-as-throttle (v0.3) | Calibration UX, not a new engine |
| Multi-week gap (dead month) | Confidence *decay* on staleness (v0.3) | A re-baseline flow |
| Offline write conflicts (web + iOS) | `Observation` status lifecycle (v0.4) | Status-precedence merge + idempotency keys |
| Lost phone | Tailscale device removal | Per-device revocable tokens |
| Sparse but irreplaceable history | (none — this is the real gap) | Consistent nightly backups + restore test |

Two areas — **durability/backup** and the **coaching/medical boundary** — are *not* covered by existing machinery. Those are the genuinely new pieces and get the most attention below.

---

## 2. Operational resilience

Michael's rule, adopted verbatim as the spine: **automated work fails silently, logs, and retries later; interactive work is caught, logged, surfaced non-blockingly, and the user keeps going.** Three refinements make it concrete.

### 2.1 LLM failure modes — a failed regeneration is a no-op

Because every artifact (`Program`, `MealPlan`, `GroceryList`, every `PlanNode`) persists the `inputConstraints` that produced it, and the prior artifact stays in the database, a failed Claude call has a *free, valid fallback*: the plan that's already there.

The generator wraps every LLM call in a small state machine:

1. **Transient error** (timeout, 429 rate-limit, 5xx) → exponential backoff, a few retries.
2. **Unparseable / schema-invalid output** → this is *already handled* by the validator layer. Treat it as a failed attempt: repair-or-reject, retry up to N times with a tightened prompt.
3. **Ultimate failure** → keep the current artifact, log the failure, and:
   - if the call was **automated** (scheduled regeneration): silent, retry on the next scheduled run.
   - if the call was **interactive** ("regenerate my week"): a non-blocking banner — *"Couldn't refresh your plan just now — showing your current one. I'll retry tonight."* The user cancels or continues; nothing is lost.

### 2.2 The degraded-mode ladder — every pillar works with no LLM at all

Make this an explicit **design constraint, not an accident:** *every pillar must produce a usable result with the Claude API fully unavailable.* The rules and validator layers are deterministic and need no model. There are three named modes:

| Mode | Available | Behavior |
|---|---|---|
| **Full** | Claude + local model + providers | Normal quality: fresh variety, phrasing, creative sequencing. |
| **Rules + local** | Local model + providers | Routine LLM work runs on the local model (§3); creative work degrades to templated/cached. |
| **Rules-only** | Neither model reachable | Deterministic everything: targets computed, progressive-overload applied to the *existing* exercise selection, last week's meal plan repeated or pulled from cached recipes, grocery list fully built (aggregation, pantry subtraction, unit normalization are pure rules; line-cleaning falls back to a deterministic ingredient→aisle lookup). |

Rules-only is a real, shippable mode — the grocery pillar is ~90% deterministic already, and training progression is pure math. The system stays *useful*, just less "delicious," exactly the v0.2 framing of why the split exists. *(→ Resolved in v0.7 (R18): the blank-slate cell — a fresh install with no cache **and** no LLM — is covered by a built-in deterministic seed program + seed meal plan, labelled "starter plan," since there's nothing yet to repeat.)*

### 2.3 Third-party outages and quota

The `NutritionProvider` interface already isolates Spoonacular/USDA. Add two behaviors:

- **Cache-first reads.** Every recipe/nutrition response is cached locally (the schema already treats `Recipe` as locally cached). A plan can regenerate from the local library with zero external calls. Recipe macros are effectively immutable, so **stale tolerance is indefinite** — there is no correctness cost to serving a months-old cached recipe.
- **Quota backoff.** Track remaining provider quota. As it runs low, stop fetching *new* recipes and reuse the cached set. A single-user app converges on a stable rotation of ~50–100 recipes within a few weeks, so provider dependence naturally fades — the outage window shrinks the longer the app is used.

---

## 3. Cost control & the model router

**Michael's direction:** the budget is user-configurable; the app is as efficient as possible with paid API calls and uses a **local LLM for routine tasks.** This is a real architectural addition, and it unifies three problems into one component.

### 3.1 The LLM gateway (router + cache + budget)

Every generator stops calling the Anthropic SDK directly and instead calls a single **LLM gateway**. The gateway does four things in order: **cache-check → route → call → validate + log.**

**Routing is by difficulty × safety-criticality:**

| Route | Handles | Examples |
|---|---|---|
| **Local model** (Ollama on the same desktop that hosts the API) | Routine, structured, low-stakes calls | Clean an ingredient line + assign an aisle; parse "knee felt off" → `{injury:…}`; "couldn't vs. wouldn't" classification; coaching-note phrasing |
| **Claude API (paid)** | Hard, creative, high-value calls | Initial program design; weekly meal-plan generation to macros/budget/variety; horizon sequencing & feasibility narration |

The safety guarantee is unchanged in either route: **the deterministic validator runs on the output regardless of which model produced it.** A weaker local model can only degrade *quality* — it can never emit an allergen or a contraindicated lift, because the validator rejects that deterministically. This is what makes routing to a small local model safe.

### 3.2 Caching by content hash — the biggest lever

Before any model is called, the gateway looks up `hash(inputConstraints)`. If nothing feeding a generation has changed, it returns the stored artifact and calls *no* model. Because the entire app is already built on stored `inputConstraints`, this is nearly free to implement and is the single largest cost saver: a personal app regenerates a week's plan once or twice a week, not on every screen open. *(→ Resolved in v0.7 (R20b): the hash uses a canonical serialization — sorted keys, floats to 4 dp, explicit inclusion list covering referenced `PreferenceWeight`/`DietProfile`/`TrainingProfile`/`Goal` id+`updatedAt` — with `constraintsHash`/`hashVersion` stored, to avoid silent misses and stale reuse.)*

### 3.3 Budget-aware degradation and configurability

The gateway reads a user-set **monthly ceiling** and tracks spend-to-date. As spend approaches the ceiling, it degrades gracefully rather than cutting off: it raises the cache-hit threshold and shifts borderline calls from Claude to the local model — i.e., it slides from **Full** toward **Rules + local** (§2.2). The user can also force-local (maximize savings) or force-Claude (maximize quality) per generator.

### 3.4 Realistic cost

With content-hash caching plus local routing, paid-Claude volume is a handful of substantial calls per week — roughly one program regeneration, one meal-plan regeneration, and the occasional horizon re-plan — which lands in **single-digit dollars per month** even on a generous setting. The configurable ceiling is therefore more a safety cap than a real constraint, which is the desired outcome.

### 3.5 The router shares its brain with the eval set

The decision of *which* generators the local model is good enough for is not guesswork — it's the output of the golden-set eval (§4). Any generator where the local model clears the validator + quality bar is routed locally; everything else stays on Claude. **The cost router and the QA harness are the same tool used two ways.**

---

## 4. Testing & LLM quality assurance

Right-sized for a one-person project — the deterministic layers carry the safety burden, so the LLM eval can stay light.

### 4.1 Deterministic layers get ordinary unit tests

The rules and validators are pure functions and are where every safety guarantee lives (macro tolerance, zero allergens, injury exclusions, volume landmarks, budget ceilings, safe-envelope guards from §9). These are the testing priority and are already specified in the v0.2 tickets. Keep them exhaustive.

### 4.2 The LLM layer gets a golden-set, and the validator does the heavy lifting

Keep a small folder of ~15–30 saved `inputConstraints` cases per generator. The harness runs the generator on each and asserts **(a) the validator passes** and **(b) a few quality properties hold** — e.g., a meal plan is within macro tolerance, has zero allergens, and offers ≥ N distinct recipes; a program hits volume landmarks with no contraindicated pattern. Note these are *property* checks, not exact-output matches (LLM output is non-deterministic). The eval is essentially "validator pass-rate + a handful of quality metrics over a fixed input set" — cheap, and it reuses the validator you're already building.

### 4.3 Drift detection and model pinning

Pin the exact model string. Run the golden set whenever a prompt is edited or the model version is bumped, and compare pass-rate + quality metrics against the previous run (store each run as a JSON artifact). A regression shows up as a pass-rate drop. The same set is the migration gate when Anthropic deprecates a pinned model.

**Framing to remember:** the **validator is the safety net, the eval set is the quality net.** A bad model release can dull Intella's output but architecturally cannot make it *unsafe*.

---

## 5. Data durability & backup

This is one of the two genuinely new areas — a single-file SQLite database accumulating years of irreplaceable Tier-2 history is the highest-severity risk in the whole project, and it currently has only "iCloud syncs the folder" behind it.

### 5.1 Storage location (adopting Michael's plan)

The database lives on the local machine at a **configurable path**, defaulting to an iCloud-backed location — `~/Documents/Intella/intella.db`. Persisting through iCloud/Time Machine is the baseline. The additions below make that baseline trustworthy.

### 5.2 The sharp edge, and the fix

iCloud or Time Machine copying a *live, always-open* SQLite file can capture a torn or inconsistent write. Fixes, all cheap:

- **Enable WAL mode** — better crash safety and concurrency for an always-on service.
- **Nightly `VACUUM INTO 'intella-YYYY-MM-DD.db'`** into the iCloud-backed folder. `VACUUM INTO` produces a clean, consistent snapshot *while the database is in use* — no need to stop the server. Keep ~30 daily snapshots plus a few monthly (simple retention). This is the single most important addition in this document: it converts "a file iCloud happens to sync" into "a consistent snapshot I can actually restore from."

### 5.3 A backup is a hope until it's restored

Include a **restore test** in the same nightly job (or quarterly): open the latest snapshot read-only and run a couple of sanity queries; record the result. Surface "last good backup: N hours ago; last restore test: passed" somewhere in Settings — consistent with Intella's existing habit of showing data freshness. A `BackupRun` record (§12) powers this and lets the app nag if backups go stale.

### 5.4 Encryption at rest

The database holds biometrics, so protect the file: *(→ Resolved in v0.7 (R21): durability no longer leans on iCloud — the nightly snapshot gets **OS-agnostic app-level symmetric encryption** (key in Keychain / DPAPI / libsecret); iCloud / Time Machine / offsite become optional replication targets, not the encryption mechanism.)*

- **Default (recommended): FileVault + iCloud Advanced Data Protection.** Whole-disk encryption on the desktop, end-to-end-encrypted iCloud sync so Apple can't read the synced snapshots. This is strong and zero-friction.
- **Heavier option: SQLCipher** — encrypt the database itself, independent of the OS, if you're specifically worried about the file being copied off a running machine. Costs some Prisma integration friction; only worth it if you want at-rest encryption that doesn't depend on the disk being locked.
- **Data minimization** reduces exposure regardless: ingest only the HealthKit types the estimators use (the v0.4 table is already scoped), and keep raw high-frequency `SensorSample`/`ContextState` on a rolling window (v0.4 already derives context rather than storing it raw forever).

---

## 6. Schema migrations & backfill

The good news: the v0.3/v0.4 deltas are almost entirely **additive**, which makes them the safe kind of migration.

### 6.1 Discipline from day one

Use **Prisma Migrate** with committed migration files in git — *never* `prisma db push` against real data. Adopt the **expand/contract** pattern for any non-additive change: add a column nullable, backfill it, and only enforce `NOT NULL` in a *later* migration if ever needed. Every migration runs against a copy of the latest backup (§5) before touching the live database, so each migration is preceded by a restore point.

### 6.2 The v0.3/v0.4 deltas are new tables

`MetricEstimate`, `PlanNode`, `AdherenceEvent`, `PreferenceWeight`, `TrajectorySnapshot` (v0.3) and `SensorSample`, `ContextState`, `Observation`, `CapturePrompt`, `ResponsivenessModel`, `CaptureConfig` (v0.4) are all *new* tables. Adding tables is non-destructive — no backfill of existing rows required for any of them.

### 6.3 The one real backfill question — resolved by "null means confirmed"

v0.4 says existing `SetLog`/`BodyMetric`/meal-eaten rows "gain an `Observation` status wrapper." Do **not** retrofit history. Instead, **treat the absence of an `Observation` as an implicit `confirmed`** — anything logged before the sensor era was hand-entered, and hand-entered data is user-confirmed truth by definition. So the migration adds the `Observation` table and a nullable link; only *new* sensor/inferred data from Phase 12+ creates `assumed` records. Zero-risk, and semantically correct.

### 6.4 Estimator "backfill" is a one-time job, not a migration

When Phase 7 lands, the estimators fit over whatever Tier-2 history already exists — that's their design. So "backfilling" `MetricEstimate` is just running `estimation/recompute()` once over existing events, not a SQL migration. Same for horizon nodes: they're derived on demand from goals.

### 6.5 The Postgres path (deferred, noted)

Many fields are JSON-encoded strings for SQLite. If Intella ever goes multi-user on Postgres, converting those to native `Json`/arrays is a single mechanical pass; keeping Zod as the parse layer means app code doesn't care which backend is underneath. Not needed for v1 — recorded so the door stays open.

---

## 7. Security beyond the bearer token

The threat model for a single-user, Tailscale-only service is narrow: a lost phone, a leaked database file, or a device dropping off the tailnet. The response is right-sized — no OAuth, no user system.

### 7.1 Per-device revocable tokens

Replace the single static token with a tiny **token table** (`ApiToken`, §12): id, token *hash*, label, `createdAt`, `lastUsedAt`, `revokedAt`, optional `expiresAt`. The UX is unchanged (still a bearer token), but now you mint one per device — "iPhone," "MacBook" — and can **revoke one** (lost phone) without disturbing the others. Only the hash is stored. Optional expiry enables rotation if wanted; for personal use, manual revoke is enough.

### 7.2 Tailscale as the outer layer, and the runbooks

Tailscale is the primary control. **Lost phone:** remove the device from the tailnet (it then can't even reach the API) *and* revoke its token — defense in depth. Enable **device approval** so nothing joins the tailnet without explicit OK. **Re-imaged desktop:** the API needs its `.env`/token restored from a password manager and Tailscale re-authenticated — document this as part of the §5 restore runbook so recovery is a checklist, not a memory test.

### 7.3 HealthKit data at rest

Layered: encrypted on-device by iOS; encrypted in transit by Tailscale/WireGuard; at rest on the desktop, protected by **FileVault + iCloud ADP** (§5.4), with **SQLCipher** as the heavier option. Plus the **data-minimization** rule (§5.4). No single-user app needs more than this, and most need less.

### 7.4 Secrets hygiene

Anthropic and Spoonacular keys live in `.env` or the OS keychain, never in git. Obvious, but stated because the wireframes surface API keys in Settings.

---

## 8. Distribution (iOS) — recommendation: pay for the Developer Program

You asked me to pick. **Enroll in the paid Apple Developer Program ($99/yr) and install to yourself via TestFlight.**

Rationale: the free personal team's signing certificate **expires every 7 days**, so the app would die weekly and need re-plugging into Xcode to re-sign. For an app whose entire value is *ambient, always-on background sensing* — HealthKit background delivery, Live Activities, interactive widgets — a 7-day death is fatal to the core design, not a minor annoyance. The free tier also can't reliably use the background/push entitlements v0.4 depends on and caps you at three sideloaded apps.

The paid program gives **1-year signing**, **TestFlight** (install once, updates arrive over-the-air — no cable, no Xcode ritual), and the push/background/Live-Activity entitlements the ambient layer needs. Path: enroll as an individual → build in Xcode → distribute to yourself through TestFlight internal testing.

**Design implication worth naming:** this choice *gates how much of v0.4 is worth building.* Paid unlocks the ambient-capture vision. If you decline the $99, keep the iOS layer to a thin manual-logging app and treat v0.4 as aspirational — the 7-day expiry and background limits would undercut the whole ambient design, so there'd be little point building it.

---

## 9. Cold-start & degraded data states

### 9.1 Cold-start is the low-confidence end of a system you already have

Before ~2–3 weeks of data exists, Tier-3 estimates fall back to onboarding formulas (Mifflin–St Jeor, Epley, a default activity multiplier) explicitly stamped **low confidence**. The plan still generates, but it *hedges* — smaller calorie deltas, gentler load jumps, wide projection cones — which is exactly v0.3's confidence-as-throttle behavior. There is **no separate cold-start engine**; cold-start is simply "confidence is low because data is thin."

### 9.2 The missing piece is UX, and it turns the weakness into the honesty story

Design weeks 1–3 as explicit **calibration.** Estimate cards read *"based on your starting numbers — this sharpens as you log,"* the trajectory fan chart starts visibly wide, and the app asks only for the highest-VOI inputs (a few weigh-ins, a couple of session confirmations) to calibrate faster. This does double duty: it sets honest expectations *and* motivates the early logging the estimators need — dissolving the cold-start chicken-and-egg. The low-confidence dashboard is just the normal dashboard with wide bands and "estimate" labels; every number already shows its freshness (v0.3 §4.1).

### 9.3 The dead month — a confidence-decay problem plus one new flow

A genuine multi-week gap (injury, travel, illness) is distinguished from a one-off skip by the **staleness decay** v0.3 already applies: estimates decay toward low confidence, so on return the plan auto-hedges instead of assuming you're where you left off. Add one explicit rule: a gap beyond ~2 weeks triggers a **"welcome back / re-baseline"** flow — the plan re-enters calibration mode rather than resuming old loads, and if the cause was injury, the hard-constraint path engages (and a return-to-training deload is offered). The v0.4 "couldn't vs. wouldn't" capture already separates a work trip from quitting, so the model doesn't learn the wrong lesson. **Single skip → redistribute the week (fast loop). Dead month → decay + re-baseline.**

---

## 10. Safety & the coaching/medical boundary

The second genuinely new area. Intella pushes plans automatically on *assumed* data, so its safety floor must be deterministic and cannot wait on ratification — which makes an explicit boundary more important here than in an ordinary fitness app.

**Design principle (one line, adopt verbatim):**

> *Intella is a coach, not a clinician. It modifies training and nutrition within standard healthy-adult bounds, and defers anything medical — pain beyond normal soreness, injury diagnosis, disordered-eating patterns, medication or medical-condition interactions — to a doctor or physical therapist rather than advising on it.*

Two mechanisms make it real, both reusing the hard-constraint pattern:

- **Deterministic envelope guards.** The rules layer refuses to generate outside safe bounds — a minimum calorie floor, a capped rate of loss/gain, capped session-to-session load jumps. These are non-negotiable limits the LLM cannot exceed, the same class of guarantee as allergen exclusion.
- **A red-flag detector.** If parsed feedback/free-text mentions sharp or persistent pain, dizziness, or fainting, or if the adherence + weight-trend pattern resembles disordered eating, Intella surfaces a *"this is beyond what I should coach — consider a professional"* message (a `SafetyFlag`, §12) instead of silently adjusting a number.

This is both responsible for a health-adjacent tool and aligned with the product's existing "hard rules the LLM can't override" philosophy.

---

## 11. Sync & conflict resolution

Once web and iOS both write — and iOS runs offline on `assumed` data — concurrent writes are possible. The resolution rule falls out of machinery v0.4 already defines.

### 11.1 The Observation status lifecycle *is* the conflict rule

Precedence: **`confirmed`/`corrected` (user-ratified) beats `assumed`/sensor beats `expired_assumed`**, regardless of timestamp; between two same-status writes, last-writer-wins by `ratifiedAt`/`createdAt`. A ratified value always wins over an assumption — principled, not ad-hoc. *(→ Resolved in v0.7 (R17): the lattice is now strict `corrected > confirmed > assumed > inferred`, so a late offline `corrected` beats a server auto-confirm; auto-confirm promotes `assumed → confirmed` only server-side, only after the 72 h window, and only if no pending device correction exists for that `refId` — closing the correction-loss bug.)*

### 11.2 The server is the system of record; most writes can't conflict

v0.4 already makes the self-hosted backend the source of truth and the phone a sensor bridge. The phone queues writes offline and replays them when the tailnet is reachable; the server applies the precedence rule on reconcile. Crucially, **most writes are append-only Tier-2 events** (`SensorSample`, `SetLog`) — they *merge*, they don't conflict. The only true conflicts are two edits to the same mutable record (e.g., a meal marked *eaten* on web while the phone offline-marked it *swapped*), which status-precedence + last-writer resolves.

### 11.3 Two small additions, then stop

Give each mutable record a `version`/`updatedAt`, and give each write an **idempotency key** so a replayed offline queue can't double-apply. That's sufficient. **Do not build CRDTs** — an event-sourced Tier-2 log plus status precedence plus idempotency keys is more than enough for a single user who can't physically be in two places at once.

---

## 12. Data-model deltas

Minimal additions to the v0.2 (§7) / v0.3 (§5) / v0.4 (§10) schema. Single-user and `inputConstraints`/provenance conventions preserved.

| Entity | Key fields | Notes |
|---|---|---|
| `ApiToken` | `tokenHash, label, createdAt, lastUsedAt, revokedAt, expiresAt?` | Per-device revocable auth (§7.1). Only the hash is stored. |
| `GenerationCache` | `inputHash (unique), generator, artifactRef, model, route, createdAt` | Content-hash cache (§3.2). Lookup before any model call. |
| `LlmCall` | `generator, route:{local│claude}, model, inputHash, tokensIn, tokensOut, costEst, latencyMs, validatorPassed, createdAt` | Cost tracking + drift/eval signal + router telemetry (§3, §4). |
| `SafetyFlag` | `kind, detectedFrom, severity, message, acknowledgedAt, createdAt` | Red-flag detector output surfaced to the user (§10). |
| `BackupRun` | `path, sizeBytes, startedAt, finishedAt, ok, restoreTestedAt` | Backup + restore-test log; drives the "last good backup" indicator (§5.3). |
| `OpsConfig` | `dbPath, llmMonthlyCeiling, routerPolicy{}, localModelEndpoint, backupRetentionDays, safetyFloors{}` | The user-tunable operational settings surface (§3.3, §5, §10). |

Existing mutable records (`PantryItem`, `PlannedMeal` status, `GroceryListItem`, profile rows) gain a `version Int` for conflict detection (§11.3) rather than new tables where possible.

---

## 13. API deltas

Consistent with the v0.2 REST/JSON + bearer-auth surface.

| Area | Endpoint | Purpose |
|---|---|---|
| Auth | `GET /auth/tokens` · `POST /auth/tokens` · `DELETE /auth/tokens/{id}` | List / mint / revoke per-device tokens (§7.1). |
| System | `GET /system/status` | Degraded-mode state: `mode:{full│rules_local│rules_only}`, LLM up/down, provider up/down, `lastBackupAt`, `spendMTD` vs ceiling (§2, §5). Extends the existing `/health`. |
| Ops | `GET/PUT /ops/config` | Operational settings (§12 `OpsConfig`). |
| Backups | `GET /system/backups` | Snapshot list + last restore-test result (§5.3). |
| Safety | `GET /safety/flags` · `POST /safety/flags/{id}:acknowledge` | Read/ack red-flag detector output (§10). |

The golden-set eval (§4) is a dev-time harness, not a runtime endpoint. The LLM gateway (§3) is internal — generators call it in place of the SDK; it exposes no new public route.

---

## 14. New & extended modules

Alongside `training/`, `nutrition/`, `grocery/`, `estimation/`, `capture/`:

- **`llm/` (gateway).** The router + content-hash cache + budget logic (§3). Every generator calls `llm.generate(spec)` instead of the Anthropic SDK; the gateway decides local-vs-Claude, checks the cache, runs the validator hook, and logs the `LlmCall`. This is also where **rules-only** and **rules+local** degraded modes (§2.2) are enforced.
- **`ops/`.** Backup (`VACUUM INTO`), retention pruning, restore-test, and migration helpers (§5, §6), run on the scheduler that already drives `estimation/`.
- **`safety/`.** The red-flag detector (§10); envelope guards live *inside* each engine's rules + validator, not here.
- **`eval/`** (dev-time). The golden-set harness (§4) — run in CI or by hand, not shipped in the server.

---

## 15. New & extended Epics

Framed in the Epics-doc voice.

### Epic 13 — It Never Just Stops

**The essence:** when the API is slow, an ingredient service is down, or Michael goes heads-down for a week, Intella keeps producing a sane plan from what it last knew, and quietly catches up when things recover.

- As Michael, I want a failed plan refresh to leave my current plan in place rather than show me an error, so a bad moment for the API is never a bad moment for me.
- As Michael, I want every part of the app to still work — training, meals, groceries — even if the AI is completely unreachable, so I'm never blocked.
- As Michael, I want background failures handled silently and retried later, and in-app failures shown without stopping me, so problems get solved without becoming my problem.

### Epic 14 — Efficient by Default

**The essence:** Intella spends paid AI calls like they cost money — caching what hasn't changed, running routine work on a local model, and saving the expensive model for the decisions that deserve it.

- As Michael, I want Intella to reuse a plan when nothing that shaped it changed, so I'm not paying to regenerate the same week twice.
- As Michael, I want routine, low-stakes AI work done by a local model and only the hard, creative work sent to the paid API, so quality stays high where it matters and cost stays low everywhere else.
- As Michael, I want a spending ceiling I can set, with the app getting thriftier as it approaches the cap instead of cutting me off.

### Epic 15 — My Data Outlives My Laptop

**The essence:** years of Michael's history are irreplaceable, so Intella keeps consistent, tested backups and can always be restored — a dead drive costs him nothing but a restore.

- As Michael, I want a consistent daily snapshot of my data somewhere safe, taken without stopping the app, so a crash mid-write never corrupts my history.
- As Michael, I want the app to prove its backups actually restore, so "I have backups" is a fact, not a hope.
- As Michael, I want my health data encrypted at rest, so a copied file or a lost machine doesn't expose it.

### Epic 16 — A Coach, Not a Clinician

**The essence:** Intella coaches within safe, healthy bounds and knows where its job ends — it won't push past a safe floor, and it points Michael to a professional when something looks medical.

- As Michael, I want hard limits on how aggressive a plan can get — a calorie floor, a safe rate of change, capped load jumps — that the AI can never override.
- As Michael, when I mention real pain or something that looks medical, I want Intella to flag it and point me to a professional rather than just adjusting a number.

### Epic 17 — Useful From Day One

**The essence:** with no history yet, Intella is honest that it's estimating, plans cautiously, and visibly sharpens as Michael logs — and it does the same after a long break.

- As Michael, I want my first weeks framed as calibration, with plans that hedge and numbers labeled as estimates, so I trust the app precisely because it isn't faking precision.
- As Michael, I want the app to ask only for the few inputs that most sharpen its picture early on, so I calibrate it fast without a logging chore.
- As Michael, after a long gap I want the app to re-baseline rather than pick up where I left off, so a month off doesn't hand me last month's loads.

---

## 16. Build plan — where each addition lands

These are cross-cutting hardening items that attach to *existing* phases (v0.2 §10, v0.3 §8, v0.4 §13) rather than forming a new sequential block. Several are foundational and belong in **Phase 0** despite serving later concerns.

| Addition | Attaches to | New ticket |
|---|---|---|
| Nightly `VACUUM INTO` backup + retention + restore test | Phase 0 | **T0.7** |
| Prisma-migrate discipline + expand/contract + backup-before-migrate hook | Phase 0 | **T0.8** |
| Per-device revocable token table | Phase 0 | **T0.9** |
| `GET /system/status` degraded-mode surface (skeleton) | Phase 0 → UI in Phase 5 | **T0.10**, **T5.4** |
| LLM gateway: router + content-hash cache + rules-only mode | Phase 2 (first LLM use) | **T2.8** |
| Golden-set eval harness | Phase 2 | **T2.9** |
| Safety envelope guards (rules layer) | Phase 2 (training) + Phase 3 (nutrition) | **T2.10**, **T3.8** |
| Provider cache-first + quota backoff | Phase 3 | **T3.6** |
| Local-model routing, empirically tuned from evals | Phase 3+ | **T3.7** |
| Red-flag detector + `SafetyFlag` surface | Phase 5 | **T5.5** |
| Calibration UX (cold-start) | Phase 5 → refined in Phase 11 | **T5.6** |
| Re-baseline / dead-month flow | Phase 9 | **T9.4** |
| Apple Developer enrollment + TestFlight pipeline | Phase 6 prep | **T6.0** |
| Sync precedence merge + idempotency keys + record versioning | Phase 12–13 (iOS writes) | **T13.5** |

### Selected new tickets (AC in the v0.2 style)

**T0.7 Backup & restore.** Nightly job: enable WAL; `VACUUM INTO` a dated snapshot in the configurable backup dir; prune to retention (≈30 daily + monthly); run a read-only restore smoke test; write a `BackupRun` row.
*AC:* a snapshot appears nightly; the DB stays writable during it; a deliberately induced restore of yesterday's snapshot boots the API and passes sanity queries.

**T0.8 Migration discipline.** Adopt Prisma Migrate with committed migrations; add a pre-migrate hook that triggers a fresh snapshot; document the expand/contract rule.
*AC:* a sample additive migration runs against a restored copy of the latest snapshot; `db push` is disabled in scripts.

**T0.9 Per-device tokens.** `ApiToken` table (hashed); mint/list/revoke endpoints; auth middleware validates against it and stamps `lastUsedAt`.
*AC:* two device tokens authenticate; revoking one 401s that token while the other still works.

**T2.8 LLM gateway.** Router (local vs. Claude), content-hash cache keyed on `inputConstraints`, validator hook, `LlmCall` logging, and a forced **rules-only** path.
*AC:* an unchanged input returns a cached artifact with zero model calls; with the API disabled, every pillar still returns a valid deterministic result; a routed local call is validated identically to a Claude call.

**T2.9 Golden-set eval.** ~15–30 saved input cases per generator; harness asserting validator-pass + quality properties; run stored as a JSON artifact.
*AC:* editing a prompt and re-running reports a pass-rate delta; a contrived quality regression is caught.

**T2.10 / T3.8 Safety envelope guards.** Deterministic floors/caps in the training and nutrition rules layers (calorie floor, max rate of change, capped load jumps).
*AC:* inputs that would breach a floor are clamped/rejected before generation; unit-tested at the boundaries.

**T5.5 Red-flag detector.** `safety/` scan of parsed feedback + adherence/weight patterns; emits `SafetyFlag`; UI surfaces a defer-to-professional message.
*AC:* a "sharp knee pain" feedback string raises a flag and shows the message instead of only adjusting the plan.

**T5.6 Calibration UX.** Low-confidence framing for weeks 1–3: estimate labels, wide cones, a short "calibrate me" ask for high-VOI inputs.
*AC:* a fresh profile shows estimate/low-confidence labeling everywhere; confidence visibly increases as sample data is logged.

**T6.0 Distribution.** Enroll in the Apple Developer Program; set up a TestFlight internal-testing pipeline for personal installs.
*AC:* a build installs on the iPhone via TestFlight and updates over-the-air with no cable.

---

## 17. Open decisions (Michael's calls)

None block Phase 0; each is wanted before its phase.

- **At-rest encryption depth.** FileVault + iCloud ADP (recommended default), or add SQLCipher for DB-level encryption independent of the OS? → Resolved in v0.7 (R21): backups now use OS-agnostic app-level encryption; iCloud/FileVault are optional replication, not the mechanism.
- **Backup retention specifics.** Confirm ≈30 daily + a rolling few monthly, and the backup directory (default `~/Documents/Intella/backups`).
- **Local model choice.** Which local model/runtime (e.g., an Ollama-served Llama/Qwen/Mistral) — decided empirically from the eval set (§3.5, §4), but worth a starting pick before Phase 3.
- **Monthly LLM ceiling default.** A starting number for `OpsConfig.llmMonthlyCeiling` (the router respects whatever you set; single-digit dollars is realistic per §3.4).
- **Provisional→auto-confirm window** (carried from v0.4 §14) interacts with the sync precedence rule (§11) — confirm the auto-confirm horizon so the approvals queue and the conflict rule agree. → Resolved in v0.7 (R17): window = 72 h, with `corrected > confirmed` and a no-pending-correction precondition so the queue and merge rule agree.

---

*Companion files: `Intella_Product_and_Build_Plan.md` (v0.2 product/architecture/tickets), `Intella Adaptive Intelligence Plan.md` (v0.3 estimation/horizons/analytics), `Intella_Ambient_Capture_and_Interaction.md` (v0.4 ambient capture), `Intella_Epics_and_Stories.md` (epics), `Intella_UI_Wireframes.html`, `openapi.yaml`. This document (v0.5) hardens all of the above into a system dependable enough to run for years.*
