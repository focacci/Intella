# Intella — Epics & User Stories

*Five core vertical-slice features and the user stories that bring each to life.*

**Version:** 0.1 · **Date:** June 26, 2026 · **Companion to:** `Intella_Product_and_Build_Plan.md`, `Intella_UI_Wireframes.html`

This document frames Intella as five vertical slices — each one a complete, end-to-end capability that delivers real value to Michael on its own. Every Epic has a short description of the experience it creates, followed by the high-level user stories that capture its essence. These are written purely from the user's point of view: what Michael wants to do and why. No technical or implementation detail lives here — that belongs in the build plan.

Stories use the form *"As Michael, I want … so that …"* because Intella is a single-user app built for him alone.

---

## How to read this

| | |
|---|---|
| **Epic** | A large, self-contained slice of the product that delivers user value end to end. |
| **Story** | A single, high-level thing Michael wants — small enough to be clear, big enough to matter. |
| **Scope** | User experience only. The "how" (engines, data, APIs) is deliberately absent. |

The five Epics:

1. **Personalized Onboarding & Profile** — tell Intella who you are, and keep it current.
2. **Adaptive Training** — know what to lift today, log it, and keep progressing.
3. **Meal Planning** — a week of meals you'll actually cook, on macros and on budget.
4. **Smart Grocery List** — the plan becomes one clean, pantry-aware shopping list.
5. **Today Dashboard & Adaptive Coaching** — your day at a glance, and a coach that learns from you.

---

## Epic 1 — Personalized Onboarding & Profile

**The essence:** A friendly first-run intake where Michael tells Intella what it needs to coach him — his body, his goals, how he trains, how he eats, what he can't or won't do, and what he can spend. Because the whole app is built around him, this profile is the single foundation every workout, meal, and grocery list is derived from. Nothing Intella produces is generic; it all traces back to what's in his profile. The intake is never all-or-nothing: only a handful of essentials are needed to get going, anything optional can be skipped and filled in later, and a blank field never blocks him from starting. And the profile is never frozen — it stays editable at any time, whether Michael changes it himself or simply tells his coach in passing and lets an agent make the edit for him. Each question makes clear *why* it's asked, hard limits are treated as non-negotiable, and the whole profile keeps pace as his life changes.

**User stories:**

- As Michael, I want to provide just the essentials and skip anything optional so I can start using Intella without a long setup.
- As Michael, I want to enter my physiology — age, height, weight, and optionally body composition — so my plans are calibrated to my actual body, not an average.
- As Michael, I want to set my primary goal (build muscle, lose fat, get stronger, general health) so everything Intella produces points in the same direction.
- As Michael, I want to describe how I train — experience, days per week, session length, equipment I can access — so my program fits my real schedule and gym.
- As Michael, I want to capture my dietary pattern, dislikes, favorite cuisines, cooking skill, and weekly food budget so my meals are ones I'll actually make, enjoy, and afford.
- As Michael, I want to flag my allergies and injuries as hard limits so Intella never suggests anything unsafe for me.
- As Michael, I want each step to explain how my answer will be used so I trust the result and know my input genuinely shapes the plan.
- As Michael, I want to come back and fill in or enrich the optional parts of my profile whenever I'm ready so an unanswered question never holds me up now but still sharpens my plans later.
- As Michael, I want to revisit and edit any part of my profile myself at any time so my plans adapt as my goals, body, or constraints change.
- As Michael, I want to update my profile just by telling my coach what changed and have an agent make the edit for me so I don't have to dig through settings.

---

## Epic 2 — Adaptive Training

**The essence:** Michael opens the app and sees exactly what to train today — the right exercises with target sets, reps, and loads — without ever having to design a program himself. He logs each set in seconds, and the app quietly handles the hard parts of coaching: it adds load when he's strong, eases off when he stalls, and lets him swap a movement when equipment, boredom, or a cranky joint gets in the way. Over weeks he can watch his strength and bodyweight trend in the right direction, and at any moment he can ask why a given exercise or weight is on the card and get a plain-language answer. The result is a program that feels personally coached, not pulled from a template.

**User stories:**

- As Michael, I want a complete multi-week program built from my goal and available days so I never have to program my own training.
- As Michael, I want to open the app and see today's session — exercises, target sets, reps, and weights — so I know exactly what to do.
- As Michael, I want each set's weight pre-filled from my last performance so I just confirm and lift instead of guessing.
- As Michael, I want to log my actual reps, weight, and effort in a few taps so tracking never slows down my workout.
- As Michael, I want loads to rise automatically when I'm progressing and back off when I stall so I keep making gains without overreaching.
- As Michael, I want to swap an exercise when I lack the equipment, I'm bored of it, or something feels off so the session still works for me today.
- As Michael, I want to see my strength, training volume, and bodyweight trends over time so I have proof I'm progressing.
- As Michael, I want a plain-language reason for each exercise and load so I understand and trust what I'm being asked to do.

---

## Epic 3 — Meal Planning

**The essence:** Every week Michael gets a full plan of meals that hit his calorie and macro targets, stay inside his budget, and respect his time, cooking skill, and tastes — meals he'll genuinely cook and look forward to. He can open any meal to see how to make it and what it gives him nutritionally, swap anything he doesn't feel like for an alternative that keeps the day on track, and lean on leftovers and batch cooking so he isn't starting from scratch at every meal. Running totals show him at a glance how the week measures up against his targets and budget, so eating toward his goal stops being a daily decision and becomes something the plan just handles.

**User stories:**

- As Michael, I want a full week of meals that average out to my calorie and macro targets so I eat toward my goal without doing the math myself.
- As Michael, I want the plan to stay within my weekly food budget so eating well doesn't quietly blow my spending.
- As Michael, I want meals that fit my cooking skill and the time I have so I'm never stuck with a 90-minute recipe on a weeknight.
- As Michael, I want every meal to honor my allergies, restrictions, dislikes, and preferred cuisines so the plan is both safe and genuinely appetizing.
- As Michael, I want to open any meal to see its steps and per-serving nutrition so I know how to cook it and what it contributes to my day.
- As Michael, I want to swap a meal I don't feel like for an alternative that keeps the day's macros and cost roughly intact so the plan bends to my mood without falling apart.
- As Michael, I want batch-cook and leftover suggestions so I can cook once and eat more than once.
- As Michael, I want running totals of my macros and estimated cost against my targets so I can see at a glance that the week is on track.

---

## Epic 4 — Smart Grocery List

**The essence:** With a single step, Michael's weekly meal plan becomes one clean shopping list. Every ingredient across every recipe is consolidated so nothing is double-counted, quantities are rounded to the way he'd actually buy them, and anything already sitting in his pantry is quietly subtracted out. The list is grouped by aisle so a shopping trip is fast and backtrack-free, he can tick items off as he fills the cart, and he can print or export it to use however he likes. It's deliberately store-agnostic — Intella builds the list, and Michael decides where to shop and which sales to chase.

**User stories:**

- As Michael, I want my week's meals turned into one consolidated grocery list so I shop from a single, complete source.
- As Michael, I want ingredients that repeat across recipes merged into one line with combined quantities so nothing is double-counted.
- As Michael, I want quantities rounded to real-world amounts so I know how much to actually put in the cart.
- As Michael, I want anything already in my pantry left off the list so I don't rebuy what I already have.
- As Michael, I want to keep my pantry up to date so the list always reflects what's genuinely on hand.
- As Michael, I want the list grouped by aisle so I can move through the store quickly without doubling back.
- As Michael, I want to check items off as I shop so I can see what's left to grab.
- As Michael, I want to print or export the list so I can use it whatever way I actually shop.

---

## Epic 5 — Today Dashboard & Adaptive Coaching

**The essence:** The Today screen is Michael's home base — one glance shows his workout for the day, his meals, and a nudge toward the week's grocery list, with quick actions to start, log, or swap right there. Underneath it runs the thing that makes Intella feel like a coach rather than a static plan: everything Michael does feeds back into what comes next. The sets he logs, a quick "felt easy" or "something hurt," the dinners he swaps, the pantry he updates — all of it shapes next week's training, meals, and list. He should be able to feel the app bending toward him over time, so each week lands a little more calibrated than the last, and he should be able to see that his feedback actually changed something.

**User stories:**

- As Michael, I want a single daily screen showing today's workout, meals, and a grocery-list nudge so I understand my whole day at a glance.
- As Michael, I want quick actions on that screen to start my workout, check off a meal, or jump to my list so I can act without hunting through the app.
- As Michael, I want to tell the app when a set felt easy or something hurt so my next session adjusts to how I actually feel.
- As Michael, I want my meal swaps and ratings to shape future plans so the app gradually learns what I like and what I don't.
- As Michael, I want my pantry updates to flow into my next grocery list so it always reflects what I really have.
- As Michael, I want each new week's training, meals, and list to reflect what I did the week before so the plan keeps getting more tailored to me.
- As Michael, I want to see how my feedback changed the plan so I can tell the app is genuinely listening and stay motivated to keep it current.

---

*These Epics and stories describe the intended experience only. Constraints, data sources, intelligence design, and the phased build are covered in `Intella_Product_and_Build_Plan.md`.*
