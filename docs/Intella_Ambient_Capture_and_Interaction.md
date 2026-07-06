# Intella — Ambient Capture & Minimal-Interruption Interaction

*How Intella gathers the data its plans depend on with near-zero friction: sensing first, asking last, assuming-then-ratifying, and spending the user's attention like the scarce resource it is.*

**Version:** 0.4 (planning) · **Date:** July 4, 2026 · **Status:** Feature design — extends v0.2/v0.3 scope, targets the iOS/watchOS era (post web prototype)
**Companion to:** `Intella_Product_and_Build_Plan.md`, `Intella Adaptive Intelligence Plan.md`, `Intella_Epics_and_Stories.md`, `Intella_UI_Wireframes.html`, `openapi.yaml`

---

## 0. What this document adds

v0.3 built an adaptive engine that is **hungry for data**: TDEE from logged intake and weight trend, e1RM from logged sets, adherence from completed-vs-planned, preference weights from swaps and skips. But v0.3 quietly *assumed the data shows up*. It never said **how** — and "how" is the whole ballgame, because there are only two ways to feed it and both fail on their own:

1. **Manual logging.** The user opens the app and types everything in. This is the status quo for every fitness app, and it dies the same way every time: the logging is a tax, the tax compounds, adherence craters, and the estimators starve on sparse, biased data (people log their good days).
2. **Notifications.** The app pushes prompts to pull data out. Push too often and the user mutes notifications or deletes the app — and now you have *worse* data than manual, plus a burned channel.

This document designs the layer that escapes the dilemma: **sense what can be sensed, infer what can be inferred, and ask — rarely, cheaply, and at the right moment — only for what genuinely can't be.** It is the acquisition layer that sits *underneath* v0.3's estimation layer.

**The core problem restated:** attention is the scarcest resource in the product. Every interruption spends a little of a fixed daily budget, and the budget doesn't refill by wishing. So the design goal is not "collect the most data" — it's **"collect the most *decision-relevant* data per unit of attention spent."**

Nothing here breaks the locked posture: single-user, self-hosted, Tailscale-private, iOS native (SwiftUI), Claude-in-the-loop only where judgment is needed. This layer is **iOS/watchOS-native** by necessity — the sensors live on the devices — so it depends on the Phase 6 iOS app and lands after it.

---

## 1. Design tenets

Five rules govern every decision below. The first three are new; the last two are v0.3 tenets, extended.

1. **Sense first, ask last.** A question is an admission that inference failed. Prefer a sensor to a guess, a guess to a prompt, and a batched prompt to a real-time one. The best logging interaction is the one that never happens.
2. **Assume, then ratify.** *(Michael's model, adopted as the spine.)* Every sensed or inferred datum is written **immediately as provisional — "assumed true"** — and flows into estimators and plans right away, so Intella keeps working while the user is busy for hours or days. A **non-blocking** approval lets the user confirm or correct it whenever convenient. Ratification upgrades confidence; a correction is itself a learning signal. **The plan never waits on the user.**
3. **Every question is a one-tap correction of a pre-filled guess** — never a blank form. Intella arrives already believing an answer (from the plan + sensors) and asks the user to *ratify or nudge* it: 2–4 one-tap chips (first chip = the best guess) plus optional free text. This is the same interaction pattern Claude uses, and it is the only question format in the product.
4. **Reality overrides the formula — and sensors override self-report.** v0.3 said behavior beats the onboarding formula. v0.4 extends it: where a sensor exists, the sensor beats what the user would have typed. The watch's record of a 47-minute session is truer than a memory of "about 45 minutes."
5. **Confidence is the throttle.** v0.3's per-estimate confidence isn't just for display — it decides **whether a question is worth asking at all** (§6). Low confidence on a plan-critical estimate is the *only* thing that earns an interruption.

---

## 2. What Intella can and cannot sense (grounded reality-check)

Everything downstream depends on being honest about what iOS/watchOS actually expose to a third-party app **as of iOS 26 (2026)**. Designing against wished-for capabilities is how this layer would fail. Three buckets:

### 2.1 Sensable — passive, background, near-zero friction

Read from **HealthKit** via observer queries + `enableBackgroundDelivery`, which wakes Intella when new samples land even when it isn't open. Permissions are **per-type and silently revocable**, so the design must degrade gracefully when a type goes dark.

| Signal | Source | Use in Intella |
|---|---|---|
| Heart rate (continuous), resting HR, walking HR avg | Apple Watch → HealthKit | Session intensity; recovery; "is he exerting right now" |
| Heart-rate variability (SDNN) | Apple Watch → HealthKit | Recovery/readiness; sleep-quality corroboration |
| Sleep stages (awake/REM/core/deep) | Apple Watch worn overnight (watchOS 9+) | Sleep duration & quality — **fully passive**, no logging |
| Workouts (type, start/end, duration, HR, active energy) | Watch auto-detects & records | **Confirms a session happened** and its intensity (not reps/loads) |
| Steps, distance, flights, stand hours, exercise minutes, active/basal energy | iPhone + Watch | Daily activity level → the "activity multiplier" in TDEE, no longer a guess |
| VO₂max, respiratory rate, SpO₂ | Apple Watch | Slow-moving fitness context |
| Body mass, body-fat % | **Smart scale** → Health → HealthKit | Weight trend **fully passive** *if* a connected scale is used; else a nudge (§8) |
| Motion state: stationary / walking / running / cycling / automotive | **CoreMotion** (`CMMotionActivity`), live + historical, motion-coprocessor, negligible battery | The core **context** signal — sitting vs. moving vs. training vs. commuting |

### 2.2 Proxy-only — inferable, never certain

| Want to know | No direct sensor, so infer from | Caveat |
|---|---|---|
| "Is he working / focused?" | CoreMotion *stationary* + time-of-day + (opt-in) Calendar events + location *category* | A guess, not a fact; confirm only if it matters |
| "Is he eating right now?" | Time-of-day + arrived-home/location + a post-plan meal window | Weak; treat mealtimes as *windows to ask in*, not detections |
| "Which session was this?" | Watch workout overlapping the planned slot + HR profile | Usually unambiguous; ask only on conflict |
| "How hard did that set feel?" (RPE) | HR relative to recent norms is a hint only | Subjective — must be asked, but as one tap |

### 2.3 Not sensable — must be asked (or given up)

| Want to know | Why it's impossible | Consequence |
|---|---|---|
| **What/when he actually ate** | No device in the ecosystem senses food intake. HealthKit *stores* nutrition but nothing *detects* it. | Meals are the one domain that fundamentally needs a prompt. Make that prompt razor-sharp. |
| **Reps, weights, RPE per set** | The watch sees HR and motion, not the barbell. | Strength detail is confirmed against the *plan's pre-filled targets*, not measured. |
| **"Couldn't vs wouldn't"** behind a skip/swap | Intent is invisible to sensors. | One free-text-or-chip cause, exactly as v0.3 §3.4 requires. |
| **Screen habits via Screen Time** | ⚠️ **Reality check.** The Screen Time API (FamilyControls / DeviceActivity / ManagedSettings) hands third-party apps only **opaque tokens** — Intella can *never* read which apps are used or for how long. It can shield a category *the user pre-selects* and get a threshold callback in a heavily sandboxed extension (6 MB, little/no network). | **The "read my screen habits" idea is infeasible as imagined.** Don't build data collection on it. If screen/focus context is ever wanted, get it from CoreMotion + Calendar, or a thin *optional* DeviceActivity "focus threshold → nudge" feature (§8) that never claims to know usage. |

**Takeaway:** the biometric and activity picture is rich and mostly free; the two things that actually require the user — **food and subjective/intent signals** — are exactly the two things v0.3's estimators most need a human for. So the entire interaction design optimizes those, and lets everything else run silent.

---

## 3. The context engine — "what is Michael doing right now?"

Sensing raw streams isn't enough; the system needs to know the user's **current state** to decide whether it's safe and valuable to interrupt, and to pre-fill good guesses. A lightweight **context engine** fuses the §2.1 signals into a running, confidence-scored state timeline.

**States** (not mutually exclusive; each carries a probability): `asleep`, `working_out`, `commuting`, `sedentary_focused`, `active_moving`, `post_workout`, `meal_window`, `winding_down`, `unknown`.

**Fusion inputs:** CoreMotion class + HR level vs. personal baseline + active-energy rate + HealthKit workout events + time-of-day priors + (opt-in) Calendar + (opt-in) location *category*. Cheap, on-device, mostly from the motion coprocessor. *(→ Resolved in v0.7 (R16): the fusion is a transparent weighted-evidence score (argmax, confidence = softmax margin) and the **HR baseline** = trailing 7-day resting/active HealthKit percentiles — both specified there.)*

**Why it exists — two jobs:**

1. **Gate interruptions.** Never ask mid-set, mid-drive, or mid-sleep. *Do* surface a workout-confirm in the `post_workout` calm the watch detects when a session ends; *do* surface a meal-confirm inside a `meal_window` after `arrived_home`.
2. **Pre-fill guesses.** The state sharpens the assumed value: a 40-minute `working_out` block overlapping the planned Push day → assume the Push session happened at its targets, and only ask to ratify.

Context is **derived, not stored raw forever** — a rolling recent window is enough to drive decisions; only the *events it confirms* (a workout, a sleep block) persist as Tier-2 history.

---

## 4. The capture ladder — least-interruptive surface that works

Intella has four capture surfaces, ordered by how much attention they cost. **Always use the lowest rung that will get the datum; escalate only when value justifies it.**

| Rung | Surface | Interruption | Used for |
|---|---|---|---|
| **0 — Silent** | Background HealthKit/CoreMotion ingest → written provisionally | None | Everything sensable (§2.1): sleep, weight, steps, workout-happened, HR/HRV |
| **1 — Ambient** | Home/Lock/StandBy **widget**, Watch **complication**, **Live Activity** during a workout — glanceable, interactive via App Intents (log/confirm **without opening the app**) | None (pull, not push) | Standing approvals the user ratifies *in passing*; live workout set-ticking; the day's pending count |
| **2 — Notification** | Actionable notification: 1-tap chips (2 shown in banner, up to 4 expanded) + optional inline text | Light, and **budgeted** (§6) | The few high-value questions worth a real-time nudge, fired at a good moment |
| **3 — In-app** | The **approvals queue** on next natural app open; the batched, deferred, and skipped items | User-initiated | Everything non-urgent — cleared in one pass when the user chooses to |

The design bias is **downward**: most data enters at Rung 0–1 and is *ratified* at Rung 3 whenever the user next opens the app. Rung 2 (the push notification — the fatiguing channel) is reserved for the genuinely time-sensitive and genuinely uncertain, and is spent against a hard budget.

---

## 5. The micro-prompt — one question object, many surfaces

Every question Intella can ask is the **same atomic object**, rendered onto whichever rung fits. This is the Claude-style one-tap primitive, made concrete.

**Schema (conceptual):**

```
MicroPrompt {
  headline:      "Did you eat your planned dinner?"   // one line, human
  assumed:       <the pre-filled best guess>           // already written provisionally
  chips:         [ "Yes ✓", "Swapped", "Skipped" ]     // 2–4; chip[0] = the assumed value
  freeText:      optional, "…or tell me what you had"  // UNTextInputNotificationAction
  resolves:      dataPoint(meal:dinner, date)          // what it ratifies
  feeds:         estimate(TDEE, adherence)             // why it matters (drives VOI, §6)
  context:       [meal_window, arrived_home]           // when it's allowed to fire
  cost:          interruptionCost(low)                 // rung-2 spend if pushed
  expires:       end-of-day → stays 'assumed' if unanswered
}
```

**Render targets, one schema:**
- **Notification** — headline + first 2 chips in the banner, all 4 on expand, text via inline reply. Tap a chip → ratified, done, never opened the app.
- **Widget / complication** — the top pending prompt as tappable chips; ticking one is an App Intent that writes straight through.
- **In-app card** — the full queue; each card identical, swipe-to-confirm the assumed value en masse.

**Authoring rule:** chip[0] is *always* the assumed value, so the laziest possible response (tap the first thing, or ignore it entirely — see §7) is also the correct one when the guess was right. The user only spends real effort when Intella was **wrong**, which is exactly when the correction is most worth having.

**Illustrative prompts (one tap each):**

```
🏋️ Post-workout (fired when the watch detects the session ended)
   "Nice — 42 min, avg HR 141. Log Push day as planned?"
   [ Yes, as planned ✓ ]  [ Adjust a few sets ]  [ That wasn't my workout ]

🍽️ Meal window, arrived home
   "Dinner time. Did you have the planned salmon + rice?"
   [ Yes ✓ ]  [ Swapped → pick ]  [ Skipped ]     …or type what you ate

⚖️ Morning, no scale reading yet (only if weight-trend confidence is decaying)
   "Quick weigh-in? Trend's gone a little stale."
   [ Enter weight ]  [ Skip today ]

🛌 Skip detected (planned session, no elevated-HR block all day)
   "Looks like Leg day didn't happen. All good — what got in the way?"
   [ Travel / busy ]  [ Sore / sick ]  [ Just didn't feel it ]   ← couldn't vs wouldn't
```

---

## 6. When to ask — the value-of-information budget

This is the heart of "least interruptions." A candidate question is only allowed to reach **Rung 2** (a push) when it clears a value-vs-cost bar *and* the budget has room. Otherwise it waits quietly at Rung 1/3. *(→ Resolved in v0.7 (R16): the VOI and `interruptionCost` formulas below are now defined on comparable `[0,1]` scales, with all constants in `CaptureConfig`.)*

### 6.1 Value of Information (VOI)

Each candidate prompt scores:

```
VOI  =  uncertainty_it_resolves  ×  impact_on_a_plan_critical_estimate
```

- **uncertainty_it_resolves** — high when the assumed value is a shaky guess (a meal we can't sense, a session that conflicts), ~0 when a sensor already nailed it.
- **impact** — high for things a wrong value would corrupt: intake (drives TDEE), did-you-hit-your-lifts (drives e1RM/progression), skip-cause (drives the "couldn't/wouldn't" split). Low for the harmless and re-derivable (exact step count).

A prompt with high VOI: *"did you eat the planned dinner?"* — unsensable **and** the single biggest TDEE input. A prompt with ~0 VOI: *"did you really sleep 7h12m?"* — already sensed, and being 10 minutes off changes nothing.

### 6.2 Interruption cost & the budget

```
push  ⟺  VOI  >  interruptionCost(context, budgetSpent, timeOfDay, focus)   AND   budget_remaining > 0
```

- **Hard daily cap** on Rung-2 pushes (default small — e.g. ≤2–3; user-tunable). Everything over the cap degrades to Rung 1/3, it doesn't vanish.
- **Quiet by construction:** respect system Focus/DND, `asleep`, `working_out`, `commuting`; observe user quiet hours.
- **Batch by default:** non-urgent prompts accumulate and surface as **one** end-of-day (or next-app-open) digest at a `winding_down`/calm moment the context engine picks — not N pings through the day.
- **Right-moment, not clock-time:** the workout-confirm fires when the *session ends*, the weigh-in nudge when the *user wakes*, the meal-confirm inside the *meal window* — event-driven, so each prompt lands when it's answerable in one tap.

### 6.3 No-nag & learning the user's own tolerance

- **Never repeat an ignored prompt.** Unanswered → the assumed value simply stands (§7); fold the question into the next natural touchpoint instead of re-pinging.
- **Learn responsiveness** (habit-learning, v0.3 §3, turned on the capture layer itself): track which prompts, at which times, on which surfaces the user actually answers. Down-weight what he routinely ignores; concentrate pushes in his responsive windows. If he always clears the queue in-app at night but ignores midday pushes, Intella stops pushing midday.
- **Adherence-aware spend:** when estimates are healthy and confident, go quieter; spend the budget only when a plan-critical estimate is going stale.

The result Michael described: a notification arrives, he taps a chip or two, and in a few seconds Intella has what it needs — *and on the days he ignores it entirely, nothing breaks.*

---

## 7. Assume-then-ratify — the mechanics

Michael's model, formalized into a record lifecycle. Every observation (sensed or inferred) carries a **status** and a **confidence weight**:

| Status | Meaning | Confidence weight in estimators |
|---|---|---|
| `assumed` | Written provisionally from sensor/inference/plan; **active immediately** | Provisional — slightly discounted |
| `confirmed` | User ratified it (tapped the assumed chip) | Full |
| `corrected` | User changed it; the delta is a **learning signal** that tunes the inferrer | Full (new value) |
| `expired_assumed` | Went unanswered past its window; **stays active** as an assumption | Provisional, and gently decaying if plan-critical |

Consequences that make the app feel alive rather than needy:

- **The plan never blocks.** Tonight's provisional intake feeds tomorrow's TDEE nudge whether or not Michael ratified it. He can go heads-down for a week and Intella keeps producing sane plans on assumed data, then reconciles when he returns.
- **Corrections teach.** If Intella assumed "hit all targets" but Michael logs a missed set, that's not just a data fix — it lowers the confidence of that inference class and makes the next assumption humbler. The inferrer gets calibrated by its own mistakes.
- **Confidence honesty (ties to v0.3 §4).** Position/trajectory surfaces distinguish confirmed from assumed data, so the user can see how much of "where I stand" rests on ratified fact vs. Intella's assumptions — and that ratifying tightens it. Consistency shrinks uncertainty here too.
- **Bulk ratify.** The in-app queue lets a week of `assumed` records be confirmed in one swipe when they're all right — the common case — so ratification is itself low-friction.

---

## 8. Domain playbooks

Concrete end-to-end for each capture domain. Format: **sensed → inferred → asked (if at all) → moment.**

**Training.** *Sensed:* workout occurred, duration, HR, energy (watch). *Inferred:* which planned session it was; assume targets were hit → written `assumed`. *Asked:* one post-workout ratify — "log as planned? / adjust / not my workout"; reps-weights-RPE only if he taps *Adjust*. *Moment:* session-end calm. **Skip case:** planned session, no elevated-HR block by evening → one `couldn't/wouldn't` cause chip (feeds v0.3's spurious-habit guardrail).

**Nutrition.** *Sensed:* nothing (no food sensor). *Inferred:* the plan's meal for this slot → written `assumed` at the scheduled time. *Asked:* the sharpest prompt in the app — "had the planned X? [Yes/Swapped/Skipped] + optional text." Highest VOI, so it earns Rung 2 more than anything else. *Moment:* meal window + arrived-home. Repeated swaps of the same meal feed v0.3's preference weights automatically.

**Body metrics.** *Sensed:* weight/body-fat from a connected smart scale → silent, `confirmed`-grade (a hardware reading, not a guess). *Asked (only if no scale):* a morning weigh-in nudge, and **only when trend-weight confidence is decaying** (VOI gate) — never a daily nag. *Moment:* on wake.

**Sleep & recovery.** *Sensed:* full sleep stages + overnight HRV/RHR → silent, no logging ever. *Asked:* at most an occasional 1-tap "how rested? 😴😐⚡" and *only* when objective recovery looks off *and* it would change today's session — otherwise the plan just reads the sensors.

**Context / focus.** *Sensed:* motion state, activity level → sets the TDEE activity multiplier from real movement instead of an onboarding guess. *Screen habits:* **not collected** (§2.3). If Michael ever wants a "focus" signal, the only feasible, privacy-preserving option is an *opt-in* DeviceActivity threshold on a category he picks that fires a gentle nudge — with the explicit caveat that Intella learns *nothing* about which apps or how long.

---

## 9. How this feeds v0.3 (the seam)

This layer is the **producer**; v0.3 is the **consumer**. The mapping is exact:

- Rung-0 streams **are** v0.3's *Tier-2 observed measurements* — the append-only event history the estimators fit against. This layer is *how those tables actually get populated* on a phone in a pocket.
- The `assumed → confirmed/corrected` status and its confidence weight plug straight into v0.3's **confidence** machinery: provisional data widens the projection cone (v0.3 §4.2); ratifying narrows it.
- Meal-swap/skip capture and the `couldn't/wouldn't` cause **are** the inputs to v0.3's medium-loop preference learning and its §3.4 guardrail.
- The context engine's confirmed events (a workout, a sleep block, a real activity level) are what let the TDEE and e1RM estimators run on *measured* inputs rather than self-reported ones — the concrete payoff of tenet #4.

No v0.3 concept is redefined; this doc supplies the plumbing v0.3 assumed.

---

## 10. Data-model deltas

Minimal additions to the v0.2 (§7) / v0.3 (§5) schema; single-user and `inputConstraints`/provenance conventions preserved.

| Entity | Key fields | Notes |
|---|---|---|
| `SensorSample` | `type, value, unit, source, start, end, ingestedAt` | Raw Tier-2 events from HealthKit/CoreMotion. Append-only. The estimators' fuel. |
| `ContextState` | `state, probability, start, end, inputs{}` | Derived activity timeline (§3). Rolling window; only confirmed events persist long-term. |
| `Observation` | `domain, targetRef, value, status:{assumed│confirmed│corrected│expired_assumed}, confidence, basis{}, createdAt, ratifiedAt` | The assume-then-ratify record (§7). Wraps/annotates domain logs (`SetLog`, meal-eaten, `BodyMetric`) with status + provenance. |
| `CapturePrompt` | `headline, assumedValue, chips[], resolvesRef, feedsEstimate, voiScore, contextGate[], surface, state:{pending│answered│expired}, expiresAt` | A materialized micro-prompt (§5) and its lifecycle. |
| `ResponsivenessModel` | `surface, hourBucket, answerRate, lastUpdated` | Recency-decayed learning of when/where the user actually responds (§6.3). |
| `CaptureConfig` | `dailyPushCap, quietHours{}, perSignalPolicy{}, connectedScale:bool, calendarOptIn, locationOptIn` | The interruption budget + per-signal silent/confirm/ask defaults the user tunes. |

`BodyMetric`, `SetLog`, `PlannedMeal`, session status are unchanged — they gain an `Observation` status wrapper rather than new columns where possible.

### New engine: `capture/`

Alongside `training/`, `nutrition/`, `grocery/`, `estimation/`, add a **`capture/`** module:

- `ingest(sample)` — normalize a HealthKit/CoreMotion sample into `SensorSample`, write the provisional `Observation`.
- `deriveContext()` — fuse signals into the `ContextState` timeline.
- `proposePrompts()` — generate candidate `CapturePrompt`s with VOI scores.
- `schedule()` — apply the budget/quiet/right-moment rules; pick surface per prompt.
- `ratify(promptId, response)` — confirm/correct an `Observation`; emit the correction as a learning signal.

`capture/` runs partly **on-device** (the iOS app owns the sensors, context, notifications, widgets) and partly **server-side** (the VOI/budget policy, the source-of-truth `Observation` store). The phone is the **sensor bridge**; the self-hosted backend stays the system of record.

---

## 11. API / integration deltas

Client-side this is mostly native iOS work — **HealthKit** (background delivery), **CoreMotion**, **App Intents** (interactive widgets / Live Activities / one-tap logging), **UserNotifications** (actionable + text-input). Backend additions, consistent with the v0.2 REST/JSON + bearer-auth surface:

| Area | Endpoint | Purpose |
|---|---|---|
| Signals | `POST /signals/ingest` | Batch upload of `SensorSample`s from the iOS app (fires from background delivery). |
| Context | `GET /context/current` | Current state + probability (debug / dashboard). |
| Captures | `GET /captures/pending` | The approvals queue (Rung 3). |
| | `POST /captures/{id}:ratify` | Confirm / correct / reject an assumed observation. |
| | `POST /captures/propose` | Server-side VOI scoring + scheduling decision for candidate prompts. |
| Config | `GET/PUT /capture/config` | Interruption budget, quiet hours, per-signal policy, opt-ins. |

Writes stay small and batched to respect background-execution limits; the app can operate offline on `assumed` data and reconcile with the backend when the Tailnet is reachable.

---

## 12. New Epics (Epics-doc voice)

### Epic 10 — Capture Without Interruption

**The essence:** Intella learns what Michael did mostly by *watching the sensors he already wears*, not by making him stop and log. His workouts, sleep, weight, and activity flow in on their own; the app only speaks up for the handful of things no sensor can know.

- As Michael, I want my sleep, workouts, weight, and daily activity captured automatically from my Watch and scale so I almost never log anything by hand.
- As Michael, I want Intella to tell what I'm doing — training, sitting, commuting, sleeping — so it never interrupts me at the wrong moment.
- As Michael, I want the things a sensor can't know — what I ate, how a set felt, why I skipped — asked as a single tap on a pre-filled guess, not a blank form.
- As Michael, I want to answer from the notification or a widget without opening the app so logging costs me seconds, not minutes.

### Epic 11 — Ask Me Only What Matters, Only When It Helps

**The essence:** Intella treats Michael's attention as its scarcest resource. It asks rarely, only when the answer would genuinely change a plan, at a moment he can actually respond — and it learns to stop asking what he keeps ignoring.

- As Michael, I want Intella to interrupt me only when knowing the answer would actually change my plan, so a notification always feels worth it.
- As Michael, I want a hard limit on how often Intella pushes me, with everything else waiting quietly for when I next open the app.
- As Michael, I want questions batched and timed to calm moments — after a workout, in the evening — rather than pinged at me all day.
- As Michael, I want Intella to stop asking things I routinely ignore and learn the times I actually respond, so it fits my rhythm instead of fighting it.

### Epic 12 — It Keeps Working When I'm Busy

**The essence:** Intella never stalls waiting on Michael. Everything it senses or infers is assumed true right away and drives the plan; when he has a moment he confirms or corrects it, and the app quietly gets smarter from what he changed.

- As Michael, I want Intella to assume its best guess and keep planning even if I don't respond for days, so being busy never breaks my program.
- As Michael, I want to confirm or fix a week of assumptions in one quick pass whenever I choose, so ratifying is never a chore.
- As Michael, I want my corrections to make Intella's future guesses better, so the app earns the right to assume more over time.
- As Michael, I want to see which parts of my record are confirmed versus still assumed, so I always know what's solid.

---

## 13. Build plan (phased) — extends v0.3 §8

Depends on the Phase 6 iOS app (the sensors are native). Sequenced after v0.3's estimation/analytics phases so there's an estimator to feed.

- **Phase 12 — Sensor bridge & context.** HealthKit background delivery + CoreMotion ingest; `SensorSample` store + `POST /signals/ingest`; the context engine (`ContextState`); silent Rung-0 capture writing provisional `Observation`s. *Payoff: the estimators run on measured inputs.*
- **Phase 13 — Assume-then-ratify + capture ladder.** `Observation` status lifecycle; the approvals queue (Rung 3, in-app); actionable notifications (Rung 2) and interactive widgets/Live Activities (Rung 1) on one `MicroPrompt` schema; App-Intent one-tap logging.
- **Phase 14 — VOI budget & scheduler.** VOI scoring; the interruption budget, quiet hours, Focus/DND/context gating; right-moment event-driven delivery; batching/digest.
- **Phase 15 — Responsiveness learning & tuning.** `ResponsivenessModel`; down-weight ignored prompts; concentrate pushes in responsive windows; per-signal policy surface in Settings.
- **Phase 16 — Hardening.** Graceful degradation when a HealthKit type or permission goes dark; no-scale / no-Watch fallbacks; cold-start before context has priors; confirmed-vs-assumed indicators across the v0.3 analytics surfaces.

---

## 14. Open decisions (Michael's calls)

Don't block Phase 12; wanted before the relevant phase.

- **Interruption budget.** Starting daily push cap — 2? 3? — and your quiet hours. (Tunable later; sets the baseline aggressiveness.)
- **Which surfaces you'll actually use.** Do you wear the Watch to bed (unlocks passive sleep/HRV)? Use a HealthKit-connected smart scale (unlocks passive weight, kills the weigh-in nudge)? Want a Watch app/complication, or phone-only to start?
- **Context opt-ins.** Calendar and coarse-location improve "what are you doing" and prompt timing but are extra permissions — in or out for v1 of this layer?
- **Provisional→auto-confirm window.** How long an `assumed` record stands before it's treated as settled (e.g. auto-confirm after 48–72h unanswered), so the approvals queue doesn't grow forever. → Resolved in v0.7 (R17): auto-confirm window = 72 h, and the precedence fix (`corrected > confirmed`, server-side promote only if no pending device correction) closes the correction-loss bug.
- **Screen Time.** Given §2.3, confirm we're **dropping** screen-habit collection entirely (recommended), or scoping the thin opt-in DeviceActivity "focus-threshold nudge" that knows nothing about usage.
- **Meal-capture depth.** Just plan-adherence (Yes/Swapped/Skipped), or occasionally the actual macros of a swap (more signal for TDEE, more taps)? → Resolved in v0.7 (R24): input still needed (Michael's data/product call).

---

## 15. Feasibility grounding (as of iOS 26, 2026)

Capability claims above are grounded in current Apple frameworks: HealthKit data types + `enableBackgroundDelivery` observer queries; CoreMotion `CMMotionActivity` classification; the Screen Time API's opaque-token limitation (FamilyControls / DeviceActivity / ManagedSettings); UserNotifications actionable/text-input actions (max 4/category, 2 in banner); and App Intents–driven interactive widgets / Live Activities (iOS 17+, refreshed in iOS 26). The load-bearing constraints — **no food/screen-usage sensing, rich passive biometrics, one-tap notification/widget logging** — are firm and unlikely to loosen.

*Companion files: `Intella_Product_and_Build_Plan.md` (v0.2 product/architecture/tickets), `Intella Adaptive Intelligence Plan.md` (v0.3 estimation/horizons/analytics), `Intella_Epics_and_Stories.md` (epics), `Intella_UI_Wireframes.html`, `openapi.yaml`. This document (v0.4) supplies the ambient-capture and interaction layer that populates v0.3's estimators.*
