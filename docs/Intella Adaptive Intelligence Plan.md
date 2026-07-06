# Intella — Adaptive Intelligence & Horizon Planning

*How Intella maintains a living model of the user, plans across nested time horizons, learns from real behavior, and shows the user their position and trajectory.*

**Version:** 0.3 (planning) · **Date:** July 4, 2026 · **Status:** Feature design — extends v0.2 scope
**Companion to:** `Intella_Product_and_Build_Plan.md`, `Intella_Epics_and_Stories.md`, `Intella_UI_Wireframes.html`, `openapi.yaml`

---

## 0. What this document adds

v0.2 defined *what* Intella produces (a program, a meal plan, a grocery list) and the `rules → LLM → validator` pattern that produces each. It treated the user profile as mostly static and planning as mostly single-horizon (this week).

v0.3 adds the machinery that makes Intella genuinely *adaptive over time*:

1. **A living profile** — the user's state is continuously re-estimated from what they actually do, not frozen at onboarding.
2. **Horizon planning** — a single goal tree spanning from today out to whatever horizon the user's own goals demand, where long horizons set direction and short horizons touch reality.
3. **Habit learning** — three feedback loops running at different clocks that correct the plan and the *method* behind it.
4. **Position & trajectory analytics** — surfaces that answer "where am I," "where am I going," and "why did the plan change."

Everything here reuses v0.2's conventions: the three-layer generator pattern, `inputConstraints` stored on every artifact, and the `Feedback` table as the adaptation spine. Nothing here breaks the store-agnostic grocery list or the single-user, self-hosted posture.

**Design tenet carried in:** *reality overrides the formula.* Onboarding formulas (Mifflin–St Jeor, Epley) are only priors. Once real data exists, estimates derived from behavior take precedence.

---

## 1. The living profile — a state-estimation problem

Today the profile is a set of rows written once. To make it living, we model the user as a **continuously re-estimated state** in three tiers of belief.

### 1.1 The three tiers

**Tier 1 — Declared facts.** What the user states directly: goal, injuries, allergies, budget, dietary pattern. High trust, changes rarely. This is essentially today's profile, unchanged.

**Tier 2 — Observed measurements.** Raw, timestamped, append-only events: logged sets, bodyweight entries, meals eaten vs. planned, sessions completed/skipped/partial, pantry deltas. Never overwritten. This is the source of truth from which everything derived is computed. (Most of these tables already exist — `SetLog`, `BodyMetric`, `PlannedMeal` + a swap/skip record — they just need to be treated as an event history, not a current-value store.)

**Tier 3 — Estimated parameters.** The numbers plans actually depend on, *none of which the user can state accurately*: true maintenance calories (TDEE), estimated 1RM per lift, real weekly recovery capacity, adherence rate, actual rate of fat loss / muscle gain, the protein target that actually gets hit. **These are inferred from Tier 2 on a schedule, never entered by hand.**

The load-bearing rule: **generators never read a Tier 3 value from a form field. They read the current estimate.** If the user logs three weeks of eating ~2,150 kcal while holding 178 lb, the estimator concludes maintenance ≈ 2,150 regardless of what the onboarding formula predicted. The plan silently corrects itself.

### 1.2 The two estimators that matter most

**TDEE from energy balance.** Rather than trust a formula forever, fit maintenance from the relationship between logged intake and bodyweight trend:

```
TDEE ≈ mean_daily_intake − (Δ trend_weight_kg × 7700 / days_in_window)
```

(7700 kcal ≈ energy in 1 kg of body mass.) Computed over a **rolling 21-day window** against the *trend* weight, not raw daily weigh-ins — raw daily weight is dominated by water, glycogen, and gut content and would make the estimate thrash. *(→ Resolved in v0.7 (R16b): the single reconciled cold-start/window table now governs these numbers; quote it, not this figure.)*

**Strength / estimated 1RM per lift.** Epley (`1RM ≈ weight × (1 + reps/30)`) on the best recent working set, then smoothed. For planning, the estimate's *slope over time* matters more than its instantaneous value — the slope is what projects whether a strength goal is reachable by its target date (§2).

### 1.3 Recommended windows and smoothing (deferring to standard practice)

You asked me to defer to what's standard. These are the conventional choices in evidence-based coaching tools; all are stored as config so they can be tuned later without code changes.

| Estimate | Method | Window / smoothing | Why |
|---|---|---|---|
| Bodyweight trend | Exponentially weighted moving average (EMA) | ~10-day half-life (α ≈ 0.1) | Kills daily water noise while still turning within ~2 weeks of a real change. This is the standard "trend weight" approach popularized by weight-trend trackers. |
| TDEE | Rolling regression of intake vs. trend-weight change | 21-day window, updated daily | Long enough to average out logging error and daily variance; short enough to catch a real metabolic shift within a mesocycle. |
| Rate of weight change | Linear slope of the trend line | 14–28 day window | Feeds "on track / behind" on the fat-loss or gain goal. |
| e1RM per lift | Epley on best set, EMA-smoothed | 3–5 most recent sessions for that lift | Single sessions are noisy (sleep, stress); smoothing gives a stable progression signal. |
| Adherence rate | Completed ÷ planned | Trailing 28 days | One month captures a realistic behavioral rhythm without over-reacting to one bad week. |

### 1.4 Confidence, not just point estimates

Every Tier 3 estimate carries a **confidence** that rises with data volume and consistency and **decays with staleness** (no weigh-ins for 10 days → TDEE confidence falls). *(→ Resolved in v0.7 (R13): confidence is now a defined `[0,1]` formula with bands; the 10-day decay onset lives in the reconciled R16b table.)* Confidence drives real behavior:

- **Low confidence → conservative planning.** Hedge: smaller calorie adjustments, gentler load jumps, wider projection bands.
- **High confidence → the plan can be assertive.**
- Confidence is surfaced directly in the analytics UI (§4) so the user learns that *consistency shrinks uncertainty* — which is itself a motivator.

---

## 2. Horizon planning — one goal tree, sized to the user's goals

The naïve approach would be eleven independent plans (daily, weekly, monthly, quarterly, 6/9/12-month, 2yr, 5yr…). That's wrong: they'd drift and contradict each other. Instead there is **one hierarchical goal tree** — top-down targets, bottom-up truth.

### 2.1 Horizons are derived from the user's goals, not fixed

**Per your direction:** the set of horizons that exist is entirely determined by the user's stated goals. There is no five-year plan for a six-month goal, and a ten-year aspiration generates planning nodes all the way out to ten years.

When a goal is created or edited, Intella derives the horizon ladder from its target date:

- A goal due in **~6 months** → horizons: Day, Week, Month, Quarter, 6-month. Nothing longer.
- A goal due in **~10 years** → the full ladder: Day, Week, Month, Quarter, 6mo, 1yr, 2yr, 5yr, 10yr.
- Multiple concurrent goals with different dates → the ladder extends to the **furthest** goal; nearer goals attach their milestones to the appropriate rungs.

The ladder is rebuilt whenever goals change, so it always matches current intent and never carries dead long-horizon nodes.

### 2.2 Direction down, truth up

| Horizon (present only if a goal needs it) | What it fixes | Regenerated | Nature |
|---|---|---|---|
| 5yr / 10yr | Identity-level intent ("bodyweight 2× squat; sub-15% BF and hold it") | Rarely — on major life change | Directional aspiration |
| 1yr / 9mo / 6mo | Phase sequence (bulk → cut → maintain blocks) + milestones | Quarterly, or when trajectory diverges | Roadmap of mesocycles |
| Quarter (~3mo) | Current mesocycle: progression scheme, calorie phase, volume landmarks | Monthly, or on stall | **Committed block** |
| Month | Deload timing, volume ramp, budget rhythm | Weekly | Tactical |
| Week | The meal plan + training split + grocery list (today's v0.2 output) | Weekly | Concrete |
| Day | Today's session, today's meals, pre-filled loads | Real-time from feedback | Execution |

Two rules make the tree coherent:

1. **Only the lowest horizons touch reality.** Day and Week are where logging happens. Everything above is a projection.
2. **Lower horizons report a *trajectory delta* upward.** Each week, projected vs. actual is compared on the metrics each higher goal cares about (strength slope, weight trend, adherence). When the accumulated delta crosses a threshold, the next horizon up is marked **stale** and re-planned. So a 6-month plan isn't rewritten daily — it's rewritten when the evidence says its assumptions are now wrong.

### 2.3 Committed plan vs. directional aspiration

To honor "adaptive, not static," we draw a firm line:

- **Committed** (Quarter and below): concrete, generated, executable, and the thing the user follows day to day.
- **Directional** (6-month and beyond): a stored *aspiration and phase intent* that **shapes** quarterly planning but is not a rigid week-by-week script. A 5- or 10-year node is essentially a target and a slope expectation, not 260 pre-planned weeks. This keeps long horizons honest — they guide, they don't pretend to predict a decade of Tuesdays.

### 2.4 Each horizon is a generator (reusing the v0.2 pattern)

Every horizon runs the same `rules → LLM → validator` flow:

- **Rules** assemble the constraint object — now including *the parent horizon's targets* and *the child horizon's actuals* alongside the profile/estimate data.
- **LLM** does the qualitative sequencing and selection (which phase next, which mesocycle style, how to narrate it).
- **Validator** checks feasibility against the estimators. Example: if the current strength slope projects a 2× bodyweight squat in ~18 months but the goal demands 6, the validator **rejects** and forces either a longer timeline or a revised milestone — it will not emit a plan that reality can't support. *(→ Resolved in v0.7 (R15): feasibility never blocks — the planner emits the best feasible plan under an auto-relax order and an advisory `PlanNode`, which Michael can accept or override.)*

As in v0.2, every horizon node stores its `inputConstraints`. That is what lets the app answer *"why is my January block a cut?"* → *"because the September projection had you hitting your lean-mass milestone by December, so the plan sequenced a cut next."*

---

## 3. Learning from habits — three loops at three clocks

The `Feedback` table already captures *explicit* signals. The bigger adaptation gains come from *implicit/behavioral* learning — what the user does, not just what they say.

### 3.1 Fast loop — per session/day — execution tuning

"Felt easy," missed reps, a skipped day. Adjusts tomorrow's load and redistributes this week's volume. **Largely already built in v0.2.**

### 3.2 Medium loop — weekly — preference & adherence modeling

This is the underbuilt, high-value loop. Learn *without asking*:

- **Meal adherence.** Which planned meals get cooked, swapped, or ignored. A meal swapped away three times is a revealed dislike — down-weight it even if never explicitly flagged. A meal re-cooked unprompted is a favorite — up-weight it.
- **Session adherence by slot.** If Friday sessions are skipped 60% of the time, stop scheduling the hardest session on Friday. This is a *habit the system detects*, not a preference the user would think to declare.
- **Grocery reality.** Pantry items that never get consumed; quantities consistently over/under. Tightens future rounding and subtraction.

Model each as a **recency-weighted (decaying) weight** per entity, so stale behavior fades and recent behavior dominates. This is the concrete implementation of the Epics' *"steer the method, not just the output."*

### 3.3 Slow loop — monthly/quarterly — model correction

Re-fit the Tier 3 estimators, recompute confidence, and ask whether the *coaching method itself* is working. Key diagnostic: **if adherence is high but the outcome is flat, the method is wrong, not the execution.** High adherence + stalled strength ⇒ the progression scheme is the problem ⇒ escalate to a mesocycle change rather than nagging the user to try harder.

### 3.4 One critical guardrail: "couldn't" vs. "wouldn't"

A session skipped for a work trip is **noise**; a systematically avoided exercise is **signal**. A one-off disruption must not be learned as a durable pattern. A lightweight free-text reason on a skip/swap (parsed by the LLM into a structured cause, exactly as v0.2 already parses feedback) disambiguates the two so the model doesn't learn spurious habits.

---

## 4. Position & trajectory — the analytics surface

Three distinct questions deserve three distinct views.

### 4.1 Current position — a state snapshot

A dashboard (not a chart): estimated TDEE with its confidence band, current e1RMs, **trend** bodyweight (never raw), 28-day adherence rate, macro-hit rate, weekly volume per muscle group vs. landmarks. Every number shows its **freshness/confidence** so the user can see what's well-established and what's still a guess.

### 4.2 Trajectory — projection with honest uncertainty

For each active goal, plot actual-to-date plus a **projection cone (fan chart)** out to the target date, driven by the current fitted slope. The cone **widens with lower-confidence estimates and narrows as data accumulates** — visually teaching that consistency shrinks uncertainty. Mark milestones and label each **on track / ahead / behind**. When behind, the same panel states plainly what changed and what Intella did about it (extended the timeline, raised volume, widened the deficit).

### 4.3 Trajectory-delta log — the "why it changed" record

A running, plain-language history of *why the plan changed over time*:

> **Week 7** — measured TDEE revised 2,150 → 2,240 kcal (weight held flat on logged intake). Deficit widened 150 kcal to keep the fat-loss rate on target for the March milestone.

This is v0.2's transparency window applied across *time*. It is likely the single most trust-building surface in the product, and it costs almost nothing to build because the `inputConstraints` behind every generation are already stored — the log is mostly a diff between successive constraint snapshots, narrated.

### 4.4 Visual notes

Weight and e1RM charts show raw points with an EMA/trend line overlaid. Projections render as a shaded band (the cone). All of this fits the existing chart stack; no new dependency.

---

## 5. Data-model deltas

Minimal additions to the v0.2 schema (§7 of the build plan). Conventions (single-user, `inputConstraints` for explainability) are preserved.

| Entity | Key fields | Notes |
|---|---|---|
| `MetricEstimate` | `metric, value, confidence, windowStart, windowEnd, method, computedAt` | The materialized Tier 3 state. Regenerated by scheduled jobs. One current row per metric + history. |
| `PlanNode` (Horizon) | `level, parentId, goalId, targets{}, milestones[], inputConstraints{}, status, projectedVsActual{}` | The goal tree. `level` ∈ {day, week, month, quarter, 6mo, 1yr, 2yr, 5yr, 10yr}. Nodes exist only when a goal requires that horizon (§2.1). |
| `AdherenceEvent` | `domain, plannedRef, actual, delta, causeParsed, cause: {couldnt|wouldnt|unknown}, createdAt` | Planned-vs-actual for the medium loop. Can extend `Feedback` rather than stand alone. |
| `PreferenceWeight` | `domain, entityId, weight, lastUpdated` | Recency-decayed learned weights (meals, exercises, slots). |
| `TrajectorySnapshot` | `goalId, takenAt, projectedSeries[], confidence` | Periodic frozen projections so the cone and delta-log have history ("what we predicted in March vs. what happened"). |

`BodyMetric` already exists — the EMA/trend is a **derived read**, not a stored raw value. Existing `SetLog`, `PlannedMeal`, and session status become the Tier 2 event history feeding the estimators.

### New engine: `estimation/`

Alongside `training/`, `nutrition/`, `grocery/`, add an **`estimation/`** module exposing:

- `recompute(metric)` — re-fit a Tier 3 estimate from Tier 2 events.
- `project(goal, horizon)` — produce the projection series + confidence for the trajectory view.
- `checkStaleness(planNode)` — compute the trajectory delta and flag higher horizons for regeneration.

Critically, `estimation/` runs on a **scheduler**, not on request. This is the piece that keeps "the model constantly updating so future plans change with reality." A nightly job recomputes estimates; a weekly job recomputes staleness and re-plans what's stale.

---

## 6. API deltas

New endpoints, consistent with the v0.2 REST/JSON surface and bearer auth. (Estimates are *read* by clients but *written* only by the scheduler, so most are GET.)

| Area | Endpoint | Purpose |
|---|---|---|
| Estimates | `GET /estimates` · `GET /estimates/{metric}` | Current Tier 3 state + confidence for the position dashboard. |
| Horizons | `GET /plan/tree` | The full goal tree with per-node status. |
| | `GET /plan/node/{id}` | One horizon node + its `inputConstraints` (the "why"). |
| | `POST /plan/node/{id}:regenerate` | Force re-plan of a horizon (also triggered automatically on staleness). |
| Trajectory | `GET /trajectory/{goalId}` | Actual-to-date + projection cone + milestones + on-track status. |
| | `GET /trajectory/{goalId}/log` | The plain-language trajectory-delta history. |
| Adherence | `POST /adherence` | Record a planned-vs-actual event with optional free-text cause. |

Goal creation/edit (`PUT /goals`, already in v0.2) gains the side effect of **rebuilding the horizon ladder** (§2.1) to match the new target date(s).

---

## 7. New & extended Epics

Framed in the Epics doc's voice (*"As Michael, I want … so that …"*).

### Epic 6 — A Living Model of Me

**The essence:** Intella's picture of Michael sharpens the more he uses it. The numbers his plans depend on — what he really burns, what he can really lift, how consistently he really trains — are inferred from what he actually does, not from a form he filled in once. When reality and the formula disagree, reality wins.

- As Michael, I want my true maintenance calories inferred from my logged intake and weight trend so my plan corrects itself instead of trusting a onboarding estimate forever.
- As Michael, I want my strength and bodyweight read from trends rather than single noisy days so the app reacts to real change, not water weight.
- As Michael, I want every estimate to show how confident it is so I know which parts of my plan are well-grounded and which are still guesses.
- As Michael, I want my plans to hedge when the data is thin and get assertive when it's solid so I'm never pushed hard on a bad estimate.

### Epic 7 — Planning Across My Horizons

**The essence:** Michael's goals define how far ahead Intella plans. A six-month goal gets planning out to six months; a ten-year ambition gets a ladder all the way out. Long horizons set direction, short horizons do the work, and evidence from the short horizons quietly rewrites the long ones when reality diverges.

- As Michael, I want the app to plan only as far out as my goals actually require so I'm never handed a fake five-year plan for a six-month goal.
- As Michael, I want a long-term ambition to produce real milestones at every horizon between now and then so I can see the path, not just the destination.
- As Michael, I want my near-term plans to stay concrete and my far-term ones to stay directional so the app is committed where it can be and honest where it can't.
- As Michael, I want a horizon to re-plan itself when my actual results drift from what it assumed so my long-term plan never quietly goes stale.
- As Michael, I want the app to refuse a milestone that my current trajectory can't reach in time, and tell me so, rather than promise something impossible.

### Epic 8 — Learning My Habits

**The essence:** Beyond what Michael explicitly tells it, Intella watches what he does — which meals he cooks, which he swaps, which days he skips — and bends future plans toward his real behavior, while never mistaking a one-off disruption for a lasting preference.

- As Michael, I want meals I keep swapping away to stop showing up, even if I never said I disliked them, so the plan learns my tastes from my actions.
- As Michael, I want the app to stop scheduling hard sessions on days I consistently miss so my plan fits the life I actually live.
- As Michael, I want a one-off skip for a work trip treated differently from a pattern of avoidance so the app doesn't learn the wrong lesson from a bad week.
- As Michael, when I'm adherent but not progressing, I want the app to change its method rather than tell me to try harder.

### Epic 9 — Seeing Where I Stand and Where I'm Headed

**The essence:** At any moment Michael can see his current state, his projected trajectory toward each goal with honest uncertainty, and a plain-language history of exactly why his plan has changed over time.

- As Michael, I want a single snapshot of my current state — burn, strength, weight trend, adherence — each labeled with how fresh and trustworthy it is.
- As Michael, I want a projection toward each goal that widens when I'm inconsistent and tightens when I'm steady so I can see that consistency literally shrinks my uncertainty.
- As Michael, I want to know at a glance whether I'm on track, ahead, or behind each milestone, and what the app did about it when I fell behind.
- As Michael, I want a running log of why my plan changed over time so I can trust that every adjustment had a reason.

---

## 8. Build plan (phased) — extends v0.2 §10

These phases assume the v0.2 web prototype (Phases 0–5) is in place, since the estimators need real logged data to run against.

- **Phase 7 — Estimation core.** `MetricEstimate` model; the `estimation/` engine; TDEE + trend-weight + e1RM estimators with the §1.3 windows; nightly recompute scheduler; confidence scoring. *Depends on: logging from Phases 2–4.*
- **Phase 8 — Horizon planning.** `PlanNode` tree; ladder derivation from goal target dates; per-horizon generators reusing `rules → LLM → validator`; staleness detection + auto-regeneration; committed-vs-directional distinction and the feasibility validator.
- **Phase 9 — Habit learning.** `AdherenceEvent` + `PreferenceWeight`; medium-loop weekly modeling; "couldn't vs. wouldn't" cause parsing; slow-loop monthly method-check; wire learned weights into the meal and training generators.
- **Phase 10 — Analytics surfaces.** Position dashboard; trajectory fan-chart with confidence cone; `TrajectorySnapshot` history; trajectory-delta log narrated from constraint diffs.
- **Phase 11 — Hardening.** Backfill behavior on sparse data (cold-start priors → estimates as data arrives); tunable-window config surface; empty/low-confidence states across all new UI.

---

## 9. Open decisions

Don't block starting Phase 7; do want your call before the relevant phase.

- **Cold-start behavior.** Before ~2–3 weeks of data exists, estimators fall back to onboarding formulas with explicit low confidence. Confirm you're fine seeing "low confidence" prominently early on rather than a falsely precise number. → Resolved in v0.7 (R16b): the single reconciled cold-start constants table replaces the "~2–3 weeks" figure.
- **Weigh-in cadence expectation.** The TDEE/trend estimators assume reasonably regular bodyweight logging (ideally most mornings). If your logging is sparser, we lengthen windows and lower confidence accordingly — worth confirming your realistic cadence. → Resolved in v0.7 (R16b): windows/minimums set in the reconciled cold-start table.
- **Staleness thresholds.** How much drift before a long horizon re-plans itself — tighter thresholds mean a more reactive plan, looser means a steadier one. Sensible defaults proposed; tunable later. → Resolved in v0.7 (R13/R16b): confidence formula + decay/re-baseline thresholds now defined.
- **Directional-horizon review rhythm.** How often you want to be *prompted* to revisit 2yr+ aspirations (they don't auto-regenerate the way committed blocks do). Quarterly is the proposed default. → Resolved in v0.7 (R14): one shared horizon tree, multi-goal conflict by `Goal.priority`.

---

*Companion files: `Intella_Product_and_Build_Plan.md` (v0.2 product/architecture/tickets), `Intella_Epics_and_Stories.md` (v1 epics), `Intella_UI_Wireframes.html` (screen wireframes), `openapi.yaml` (API contract). This document (v0.3) extends all four with the adaptive-intelligence layer.*
