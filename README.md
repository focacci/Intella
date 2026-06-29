# Intella

*An intelligent personal trainer, nutritionist, and meal planner — single-user and self-hosted.*

Intella is a private coach that does three jobs well: it **programs your training**, **plans your meals**, and turns that plan into **one clean, consolidated grocery list**. It's adaptive — it learns from what you actually did (the workout you logged, the meal you swapped, what's in your pantry) and recalibrates the next plan rather than handing you a static template.

## Guiding principles

- **Personal first.** Every output is derived from *your* physiology, goals, history, and constraints — never a generic plan.
- **Adaptive, not static.** Feedback (logs, swaps, "felt easy/hard") feeds the next cycle.
- **Affordable & doable.** Meals respect a budget, an effort ceiling, and your real cooking skill.
- **Private by default.** One user, self-hosted, your data on your machine.
- **Explainable.** The app can always answer "why this exercise / why this meal / why this much."

## The three pillars

1. **Adaptive Training** — a multi-week program from your goal and available days; today's session pre-filled with target sets/reps/loads; fast set logging; automatic progressive overload, deloads, and exercise swaps; progress charts.
2. **Meal Planning** — a weekly plan that hits your calorie/macro targets within budget, effort, and dietary constraints; recipe detail; one-tap constraint-aware swaps; batch-cook/leftover awareness.
3. **Smart Grocery List** — the meal plan consolidated into one de-duplicated, pantry-aware list, unit-normalized and grouped by aisle. Store-agnostic — no prices or store accounts required.

A unifying **Today** dashboard shows the day's workout, meals, and a grocery-list nudge, and an **adaptation loop** ties every log, swap, and pantry update back into the next generation.

## How the intelligence works (hybrid)

Every generator follows the same three-layer pattern — cheap, safe, and explainable:

1. **Rules layer (deterministic)** — computes hard constraints and numeric targets from your data.
2. **LLM layer (Claude API)** — makes the human choices *within* those constraints (variety, substitutions, phrasing, interpreting free-text feedback). Always returns structured JSON.
3. **Validator (deterministic)** — rejects or repairs any LLM output that violates a constraint before it's saved.

Allergies and injuries are *hard* rules the LLM cannot override. Every generation is stored with the inputs that produced it, so results are reproducible and debuggable.

## Architecture

A single **OpenAPI spec is the source of truth** — both the web and iOS clients are generated from it so they never drift from the backend.

| Layer | Stack |
|---|---|
| **Backend** | Node + Fastify · Prisma ORM · SQLite · Zod validation · Anthropic SDK |
| **Web** | React + Vite · Tailwind CSS + shadcn/ui · TanStack Query · TanStack Router |
| **iOS** | SwiftUI (added after the web prototype is validated) |
| **Hosting** | API on `localhost`, reached privately from iPhone over Tailscale |

```
intella/
  openapi.yaml          # single source of truth
  api/                  # Fastify + Prisma + SQLite + engines
  web/                  # React + Vite
  ios/                  # SwiftUI app (added later)
```

Engines live in the API as pure, unit-testable modules (`training/`, `nutrition/`, `grocery/`), each exposing `computeConstraints()` (rules), `generate()` (LLM), and `validate()`.

## Status

Planning is locked for the web prototype. The build is phased:

- **Phase 0 — Foundations:** monorepo, Fastify skeleton, Prisma + SQLite schema, OpenAPI scaffold, bearer auth, Tailscale access, web shell.
- **Phase 1 — Profile & onboarding**
- **Phase 2 — Training engine**
- **Phase 3 — Nutrition engine** (Spoonacular + USDA FoodData Central)
- **Phase 4 — Grocery list**
- **Phase 5 — Integration & adaptation** (Today dashboard, feedback loop, hardening)
- **Phase 6 — iOS** (post-prototype)

Cross-store price optimization, send-to-cart, wearable sync, and photo logging are explicitly deferred to post-v1.

## Documentation

- [`Intella_Product_and_Build_Plan.md`](./Intella_Product_and_Build_Plan.md) — product vision, intelligence design, data model, API design, tech architecture, and the phased build with task tickets.
- [`Intella_Epics_and_Stories.md`](./Intella_Epics_and_Stories.md) — the five vertical-slice epics and their user stories.
- [`Intella_UI_Wireframes.html`](./Intella_UI_Wireframes.html) — visual wireframes of the six key web screens.

---

*Single-user app built for one. Private by design.*
