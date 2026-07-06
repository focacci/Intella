# Intella

_An intelligent personal trainer, nutritionist, and meal planner — single-user and self-hosted._

Intella is a private coach that does three jobs well: it **programs your training**, **plans your meals**, and turns that plan into **one clean, consolidated grocery list**. It's adaptive — it learns from what you actually did (the workout you logged, the meal you swapped, what's in your pantry) and recalibrates the next plan rather than handing you a static template.

## Guiding principles

- **Personal first.** Every output is derived from _your_ physiology, goals, history, and constraints — never a generic plan.
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
2. **LLM layer (Claude API)** — makes the human choices _within_ those constraints (variety, substitutions, phrasing, interpreting free-text feedback). Always returns structured JSON.
3. **Validator (deterministic)** — rejects or repairs any LLM output that violates a constraint before it's saved.

Allergies and injuries are _hard_ rules the LLM cannot override. Every generation is stored with the inputs that produced it, so results are reproducible and debuggable.

## Architecture

A single **OpenAPI spec is the source of truth** — both the web and iOS clients are generated from it so they never drift from the backend.

| Layer       | Stack                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Backend** | Node + Fastify · Prisma ORM · SQLite · Zod validation · Anthropic SDK                                                          |
| **Web**     | React + Vite · Tailwind CSS + shadcn/ui · TanStack Query · TanStack Router                                                     |
| **iOS**     | SwiftUI (added after the web prototype is validated)                                                                           |
| **Hosting** | API on `localhost`, reached privately from iPhone/iPad over Tailscale — HTTPS via Tailscale Serve, auto-started at dev startup |

```
intella/
  openapi.yaml            # single source of truth — clients generated from it
  schema.prisma           # Prisma schema (SQLite), with committed migrations
  apps/
    api/                  # Fastify + Prisma + engines + ops scripts
    web/                  # React + Vite
  packages/
    shared/               # generated API client + shared types
    eval/                 # engine evaluation harness
  prisma/                 # migrations, seed, smoke tests
  docs/                   # product plan, epics, runbooks, wireframes
```

Engines live in the API as pure, unit-testable modules (`training/`, `nutrition/`, `grocery/`), each exposing `computeConstraints()` (rules), `generate()` (LLM), and `validate()`.

## Getting started (local dev)

Prerequisites: Node, [pnpm](https://pnpm.io), and (for remote access) [Tailscale](https://tailscale.com).

```bash
pnpm install
cp .env.example .env      # then set INTELLA_AUTH_TOKEN and, for remote access, INTELLA_PUBLIC_BASE_URL
pnpm setup                # migrate + seed the libraries, then open a pairing window (prints PIN + QR)
pnpm dev                  # starts the API (:8787) and web (:5173)
```

`pnpm dev` first runs a **best-effort Tailscale preflight**: if Tailscale is up it serves the web app over your tailnet at `https://<machine>.<tailnet>.ts.net`; if it's down it logs a warning and continues (the app is still usable locally at `http://127.0.0.1:5173`). Toggle with `INTELLA_TAILSCALE_SERVE` / `INTELLA_TAILSCALE_SERVE_PORT`; run it on demand with `pnpm tailscale:serve`, undo with `pnpm tailscale:serve:off`. The first time needs a one-time tailnet step — see below.

### Reaching Intella from your iPhone or iPad

The `pnpm dev` preflight handles the plumbing, but Tailscale Serve needs a **one-time tailnet setup** the first time. End to end:

1. **Enable Serve on your tailnet — once per tailnet.** Serve is off by default, and `tailscale serve` will _hang_ until it's turned on. The easiest way: run `pnpm tailscale:serve` (or `pnpm dev`) once — if Serve is disabled the preflight prints a one-click link and continues:

   ```
   ⚠️  Serve is not enabled on your tailnet … Enable it once at
       https://login.tailscale.com/f/serve?node=<your-node-id>
   ```

   Open that link on the desktop, sign in, and approve — it enables Serve **and** HTTPS certificates for the tailnet. You only ever do this once. _(Equivalently, enable HTTPS certificates + Serve from the [Tailscale admin console](https://login.tailscale.com/admin).)_

2. **Start the app and confirm the tunnel.** Run `pnpm dev`. On startup the preflight logs the reachable address:

   ```
   ℹ️  Serving the app over Tailscale at https://<machine>.<tailnet>.ts.net → 127.0.0.1:5173
   ```

   Verify (or re-check) any time on the desktop:

   ```bash
   tailscale serve status
   # https://<machine>.<tailnet>.ts.net (tailnet only)
   # |-- / proxy http://127.0.0.1:5173
   ```

   Not sure of your machine's name? `tailscale status` lists it — it's the `….ts.net` name for this device.

3. **Connect the iPad / iPhone.** Install the Tailscale app, sign into the **same** tailnet, and toggle the VPN **on**. Confirm it joined by running `tailscale status` on the desktop — the device shows up in the list.

4. **Open the app.** In Safari, go to **`https://<machine>.<tailnet>.ts.net`** — no port number; Serve terminates HTTPS on 443 with a real certificate, so there's no security warning. The Intella shell loads and the status dot reads **"Live"** once it reaches the API (proxied through the same origin, so `/api` just works). The tailnet name is already allow-listed in the Vite dev server, so the browser isn't turned away.

5. **Keep the desktop awake and `pnpm dev` running.** The device is viewing _this_ machine — if it sleeps or you stop the dev server, the page goes dark. On a Mac, `caffeinate -s` (or disabling display sleep) keeps it reachable while you use the app.

After step 1, it's automatic forever: every `pnpm dev` re-establishes the tunnel. Stop serving with `pnpm tailscale:serve:off`. If the page won't load, the usual culprits are Serve not enabled (step 1), the desktop asleep (step 5), or the iPad's Tailscale VPN toggled off (step 3).

Common scripts: `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm format` · `pnpm prisma:migrate` · `pnpm backup:run`.

## Deployment & pairing

Intella is self-hosted on one machine and reached privately from your phone/iPad over Tailscale — **never exposed to the public internet**. This is a summary; the full **[Deployment & Pairing Runbook](docs/Intella_Deployment_Runbook.md)** covers HTTPS setup, remote-access verification, disaster recovery, and troubleshooting.

### 1. One-time host prerequisites

1. Install **Docker** and **Tailscale** on the desktop, and **Tailscale** on the iPhone/iPad — sign both into the **same tailnet**.
2. In the Tailscale admin console, enable **MagicDNS**, **HTTPS certificates**, **Tailscale Serve**, and **device approval**.

> **Serve must be enabled on the tailnet** or `tailscale serve` will hang waiting for the capability. If it's off, the first startup prints a one-click enable link (`https://login.tailscale.com/f/serve?node=…`) — open it once and approve.

### 2. Configure `.env`

`cp .env.example .env`, then set at minimum:

| Variable                  | Set it to                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `INTELLA_DATA_DIR`        | Absolute host path (bind-mounted to `/data`; holds `intella.db` + backups, survives `down`/`up`) |
| `INTELLA_PUBLIC_BASE_URL` | Your `https://<machine>.<tailnet>.ts.net` — embedded in the pairing QR                           |
| `INTELLA_AUTH_TOKEN`      | A strong random string (break-glass admin token; device tokens are minted via pairing)           |

### 3. Deploy (Docker)

```bash
docker compose up            # add -d once you've captured the QR
docker compose logs setup    # grab the pairing QR + PIN
```

The one-shot `setup` service migrates, seeds, opens a time-boxed pairing window, and prints a **PIN + QR**; the `api` service starts after it succeeds and binds **only** to `127.0.0.1:8787`. Data survives `down`/`up` because it lives in `INTELLA_DATA_DIR`.

### 4. HTTPS over Tailscale Serve

- **Local dev:** automatic via `pnpm dev` — see [Reaching Intella from your iPhone or iPad](#reaching-intella-from-your-iphone-or-ipad) for the one-time Serve enablement and device steps.
- **Docker / production host:** run Serve on the host to front the loopback-published API:

  ```bash
  tailscale serve --bg --https=443 http://127.0.0.1:8787
  ```

Now the app answers at `https://<machine>.<tailnet>.ts.net` with a valid certificate — the same value as `INTELLA_PUBLIC_BASE_URL`, so the pairing QR already points at it. (Use **Serve**, not `funnel`, which would expose it publicly.)

### 5. Pair a device

Pairing windows are **single-use and time-boxed**. Scan the QR in the Intella app (or open the printed `/pair?pin=…` URL). To pair another device — or after a window expires — open a fresh one:

```bash
docker compose run --rm setup pnpm setup:pair   # self-hosted
pnpm setup:pair                                 # local dev
```

`GET /pair` returns **403** whenever there is no open, unconsumed window, so a trusted tailnet peer can never silently pull a token.

## Status

The build is phased:

- **Phase 0 — Foundations:** ✅ complete — monorepo, Fastify skeleton, Prisma + SQLite schema with committed migrations, OpenAPI scaffold, bearer auth + device pairing, encrypted nightly backups, Tailscale remote access, web shell.
- **Phase 1 — Profile & onboarding**
- **Phase 2 — Training engine**
- **Phase 3 — Nutrition engine** (Spoonacular + USDA FoodData Central)
- **Phase 4 — Grocery list**
- **Phase 5 — Integration & adaptation** (Today dashboard, feedback loop, hardening)
- **Phase 6 — iOS** (post-prototype)

Cross-store price optimization, send-to-cart, wearable sync, and photo logging are explicitly deferred to post-v1.

## Documentation

- [`docs/Intella_Product_and_Build_Plan.md`](docs/Intella_Product_and_Build_Plan.md) — product vision, intelligence design, data model, API design, tech architecture, and the phased build with task tickets.
- [`docs/Intella_Epics_and_Stories.md`](docs/Intella_Epics_and_Stories.md) — the vertical-slice epics and their user stories (the build context every phase prepends).
- [`docs/Intella_Deployment_Runbook.md`](docs/Intella_Deployment_Runbook.md) — stand up Intella on a fresh machine, reach it over Tailscale, and pair a device.
- [`docs/Intella_Migration_Discipline.md`](docs/Intella_Migration_Discipline.md) — Prisma Migrate rules (never `db push` on real data).
- [`docs/Intella_Native_Wireframes.html`](docs/Intella_Native_Wireframes.html) — visual wireframes of the key screens.

---

_Single-user app built for one. Private by design._
