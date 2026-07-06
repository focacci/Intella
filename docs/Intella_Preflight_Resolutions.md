# Intella — Preflight Resolutions

**Version:** 0.7 · **Date:** July 5, 2026 · **Status:** Pre-Phase-0 decisions locked

This document resolves every gap surfaced in the pre-code design review. Each item states the **decision** (the call made), a one-line **why**, and the **concrete change** (schema field, formula, ticket, or wireframe). Where a companion doc previously listed something as "open," this document **supersedes** it; those docs now carry an inline `→ Resolved in v0.7 (Rxx)` pointer here.

The mandate is unchanged: this is planning, not app code. Only `schema.prisma`, `openapi.yaml` (core entities), the wireframes, and the prose docs are touched.

**How to use this doc:** R1–R8 are schema-blocking and must land in Phase 0's first migration. R9–R16 are engine specifications that unblock Phases 2–4. R17–R22 harden sync/ops. R23 is the UI backlog. R24 lists what only Michael can supply.

---

## Part 1 — Schema decisions (Phase-0 blocking)

These are cheap now and expensive to retrofit onto live single-user data. All land in the first migration (ticket **T0.3 / T0.11**).

### R1 — Timezone & the definition of "today"

**Decision.** Add `Profile.timezone` (IANA string, e.g. `"America/New_York"`). Store **all** timestamps in UTC. "Today" is `[local-midnight, next local-midnight)` computed from `Profile.timezone`. Capture the timezone at onboarding, defaulted from the device. Ambient captures (v0.4) additionally stamp their own `captureTz` so a log made while travelling keeps its local meaning.

**Why.** Every "today's session / today's meals," the nightly estimator scheduler, and day-boundary adherence silently assumed a boundary that didn't exist. It is a schema fact, not a Phase-1 nicety.

**Change.** `Profile.timezone String @default("UTC")`. Reclassified from "Phase 0–1 (open)" to **Phase 0 (done)**.

### R2 — Sync ordering: a single `ChangeLog`, not per-row `serverSeq`

**Decision.** Resolve the v0.6 §6 either/or in favor of **one append-only `ChangeLog` table** whose autoincrement integer PK **is** the monotonic `serverSeq`. Every mutating server write appends one `ChangeLog` row `{ serverSeq, table, rowId, op (upsert|delete), clientId, ts }`. `GET /sync/pull?since=<serverSeq>` reads forward from the log (tombstones included). Syncable rows still carry `updatedAt` / `version` / `deletedAt` / `clientId` for the merge; the log carries only ordering.

**Why.** A single autoincrement gives a clean cross-table cursor and native tombstone ordering without adding a sequence column (and its contention) to every table. It is the simplest correct mechanism in SQLite.

**Change.** New `ChangeLog` model. Sync columns added to every syncable table (R3 lists the set). Gates ticket **T0.11**; must precede any other write path.

### R3 — Polymorphic references: a `{refType, refId}` convention

**Decision.** Wherever a column must point at more than one entity type, use a **discriminated pair**: `refType String` (a closed enum) + `refId String`. No cross-table FK (SQLite/Prisma can't enforce one); integrity is an app-layer resolver plus a nightly referential checker. Same-table trees (`PlanNode.parentId`) use a **real self-relation FK**. Id arrays (`GroceryListItem.sourceMeals`) stay JSON, are documented as advisory `PlannedMeal` ids, and are rewritten on regeneration (see R19).

**`refType` enum (v1 + additive):** `session | plan | meal | grocery_item | grocery_list | body_metric | goal | plan_node | set_log | recipe`.

**Syncable tables** carrying `updatedAt/version/deletedAt/clientId`: `Profile, Goal, TrainingProfile, DietProfile, Program, WorkoutSession, SetLog, BodyMetric, MealPlan, PlannedMeal, PantryItem, GroceryList, GroceryListItem, Feedback` (plus every additive table from v0.3–v0.5 as it lands).

**Why.** `targetId`-style loose strings recurred across five docs with no resolution rule, blocking referential integrity and delete/cascade once tombstones exist. One convention defines half the future tables at once.

**Change.** `Feedback.targetId` → `refType` + `refId`. Same shape reused by `Observation`, `AdherenceEvent`, `GenerationCache`, `CapturePrompt` when they land.

### R4 — `Goal.target` becomes structured

**Decision.** Replace free-text `target` with `targetKind` (`rate | absolute | outcome`), `targetValue Float?`, `targetUnit String?` (`kg_per_week | kg | pct_bodyfat | reps | kg_1rm | none`), and keep a `note String?` for human phrasing only. Add `priority Int @default(1)` (see R14). Example: lose fat → `{ kind: "rate", value: -0.5, unit: "kg_per_week", note: "cut for summer" }`.

**Why.** `"-0.5kg/week"` as free text is unparseable, yet it is a direct input to both the training and nutrition engines and to horizon feasibility.

**Change.** Four fields on `Goal`; engines read structured, `note` is display-only.

### R5 — The adaptation-event model: `Feedback` vs `Observation`

**Decision.** Draw a clean line:

- **`Feedback`** = *user-authored intent/signal* (free text or a tap): "felt easy," "knee off," a meal rating, a manual list edit. Gets `clientId`, `refType/refId`, and `status` (`raw | parsed`). A MicroPrompt tap **creates a `Feedback` row** (it is user-authored) and may in turn update an `Observation`.
- **`Observation`** (v0.4) = *system belief about the world* with `status` (`inferred | assumed | confirmed | corrected`) and `confidence`. It wraps a domain log (`SetLog`, meal-eaten, `BodyMetric`) via `refType/refId`.
- **`AdherenceEvent`** (v0.3) = a **distinct** table (a computed daily/weekly roll-up), not an extension of `Feedback`.

**Why.** Three docs piled onto `Feedback` without deciding whether observed/machine events *are* feedback. They aren't: feedback is authored, observations are believed, adherence is computed. Conflating them corrupts the confidence and sync-precedence logic.

**Change.** `Feedback` gains `clientId`, `refType`, `refId`, `status`. `Observation`/`AdherenceEvent` remain separate tables (spec unchanged, linkage now defined).

### R6 — Units: canonical-metric storage + display preference

**Decision.** All stored numbers are **metric-canonical** (kg, cm, g, ml, kcal). Add `Profile.unitSystem` (`metric | imperial`) used for **display only**; every engine computes in metric. Document the invariant in the schema header.

**Why.** The schema was already metric but had nowhere to record Michael's display preference, and "canonical-metric" was asserted but not enforced (R4 fixes the one violation, `Goal.target`).

**Change.** `Profile.unitSystem String @default("metric")`.

### R7 — Activity level (the missing macro input)

**Decision.** Add `Profile.activityLevel` (`sedentary | light | moderate | very_active | athlete`) captured at onboarding. Phase-3 TDEE = `BMR(Mifflin–St Jeor) × activityMultiplier[activityLevel]`. Once v0.3's estimator has ≥14 intake+weight days, the **estimated** TDEE supersedes this seed (reality overrides the formula).

**Why.** Phase 3 needs an activity multiplier, but `TrainingProfile` only captured days/session length. The macro math had no legal input.

**Change.** `Profile.activityLevel String @default("moderate")`. Multiplier table lives in the nutrition engine config.

### R8 — Ingredient canonicalization (the real core of Pillar 3)

**Decision.** Make the grocery pipeline actually computable:

1. **`Ingredient`** gains `densityGPerMl Float?` (volume↔weight), `gramsPerPiece Float?` (count↔weight, e.g. "1 medium onion ≈ 110 g"), and `aisleOrder Int?` (stable in-aisle sort).
2. New **`IngredientAlias`** table `{ alias, ingredientId, source }` mapping provider/synonym strings ("yellow onion," "brown onion") → one canonical ingredient.
3. **Pipeline spec** (Phase 4): recipe raw line → LLM parse `{name, qty, unit, prep}` → match to canonical `Ingredient` via alias/lexical/embedding → normalize to a canonical base unit (g / ml / piece) using `densityGPerMl` / `gramsPerPiece` → aggregate across the week → subtract pantry (also normalized) → round to a shoppable quantity → assign aisle. Density/piece seeds come from **USDA FoodData Central portion data** plus a curated seed table; the LLM may *propose* a density but the validator requires a numeric fallback and never invents one silently.

**Why.** Consolidation and pantry-subtraction both depend on converting "1 cup chopped onion" and "2 medium onions" to a common unit. Without density/piece data and an alias table this pillar cannot work; "the LLM cleans the line" was hiding the hard 80%.

**Change.** Three fields on `Ingredient`, new `IngredientAlias` model. New ticket **T4.0** (canonicalization + alias + density seed) ahead of T4.1.

---

## Part 2 — Engine specifications (unblock Phases 2–4 & the adaptive layer)

These were specified only as prose. Now implementable.

### R9 — First-program cold start / starting strength

**Decision.** Add an optional onboarding "current strength" capture: `TrainingProfile.baselineLifts` (JSON `[{ pattern|exerciseId, estWeight, estReps }]`). If present, the rules layer seeds working loads from estimated e1RM (Epley). If absent, **week 1 is a calibration week**: conservative %-bodyweight starting loads, RPE-capped, ramping to discover real loads. Mark it via `WorkoutSession.label` = `"Calibration"` and `Program.calibrationWeeks Int @default(0)`.

**Why.** "Pre-fill from last session" had no seed for session 1 — no `SetLog`, no e1RM.

**Change.** `TrainingProfile.baselineLifts String @default("[]")`, `Program.calibrationWeeks`. Adjust ticket **T2.2**.

### R10 — The LLM generate → validate → repair loop

**Decision.** Every generator follows one contract:

1. LLM returns tool-use JSON against a **published, versioned schema** (schemas live beside each engine).
2. Deterministic validator checks hard constraints.
3. On violation: **re-prompt with the specific violations, max 2 repair attempts.**
4. Still invalid → **fall back to deterministic degraded output** (rules-only: last-known-good / seed template, R18) and persist the artifact with `degraded = true` + reason. **Never save invalid output; never hard-stop.**
5. Provider/transport errors get their own retry-with-backoff, separate from validation repair.
6. The gateway records every attempt in `LlmCall`; a per-generation token budget bounds cost.

**Why.** The entire architecture rests on "structured output + validator," but the failure path (how many retries, then what) was undefined — and it runs in all three pillars.

**Change.** Spec captured here; realized in the `llm/` gateway (v0.5 §3) and each engine's `generate()`. No schema change.

### R11 — Generation-quality evaluation

**Decision.** Add an `eval/` harness (new ticket **T5.4**): a golden set of profiles → **property assertions** on real generations (macros within tolerance, zero allergens, volume within landmarks, budget respected, no contraindicated exercises, variety floor) plus a small **rubric-scored LLM-as-judge** for "is this plan sensible." Runs in CI on a fixed seed set.

**Why.** Unit tests cover the deterministic layers; nothing tested whether the *plans are good* — which, for a coach, is the entire value.

**Change.** New ticket **T5.4**; `eval/` package.

### R12 — Provider limits, caching & the budget guarantee

**Decision.** Three moves on the Spoonacular dependency:

1. **Cache-once, then local.** All provider responses persist into `Recipe`/`Ingredient` and are reused; the provider is a fill source, not a request-time dependency. Respect Spoonacular ToS (personal single-user caching only; no redistribution).
2. **Free-tier guard.** The `NutritionProvider` tracks daily call budget; on exhaustion mid-generation it degrades gracefully (reuse cached recipes / LLM-adapt existing) rather than failing the week.
3. **Budget is a soft constraint.** `costEst` is an estimate that never reconciles against the store-agnostic list, so the validator **warns** when estimated cost > budget, it does **not reject**. (This corrects the earlier "cost ≤ budget" *hard* validator claim.)

**Why.** Spoonacular is a single point of failure (~150 calls/day free), its cost estimate is soft, and rejecting a plan on an unreliable number is worse than surfacing it.

**Change.** Adjust tickets **T3.1 / T3.3**; validator budget rule downgraded hard→soft.

### R13 — Confidence, defined as a number

**Decision.** Confidence is a `[0,1]` score per estimate:

```
conf = w_n·sat(n / n_target)  +  w_r·exp(−Δt / halfLife)  +  w_d·(1 − dispersion_norm)
```

clamped to `[0,1]`; `w_n + w_r + w_d = 1`. Per-metric `n_target`, `halfLife`, weights live in `OpsConfig`. Bands: **<0.4 low** (hedge hard, widen cone, eligible to interrupt to resolve), **0.4–0.7 medium**, **>0.7 high**. `dispersion_norm` is the estimate's rolling coefficient of variation, normalized.

**Why.** Confidence drives cone width, hedging, and the v0.4 interruption decision, but had no scale, decay, or thresholds — so nothing downstream was implementable.

**Change.** Formula + `OpsConfig` keys. Referenced by R14, R15, R17.

### R14 — Horizon tree & multi-goal conflict

**Decision.** **One shared horizon tree**, not one per goal. Root = a synthetic `Horizon` node; levels `Year → Quarter → Month → Week → Day`, materializing only the rungs the furthest goal needs. Each `Goal` attaches milestone nodes at the right rung via `PlanNode.goalId` (structural rungs have `goalId = null`). Conflicts (bulk vs cut at the same rung) resolve by **`Goal.priority`** (R4) plus a feasibility validator that **sequences** them (phase A then B) or emits a **conflict advisory node** — it never silently blocks.

**Why.** The core structure of the horizon epic left root, multi-goal merge, and conflict reconciliation undefined.

**Change.** `Goal.priority` (R4); `PlanNode` self-relation FK (R3); resolution logic in `estimation/`.

### R15 — Feasibility-validator failure UX

**Decision.** An infeasible goal/timeline **does not block generation**. The planner produces the best feasible plan under an auto-relax order (**timeline → rate → volume**) and emits an advisory `PlanNode`: *"−0.5 kg/wk by March needs +3 weeks or a steeper deficit — I chose +3 weeks; change it in Goals."* Michael can accept or override.

**Why.** "Rejects and forces a longer timeline" contradicted the "plan never blocks" tenet and left the UX undefined.

**Change.** Advisory-node pattern; no schema change beyond R14.

### R16 — VOI & interruption budget, on comparable scales

**Decision.** Both `[0,1]`:

```
VOI            = uncertaintyResolved × planImpact
                 where uncertaintyResolved = (1 − confidence) of the target estimate (R13)
                       planImpact ∈ static per-signal table  (intake/weight ≈ 1.0 … step-count ≈ 0.1)
interruptionCost = base(context) + budgetPenalty(spentToday / dailyBudget) + timeOfDayPenalty
push  ⟺  (VOI − interruptionCost) > threshold
```

All constants in `CaptureConfig`. The **context engine** (v0.4 §3) uses a transparent weighted-evidence score (not ML): each candidate state scores from CoreMotion class match + HR-vs-baseline band + time-of-day prior + optional location; pick argmax, confidence = softmax margin. **HR baseline** = trailing 7-day resting/active percentiles from HealthKit. Cold-start (no baseline yet): use CoreMotion + time-of-day priors only, marked low confidence.

**Why.** The interruption gate compared two undefined terms, and the "brain" was a word-list with no thresholds or baseline definition.

**Change.** Formulas + `CaptureConfig` keys + an evidence→state weight table in `capture/`.

### R16b — Cold-start constants, reconciled into one family

**Decision.** One coherent set in config (ends the "2–3 weeks" vs "21-day" vs "10-day" drift):

| Constant | Value | Meaning |
|---|---|---|
| Warmup window | 14 days **or** per-estimator minimums | cold-start until met |
| TDEE minimum | 14 intake+weight days | before TDEE is trusted |
| e1RM minimum | 3 sessions / lift | before load auto-progresses |
| Adherence minimum | 7 days | before adherence scored |
| Confidence-decay onset | 10 days no relevant data | decay begins (half-life 14 d) |
| Soft re-baseline | gap ≥ 14 days | widen cones, re-open calibration |
| Hard re-baseline | gap ≥ 30 days | treat as cold-start |

**Change.** Single table in `estimation/` config; the companion docs point here instead of quoting their own numbers.

---

## Part 3 — Sync, ops & deployment hardening

### R17 — The auto-confirm ↔ sync-precedence correction-loss bug

**Decision.** `Observation.status` has a **strict precedence lattice**: `corrected > confirmed > assumed > inferred`. Because `corrected` outranks `confirmed`, a late offline correction **always** wins over a value the server already auto-confirmed — closing the loss. Auto-confirm promotes `assumed → confirmed` **only on the server, only after the window, and only if no pending device correction exists** for that `refId` (checked against the outbox/ChangeLog). Equal-status ties break by last-writer. **Auto-confirm window = 72 h** (Michael-tunable in `CaptureConfig`).

**Why.** Once an `assumed` value promoted to `confirmed`, a later offline `corrected` push fell back to last-writer-wins and could silently discard a real human correction. Two docs flagged the interaction; neither resolved it.

**Change.** Precedence lattice + auto-confirm precondition written into v0.5 §11 and v0.4 §14.

### R18 — Degraded **and** cold-start (the blank-slate cell)

**Decision.** Ship a tiny built-in **seed program** and **seed meal plan** (deterministic, generic-but-safe, respecting onboarding hard constraints). On a fresh install with no cache and no LLM, Rules-only mode renders the seed, clearly labelled *"starter plan — personalizes when the coach is reachable."*

**Why.** Rules-only mode assumed a warm cache ("repeat last week / cached recipes"); a first install with the LLM down had nothing to repeat.

**Change.** Seed templates added to Phases 0/2/3; referenced from v0.5 §2.2 and §9.

### R19 — Server regeneration must not orphan offline check-offs

**Decision.** Regeneration is **non-destructive to in-flight local state**. Check-off events reference `{ listId, ingredientId }`, not just a row id. When the server regenerates a list it (a) archives the old list rather than deleting it and (b) carries `checked` state forward by **canonical-ingredient match**. On `pull`, a check-off whose `listId` is archived is re-applied by `ingredientId` to the active list.

**Why.** The precedence rule governed same-row edits; it said nothing about a check-off orphaned when the server replaced the whole list with a new id.

**Change.** Rule added to v0.6 §11 / sync protocol; `GroceryList.status` already supports `archived`.

### R20 — The on-device line: loggable offline, generated server-side

**Decision.** Rewrite the offline contract precisely. The device can: read last-synced plans; log sets; check off grocery; mark meals; weigh in; answer MicroPrompts — all append-only and provisional. The device **cannot** generate or regenerate anything. On-device set pre-fill uses the **last server-computed targets already on the session card**, not on-device computation. No deterministic *generation* runs on device; only display of server-precomputed values plus local capture.

**Why.** "Training + grocery fully usable offline" overstated it and contradicted the residency map (the brain is server-side). The line "what deterministic work may run on-device" was undrawn.

**Change.** v0.6 §3 wording corrected from "fully usable" to "fully **loggable**; generation is server-side."

### R21 — Cross-platform, OS-agnostic backups

**Decision.** Durability no longer leans on iCloud. Nightly `VACUUM INTO` snapshot → **app-level symmetric encryption** of the snapshot (key in the OS keystore: Keychain / DPAPI / libsecret) → written to a configurable dir. iCloud / Time Machine / an offsite copy become optional **replication targets**, not the encryption mechanism. First-run `setup` **warns** if the backup dir has no encryption/offsite coverage. Restore + re-pair remains the disaster-recovery path.

**Why.** The prior story (iCloud ADP + `~/Documents`) is macOS-only, but Docker deployment treats Windows/WSL2/Linux as first-class; the guarantee silently evaporated off-Mac.

**Change.** v0.5 §5 rewritten OS-agnostic; ticket **T0.7** updated.

### R22 — `/pair` is not unauthenticated

**Decision.** `GET /pair` requires a **time-boxed pairing window** opened from the server console (first-run `setup` prints a short-lived **pairing PIN**; the QR carries base URL + PIN, and the minted per-device token is only issued when the PIN + open window match). Outside a pairing window, `/pair` returns 403. So a tailnet peer cannot silently pull a device token.

**Why.** Framing Tailscale as the whole boundary meant any tailnet peer could `GET /pair` and mint a token. Fine to *assume* a trusted tailnet, but the token endpoint shouldn't be a silent open door.

**Change.** Pairing window + PIN added to v0.6 §7–8; ticket **T0.12**.

### R20b — Content-hash cache canonicalization

**Decision.** Before hashing `inputConstraints`, serialize **canonically**: sorted keys, floats rounded to 4 dp, and an **explicit inclusion list** — the hash covers the full constraint object **plus** the id + `updatedAt` of every referenced `PreferenceWeight / DietProfile / TrainingProfile / Goal`. Store `constraintsHash` + `hashVersion` on the artifact.

**Why.** Hashing a raw JSON string invited silent cache misses (key order / float format) and, worse, stale-plan reuse if an input that influenced generation wasn't serialized.

**Change.** Canonical-serialization rule in the `llm/` gateway (v0.5 §3.2); `constraintsHash`/`hashVersion` on `GenerationCache`.

---

## Part 4 — UI / wireframe additions (R23)

The native set showed one data-rich happy-path user. The following are added to `Intella_Native_Wireframes.html` (and, where a full frame isn't drawn, specified here so nothing is lost). All reuse the existing teal (`#0f766e`) system.

**Reusable states (apply to every pillar surface):**
- **Empty** — no plan yet / not generated / nothing to confirm / **"not enough data to estimate yet"** (the actual first-weeks state of Insights).
- **Loading / generating** — skeletons for every LLM-backed action (program gen, meal gen, swap, TDEE re-fit) — these are network calls over Tailscale that can be slow.
- **Error / offline** — offline banner, "can't reach server," failed-sync + retry, and a **conflict-resolution** surface for the merge rule (R17/R19).
- **Degraded** — an ambient "generated without Claude (rules-only)" indicator on Today/Meals, not just the System-status readout.

**Missing screens/flows now added:**
- **Onboarding steps 1–5** — Physiology, Goals (structured target, R4; priority, R14), Training (exists; + baseline lifts, R9), Nutrition (+ activity level, R7), Review → **"generating your first plan"** hand-off into a populated Today.
- **Exercise-swap picker** (constraint-filtered alternatives + why) and **"Something hurt" destination** wired to the adjust/safety flow.
- **Meal-swap options** (macro/cost-preserving alternatives, not just the pre-swap recipe).
- **Pantry editor** (add/remove/quantity) — the headline feature had no screen.
- **Settings edit forms** for every "Edit" pill (all were dead-ends) + masked API-key entry.
- **Export/print preview**, **device pairing/QR** (with the R22 pairing-window/PIN), **restore / disaster-recovery re-pair**.
- **Permission priming** screens (HealthKit, notifications, Motion & Fitness, location) ahead of the iOS system prompts.
- **"Why?" drill-down** behind the repeated `Why ›` links (targets → choices → limits → what feedback changed).

**iOS platform primitives now represented:**
- **Live Activity** (rest timer + active set in the Dynamic Island) — the notch was drawn but never used.
- **Home/lock-screen widgets** (next workout, pending confirmations, next meal) and a **Watch complication**.

**Navigation fixes:**
- iPhone gains a **System/Settings entry** (gear) so Approvals, Capture settings, System status, Devices & sync, Safety, and Settings are reachable (they had no route).
- Define the **Insights secondary nav** (Position / Trajectory / Horizon) and align the segmented-control labels with the three screens.

**New/changed ticket:** **T5.3** (prototype hardening) explicitly owns empty/loading/error/offline/degraded states; onboarding-completeness folds into **T1.2**.

---

## Part 5 — Reclassification (what moved into Phase 0)

Three items previously filed as "open / later" are actually schema-blocking and are now **Phase 0**:

- **Timezone** (R1) — was "Phase 0–1 (open)."
- **Sync cursor mechanism** (R2) — was "either/or (open)"; now decided and gates the first write.
- **The auto-confirm ↔ precedence rule** (R17) — was "confirm later"; it's a correctness rule, resolved now so the conflict logic ships correct the first time.

Still legitimately deferrable to their own phase (but now **specified**, not vague): confidence/VOI/context formulas (R13/R16), horizon semantics (R14), cache canonicalization (R20b), `/pair` auth (R22).

---

## Part 6 — Ticket delta (hand-off ready)

| Ticket | Change |
|---|---|
| **T0.3 / T0.11** | Schema migration now includes R1–R8 fields + `ChangeLog` + `IngredientAlias`. |
| **T0.7** | Backups rewritten OS-agnostic (R21). |
| **T0.12** | First-run `setup` adds pairing window + PIN (R22). |
| **T1.2** | Onboarding covers all 5 steps incl. activity level, structured goal, baseline lifts. |
| **T2.2** | Rules layer seeds loads from `baselineLifts` or runs a calibration week (R9). |
| **T3.1 / T3.3** | Provider caching + free-tier guard; budget validator hard→soft (R12). |
| **T4.0** *(new)* | Ingredient canonicalization + `IngredientAlias` + density/piece seed (R8). |
| **T5.3** | Owns empty/loading/error/offline/degraded states (R23). |
| **T5.4** *(new)* | Generation-quality eval harness (R11). |
| all generators | Adopt the generate→validate→repair loop with `degraded` fallback (R10). |

---

## Part 7 — Files changed in this pass

- **`schema.prisma`** — R1–R9 fields, `ChangeLog`, `IngredientAlias`, sync columns, `Feedback` event model.
- **`openapi.yaml`** — `Profile` / `Goal` / `DietProfile` schemas updated; `/sync/push`, `/sync/pull`, `/pair` documented as stubs.
- **Companion docs** (v0.3–v0.6), **build plan**, **epics**, **README** — inline `→ Resolved in v0.7 (Rxx)` pointers at each former open item; reclassifications applied.
- **`Intella_Native_Wireframes.html`** — states + screens from R23.

---

## Part 8 — What still needs Michael (data, not design)

These aren't design gaps — they're inputs only he can give, captured at onboarding or as a config value:

- Real profile numbers: age, height, weight, body-fat, **activity level** (R7), **baseline lifts** (R9).
- Structured **goal(s)** + priority (R4/R14).
- Diet: pattern, allergies (hard), dislikes, cuisines, cooking skill, meals/snacks, **weekly budget** (now a soft guide, R12).
- The **monthly LLM dollar ceiling** (mechanism specified in v0.5 §3; only the number is his).
- Grocery grouping preference (aisle default), Spoonacular-vs-curated recipe set, repeat/variety tolerance.

---

*v0.7 locks the pre-code decisions. With R1–R8 in the first migration, Phase 0 can be handed to the coding agent without retrofitting anything onto live data.*
