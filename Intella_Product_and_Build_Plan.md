# Intella — Product & Build Plan

*Intelligent personal trainer + nutritionist and meal planner. Single-user, self-hosted.*

**Version:** 0.2 (planning) · **Date:** June 25, 2026 · **Status:** Web prototype scope locked

**Decisions locked:** Hybrid intelligence (deterministic rules + Claude API) · TypeScript backend & web, native SwiftUI iOS · Web prototype covers all three pillars · API self-hosted on desktop.

**v0.2 change:** Pillar 3 is now a **consolidated grocery list** (store-agnostic). Cross-store price optimization and store-specific pricing are **deferred to post-v1** — no clean public price APIs exist for most chains, and manual price entry isn't worth the friction. You'll shop the list yourself and chase sales your own way.

---

## 1. Vision

Intella is a private, single-user coach that does three jobs well: it programs your training, plans your meals, and turns that plan into one clean, consolidated grocery list. It is *adaptive* — it learns from what you actually did (the workout you logged, the meal you swapped, what's in your pantry) and adjusts the next plan rather than handing you a static template.

**Guiding principles**

- **Personal first.** Every output is derived from *your* physiology, goals, history, and constraints — never a generic plan.
- **Adaptive, not static.** Feedback (logs, swaps, "felt easy/hard") feeds the next cycle.
- **Affordable & doable.** Meals respect a budget (via recipe cost estimates), an effort ceiling, and your real cooking skill. Plans you won't follow are failures.
- **Private by default.** One user, self-hosted, your data on your machine.
- **Explainable.** The app can always answer "why this exercise / why this meal / why this much."

**Non-goals for v1:** multi-user/social, wearable auto-sync, calorie photo recognition, in-app grocery checkout, **cross-store price optimization and store-specific pricing** (all post-prototype candidates — see §12).

---

## 2. The user

You are the only user. The app is self-hosted on your desktop and reached privately from your iPhone. Because it's single-user, auth stays minimal and the data model can assume one profile.

**Inputs Intella collects at onboarding** (and lets you edit anytime):

- **Physiology:** age, sex, height, weight, optional body-fat %, body measurements.
- **Training:** experience level, goal (e.g., build muscle / lose fat / get stronger / general health), days/week available, session length, equipment access (home/gym/bands), injuries or movement restrictions.
- **Nutrition:** dietary pattern and restrictions, allergies (hard excludes), dislikes, cuisines you like, cooking skill/effort ceiling, meals per day, weekly food budget.

**North-star outcomes:** you train consistently and progress; you eat to your goals without decision fatigue; you walk into the store with a complete, no-duplicates list.

---

## 3. Product pillars & features

Three pillars plus a unifying **Today** view and an **adaptation loop** that ties them together.

### Pillar 1 — Adaptive Training

*Outcome: open the app, see exactly what to do today, log it in seconds, and trust that next week is calibrated to this week.*

Features: generate a multi-week program from your profile and goal; daily session view with target sets/reps/load and RPE; fast set logging; automatic progressive overload and deloads; exercise substitution (equipment, boredom, niggles); progress charts (volume, estimated 1RM, bodyweight); plain-language coaching notes.

User stories:

- *As Michael, I want a program matched to my goal and 4 training days so I don't have to design one.*
- *As Michael, I want today's lifts pre-filled with target weights based on last session so I just confirm and go.*
- *As Michael, when I report a set felt easy or a joint felt off, I want next session adjusted.*

### Pillar 2 — Meal Planning

*Outcome: a weekly plan that hits your macros and budget, that you'll actually cook and enjoy.*

Features: compute calorie/macro targets from profile and goal; generate a weekly plan (meals/day, servings) within budget, effort, and dietary constraints; recipe detail with steps and per-serving macros; one-tap meal swap with constraint-aware alternatives; leftover/batch-cook awareness; running weekly cost (estimated) and macro adherence.

User stories:

- *As Michael, I want a week of meals that average my macro targets and stay under budget.*
- *As Michael, I want to swap a dinner I don't feel like for one that keeps the day's macros and cost roughly intact.*
- *As Michael, I want meals that fit my skill and time, not 90-minute recipes on a weeknight.*

### Pillar 3 — Smart Grocery List

*Outcome: the meal plan becomes one consolidated, de-duplicated, pantry-aware list, organized by category so it's fast to shop — and you decide where to buy and which sales to chase.*

Features: aggregate every recipe ingredient for the week into consolidated quantities; subtract what's already in your pantry; normalize units and round to sensible real-world quantities; group items by category/aisle (produce, meat & seafood, dairy, pantry, frozen); check items off as you shop; print or export the list. Store-agnostic — no prices or store accounts required.

User stories:

- *As Michael, I want my week's meals turned into one grocery list with nothing double-counted.*
- *As Michael, I don't want the list to include what I already have in the pantry.*
- *As Michael, I want it grouped by aisle so shopping is quick, and I'll hunt for sales myself.*

### Cross-cutting — Today dashboard & adaptation loop

**Today** shows the day's workout, the day's meals, and a grocery-list nudge in one screen. The **adaptation loop** is the product's spine: every log, swap, and pantry update is feedback that re-parameterizes the next generation — training load from performance, meal selection from swaps/ratings, list quantities from pantry stock.

---

## 4. How the intelligence works (hybrid)

Every generator follows the same three-layer pattern, which keeps cost low, output safe, and behavior explainable:

1. **Rules layer (deterministic):** compute the hard constraints and numeric targets from your data. Cheap, reproducible, testable.
2. **LLM layer (Claude API):** make the human choices *within* those constraints — variety, substitutions, phrasing, interpreting free-text feedback. Always returns structured JSON.
3. **Validator (deterministic):** reject/repair any LLM output that violates a constraint before it's saved.

| Pillar | Rules layer computes | LLM layer decides | Validator enforces |
|---|---|---|---|
| Training | Split from days/goal; weekly set volume targets; progression (add reps→load, deload on stall); est-1RM (Epley); equipment/injury filter | Exercise selection & variety from the allowed menu; substitutions; coaching notes; parsing "knee felt off" | Volume within landmarks; no contraindicated/unavailable exercises |
| Meals | BMR (Mifflin–St Jeor) × activity, adjusted for goal; macro & per-meal targets; budget, effort & time caps; allergy hard-excludes | Recipe choice/variety to taste; recipe adaptation; batch-cook & leftover ideas | Macros within tolerance; zero allergens; weekly cost ≤ budget |
| Grocery list | Ingredient aggregation across the week; unit normalization; pantry subtraction; round to sensible quantities | Clean each line into a shoppable item ("1 cup chopped onion" → "onions, ~1 medium"); group items by aisle/category; sensible substitution notes | Every ingredient covered; quantities sane; nothing left uncategorized |

**Why hybrid:** pure rules can't be "delicious" or interpret messy feedback; pure LLM is non-deterministic, can hallucinate an allergen or an impossible load, and costs a token call for math it shouldn't be doing. The split gives you LLM flexibility with deterministic guarantees on the things that matter (safety, macros, completeness).

**Guardrails:** allergies and injuries are *hard* rules the LLM cannot override; all LLM calls use structured output (JSON schema / tool use); every generation is stored with the inputs that produced it so results are reproducible and debuggable.

---

## 5. Data & integrations

**LLM:** Anthropic Claude API for all LLM-layer work (structured outputs via tool use).

**Recipe & nutrition data** — recommendation: start with **Spoonacular** as the single integration. It uniquely covers recipes, per-ingredient nutrition, ingredient→product mapping, *and* a meal-plan endpoint in one API, with a free tier suitable for prototyping. Supplement with **USDA FoodData Central** (free, government, authoritative composition data) for any ingredient Spoonacular is thin on. **Edamam** is the fallback if you later want best-in-class nutrition analysis of free-text recipes. Abstract this behind a `NutritionProvider` interface so the source can change without touching the engine.

**Grocery list (v1) is store-agnostic.** It needs *no* price or store data. The week's recipe ingredients are aggregated, de-duplicated, unit-normalized, pantry-subtracted, and grouped by category. Recipe-level cost *estimates* (from Spoonacular) still drive the meal-plan budget check in Pillar 2, but they are estimates — not live store prices — and never gate the grocery list.

**Deferred to post-v1 (price optimization).** When/if you want it, the design adds a `PriceProvider` interface with two implementations — `KrogerPriceProvider` (Kroger's Products API returns real per-store prices where you shop a Kroger-family store) and a user-maintained `ManualPriceBook` — both feeding a store-assignment optimizer. This bolts onto the existing grocery list without reworking it. See §10 "Later."

---

## 6. Information architecture (web screens)

| Screen | Purpose |
|---|---|
| **Onboarding** | Multi-step capture of physiology, goals, training, diet, budget. One-time, editable later. |
| **Today (Dashboard)** | Day's workout + day's meals + grocery-list nudge; quick log/swap actions. |
| **Workout** | Current program overview; today's session with logging; progress charts; exercise swap. |
| **Meal Plan** | Weekly grid (days × slots); recipe detail; swap; running macro/cost totals. |
| **Grocery List** | Consolidated list grouped by category; check-off; pantry editor; print/export. |
| **Settings** | Profile/diet/training edit; budget & meal preferences; API keys. |

---

## 7. Data model

Core entities (single-user, so no tenancy on most tables):

| Entity | Key fields | Notes |
|---|---|---|
| `Profile` | age, sex, height, weight, bodyFat? | One row. |
| `Goal` | type, target, startDate, status | e.g., "lose fat", rate target. |
| `TrainingProfile` | experience, daysPerWeek, sessionMins, equipment[], injuries[] | Drives program gen. |
| `Exercise` | name, primaryMuscles[], equipment, pattern, difficulty, mediaUrl | Seeded library. |
| `Program` | goal, split, weeks, progressionScheme, status | A mesocycle. |
| `WorkoutSession` | date, status, plannedItems[] | One training day. |
| `SetLog` | sessionId, exerciseId, setNo, reps, weight, rpe | Actuals. |
| `BodyMetric` | date, weight, bodyFat?, measurements{} | Progress tracking. |
| `DietProfile` | pattern, restrictions[], allergies[], dislikes[], kcal, macros{}, budgetWeekly, effortMax, mealsPerDay | Hard allergy excludes. |
| `Recipe` | name, ingredients[], steps[], macrosPerServing{}, costEst, timeMins, tags[], sourceId | From provider or LLM-adapted. |
| `Ingredient` | canonicalName, defaultUnit, category, nutritionRef, providerId | `category` drives aisle grouping. |
| `MealPlan` | weekStart, status | One per week. |
| `PlannedMeal` | planId, day, slot, recipeId, servings | A slot in the grid. |
| `PantryItem` | ingredientId, qty, unit | Subtracted from lists. |
| `GroceryList` | planId, status, createdAt | One per week. |
| `GroceryListItem` | listId, ingredientId, qty, unit, category, checked | Consolidated, pantry-aware. |
| `Feedback` | domain, targetId, structured{}, freeText, createdAt | Fuels adaptation. |

*Deferred to post-v1 (price optimization):* `Store` and `PriceEntry` entities, plus `storeId`/`price` on grocery items and an `objective` on the list. Omitted from v1 to keep the grocery list store-agnostic.

---

## 8. API design

A single **OpenAPI spec is the source of truth.** The TypeScript web client *and* the Swift iOS client are generated from it, so the two front-ends never drift from the backend. Define the spec first; generate clients in CI.

Key endpoints (REST/JSON):

| Area | Endpoint | Purpose |
|---|---|---|
| Profile | `GET/PUT /profile`, `GET/PUT /diet-profile`, `GET/PUT /training-profile`, `GET/PUT /goals` | Onboarding & edits. |
| Training | `POST /training/program:generate` | Hybrid program generation. |
| | `GET /training/program/current` · `GET /training/session/today` | Read current plan. |
| | `POST /training/session/{id}/log` · `POST /training/session/{id}/feedback` | Log actuals & feedback. |
| | `GET /training/progress` · `GET /exercises` | Charts & library. |
| Meals | `POST /meals/plan:generate` · `GET /meals/plan/current` | Generate/read week. |
| | `PUT /meals/plan/{id}/meal/{slot}` · `GET /recipes/{id}` · `POST /meals/plan/{id}/feedback` | Swap, detail, feedback. |
| Grocery | `POST /grocery/list:generate` · `GET /grocery/list/current` | Build/read list from current meal plan. |
| | `PUT /grocery/list/item/{id}` | Check off / edit quantity. |
| | `GET/POST/PUT /pantry` | Manage pantry stock. |
| System | `GET /today` · `GET /health` | Dashboard aggregate; healthcheck. |

---

## 9. Tech architecture

**Backend (TypeScript):** Node + **Fastify** (typed, fast, light for a single-user service) · **Prisma** ORM · **SQLite** database (zero-config, file-based — ideal for desktop single-user; migrate to Postgres only if you ever go multi-user) · **Zod** for request/response validation · the Anthropic SDK for LLM calls.

**Web (TypeScript):** **React + Vite** · **Tailwind CSS** + **shadcn/ui** components · **TanStack Query** for server state · **TanStack Router** (or React Router). API client generated from OpenAPI.

**iOS:** **SwiftUI**, separate codebase, consuming the same API via a Swift client generated from the OpenAPI spec. Built after the web prototype is validated.

**Contract:** `openapi.yaml` at repo root → generates `@intella/api-client` (TS) and the Swift client.

**Repo (pnpm monorepo):**

```
intella/
  openapi.yaml          # single source of truth
  apps/api/             # Fastify + Prisma + SQLite + engines
  apps/web/             # React + Vite
  packages/shared/      # generated TS types/client, shared logic
  ios/                  # SwiftUI app (added later)
```

**Engines live in the API** as pure, unit-testable modules: `training/`, `nutrition/`, `grocery/`, each exposing `computeConstraints()` (rules), `generate()` (calls LLM), and `validate()`. The grocery engine does aggregation + categorization only in v1; a future `pricing/` module (with the `PriceProvider` interface and optimizer) slots in alongside it without touching the list logic.

**Hosting (desktop):** run the API on `localhost`; expose it privately to your iPhone with **Tailscale** (MagicDNS, no public exposure) — preferable to a public tunnel for a personal app. Keep it running with `pm2` or a login item. Back up the SQLite file to iCloud/Time Machine.

**Auth:** single static bearer token in an env var, sent by web and iOS. Sufficient because the service is private over Tailscale. Leave a seam for real auth if it ever goes multi-user.

---

## 10. Build plan (phased)

The web prototype is Phases 0–5. iOS and "later" follow.

- **Phase 0 — Foundations:** monorepo, Fastify skeleton, Prisma + SQLite schema, OpenAPI scaffold, bearer auth, Tailscale access, healthcheck, web app shell + nav.
- **Phase 1 — Profile & onboarding:** profile/diet/training/goal models, onboarding flow, settings edit.
- **Phase 2 — Training engine:** rules + LLM + validator, program generation, today's session, set logging, progress charts.
- **Phase 3 — Nutrition engine:** macro math, Spoonacular integration, weekly plan generation, recipe detail, swap.
- **Phase 4 — Grocery list:** ingredient aggregation, pantry subtraction, category grouping, list UI with check-off and print/export.
- **Phase 5 — Integration & adaptation:** Today dashboard, feedback loop wired into all three generators, polish.
- **Phase 6 — iOS:** SwiftUI app on the generated client (post-prototype).
- **Later:** **price optimization across your stores** (`PriceProvider` + Kroger API + manual price book + store-assignment optimizer), send-to-cart (Instacart), wearable sync, photo logging, multi-user.

---

## 11. Coding-agent task tickets (web prototype)

Discrete, hand-off-ready tickets. Each has acceptance criteria (AC). Build in order; tickets within a phase can parallelize where noted.

### Phase 0 — Foundations

**T0.1 Monorepo & tooling.** pnpm workspace with `apps/api`, `apps/web`, `packages/shared`. TypeScript strict, ESLint/Prettier, root scripts.
*AC:* `pnpm install` + `pnpm dev` starts api and web; shared package imports resolve.

**T0.2 API skeleton + healthcheck.** Fastify server, env config, bearer-auth middleware, `GET /health`.
*AC:* authed `GET /health` → 200; unauthed → 401.

**T0.3 Database & schema.** Prisma + SQLite; migrate all §7 entities; seed script.
*AC:* `prisma migrate` creates DB; seed inserts a sample profile and exercise library.

**T0.4 OpenAPI scaffold + client gen.** `openapi.yaml` with health + profile; generate TS client into `packages/shared`.
*AC:* generated client calls `/health` from web successfully.

**T0.5 Web shell.** React+Vite+Tailwind+shadcn; app layout with nav to all six screens (stubs); TanStack Query provider.
*AC:* nav renders; each route loads its stub; query client wired.

**T0.6 Remote access.** Document/configure Tailscale; API reachable from iPhone Safari over MagicDNS.
*AC:* phone on Tailnet loads `/health` from the desktop API.

### Phase 1 — Profile & onboarding

**T1.1 Profile/diet/training/goal endpoints.** CRUD per §8 with Zod validation; reflect in OpenAPI.
*AC:* round-trip create/read/update for each; invalid payloads → 422.

**T1.2 Onboarding flow (web).** Multi-step form capturing all §2 inputs; persists via T1.1.
*AC:* completing onboarding writes all records; resuming shows saved values.

**T1.3 Settings edit (web).** Edit any onboarding field later; allergies/injuries clearly flagged as hard constraints.
*AC:* edits persist and are read back by generators.

### Phase 2 — Training engine

**T2.1 Exercise library.** Seed a starter library (compound + accessory, tagged by muscle/equipment/pattern); `GET /exercises` with filters.
*AC:* filterable by equipment and muscle.

**T2.2 Rules layer.** `computeTrainingConstraints(profile,goal)` → split, weekly set targets, progression scheme, est-1RM, equipment/injury filter. Pure + unit-tested.
*AC:* unit tests cover ≥3 goal/day combinations and an injury exclusion.

**T2.3 LLM layer.** `generateProgram(constraints)` → Claude structured output selecting exercises within the allowed menu + coaching notes.
*AC:* output validates against schema; only allowed exercises appear.

**T2.4 Validator + persistence.** Enforce volume landmarks & exclusions; repair/reject; persist `Program` + `WorkoutSession`s. Wire `POST /training/program:generate`.
*AC:* a contrived bad LLM output is caught; valid program saved and retrievable.

**T2.5 Session view + logging (web).** `GET /training/session/today`; log sets (reps/weight/RPE); `POST .../log`.
*AC:* logging persists; revisiting shows logged sets.

**T2.6 Progression + feedback.** Next session pre-fills targets from last performance; `POST .../feedback` (e.g., "felt easy", "knee off") influences next generation.
*AC:* a logged easy session raises next target; an injury note removes the offending pattern.

**T2.7 Progress charts (web).** Volume, est-1RM, bodyweight over time.
*AC:* charts render from logged data.

### Phase 3 — Nutrition engine

**T3.1 NutritionProvider abstraction + Spoonacular impl.** Recipe search, nutrition, ingredient mapping behind an interface; cache responses.
*AC:* fetch a recipe with per-serving macros; provider swappable via config.

**T3.2 Macro rules layer.** `computeNutritionTargets(profile,goal)` → kcal (Mifflin–St Jeor×activity, goal-adjusted), macros, per-meal split, budget/effort/time caps.
*AC:* unit tests for cut/maintain/bulk; allergies become hard excludes.

**T3.3 Plan generation (LLM + validator).** `generateMealPlan(constraints)` selects/varies recipes to hit weekly macro averages within budget/effort; validator enforces macros tolerance, zero allergens, cost ≤ budget. Wire `POST /meals/plan:generate`.
*AC:* generated week averages within tolerance; no allergen ever present; cost ≤ budget.

**T3.4 Meal plan UI (web).** Weekly grid; recipe detail (steps + macros); running macro/cost totals.
*AC:* grid reflects plan; totals update.

**T3.5 Swap.** `PUT .../meal/{slot}` returns constraint-aware alternatives keeping day macros/cost roughly intact; feedback recorded.
*AC:* swap preserves constraints; choice influences future selection.

### Phase 4 — Grocery list

**T4.1 Aggregation + pantry.** Consolidate the week's recipe ingredients, normalize units, subtract `PantryItem`s, round to sensible quantities. Pure + unit-tested.
*AC:* duplicate ingredients merge; pantry stock reduces quantities; units normalized.

**T4.2 Categorization (LLM + validator).** Clean each ingredient into a shoppable line and assign an aisle/category; validator ensures every ingredient is covered and categorized.
*AC:* messy ingredient strings become tidy lines; each item has a category; nothing dropped.

**T4.3 Grocery list UI.** `POST /grocery/list:generate` from the current plan; list grouped by category; check items off; pantry editor; print/export.
*AC:* generate from current plan; items grouped by aisle; check-offs persist; list prints/exports cleanly.

### Phase 5 — Integration & adaptation

**T5.1 Today dashboard.** `GET /today` aggregate; web view of day's workout + meals + grocery-list nudge with quick actions.
*AC:* one screen shows all three with working quick links.

**T5.2 Adaptation loop.** Ensure training/meal/pantry feedback measurably re-parameterizes the next generation; document the signals.
*AC:* documented before/after for each pillar showing feedback changed the next output.

**T5.3 Prototype hardening.** Error/empty/loading states, basic e2e happy-path test, README run/host instructions.
*AC:* cold start → onboarding → all three pillars works end-to-end from the iPhone over Tailscale.

---

## 12. Open decisions

These need *your* input before or during the build; they don't block starting Phase 0.

- **Your actual profile data** — physiology, goal, training days, dietary needs, budget. (Onboarding captures these; the engines need real numbers to produce real plans.)
- **Grocery list grouping** — by aisle/category (default), by recipe, or a flat list?
- **Spoonacular vs. build-your-own recipe set** — start with the API (fastest) or curate a small personal recipe library?
- **Budget for LLM/API usage** — sets how aggressively to cache and how often to regenerate.
- **Meal structure** — meals/snacks per day, batch-cooking preference, repeat tolerance (how much variety you actually want).

**Explicitly deferred to post-v1:** cross-store price optimization, store specification & per-store pricing (Kroger API + manual price book), send-to-cart, wearable sync, photo logging. Revisit once the core three pillars are validated.

---

## 13. Suggested next steps

1. Answer the §12 open decisions (I can turn these into a short intake form).
2. Approve this plan and the UI wireframes (separate file).
3. Hand **Phase 0 tickets** to the coding agent to scaffold the repo, schema, and OpenAPI contract.
4. Fill onboarding with your real data, then generate the first program and meal plan to pressure-test the engines.

---

*Companion file: `Intella_UI_Wireframes.html` — visual wireframes of the six key web screens.*
