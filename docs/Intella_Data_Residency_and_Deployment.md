# Intella — Data Residency, Offline Sync & Deployment

*Where every piece of data lives, exactly what works with the API unreachable, and how you stand the whole system up on a fresh machine — specified concretely enough to hand to a coding agent.*

**Version:** 0.6 (planning) · **Date:** July 5, 2026 · **Status:** Feature design — specifies the on-device/API split, the offline sync wire protocol, and new-machine deployment.
**Extends:** v0.5 §11 (offline conflict rule — reused wholesale as the *merge* rule; this doc adds the *wire format*) and v0.5 §8 (iOS distribution — the paid Developer Program + TestFlight recommendation, now your confirmed choice).
**Companion to:** `Intella_Product_and_Build_Plan.md` (v0.2), `Intella Adaptive Intelligence Plan.md` (v0.3), `Intella_Ambient_Capture_and_Interaction.md` (v0.4), `Intella_Operational_Completeness.md` (v0.5), `Intella_Epics_and_Stories.md`, `openapi.yaml`, `schema.prisma`, `Intella_UI_Wireframes.html`.

---

## 0. What this document adds (and what it deliberately reuses)

You asked two questions — *which data is on-device vs. behind the API (and how does the app work offline)?* and *what does setup look like for a new user?* — and for other gaps worth closing before development.

Three of those are already settled and are **not re-opened here**, only referenced:

- **How offline conflicts resolve** — v0.5 §11 fixes the merge rule (Observation status precedence + last-writer + idempotency keys). This doc specifies the *transport* that carries writes to that rule; it does not change the rule.
- **iOS distribution mechanism** — v0.5 §8 already recommends the paid Apple Developer Program + TestFlight. You confirmed **TestFlight (private)**. Section 8 here is the concrete install/pairing flow, not a re-decision.
- **Backups, encryption, degraded modes, cost routing** — v0.5 §2–§7. Residency and deployment are designed to respect them (e.g., the device never runs an estimator; it shows the server's last-known-good).

What is **genuinely new** and written here: (1) an explicit **data-residency map**, (2) the **offline contract** per pillar, (3) the **on-device storage design** including the Apple Watch tier, (4) the **sync wire protocol** and (5) the **sync columns the current `schema.prisma` still lacks** and must gain in Phase 0, (6) a **Docker-first deployment + first-run setup**, and (7) a **new-machine / disaster-recovery runbook**. Nothing here breaks the locked posture: single-user, self-hosted, Tailscale-private, hybrid `rules → LLM → validator`.

---

## 1. The residency principle (one line)

> **The server is the system of record and the only brain; the device is a fast, offline-capable cache and the *birthplace* of anything that can only be captured in the moment. Everything the device authors is append-only (events merge) or versioned (mutable rows follow v0.5 §11), queued in a local outbox, and reconciled when the tailnet returns.**

This is just v0.5's operating principle — *degrade to last-known-good, mark what's provisional, reconcile when reality returns, never hard-stop* — applied to the network boundary. Two consequences fall straight out:

- **The device never computes derived intelligence.** Estimators, LLM generation, provider lookups, aggregation/categorization, and backups all live server-side. Offline, the device shows the last values the server sent, already labeled with confidence/freshness (v0.3 §4.1) — so "stale because offline" and "stale because thin data" render identically and honestly.
- **The device is the *only* place some data can be born.** HealthKit and CoreMotion are readable only on-device; in-the-moment set logs, meal ratifications, and grocery check-offs happen where the user is, often with no signal. These must be fully writable offline and can never be lost.

---

## 2. Data residency map

Read this as: *what the device keeps locally*, *what role the server plays*, and *what happens with the API unreachable*. Entities are the v0.2 (`schema.prisma`) core plus the v0.3/v0.4/v0.5 additions.

**Legend — device role:** *Cache* = read-only copy pulled from server · *Author* = data originates on the device (primary write path) · *Cache+edit* = cached but locally editable · *—* = not on device.

| Domain / Entity | Device role | Server role | With API unreachable |
|---|---|---|---|
| **Profile, Goal, TrainingProfile, DietProfile** | Cache+edit | System of record (SoR) | View + edit locally; queued; `version`/§11 on reconcile |
| **Program, WorkoutSession (planned items)** | Cache (current + upcoming weeks) | SoR + LLM generation | View current plan; **generating a new program/week needs the server** (request queued) |
| **SetLog** | **Author** (primary offline write) | Store + feed progression | Full logging works; append-only → merges, never conflicts |
| **BodyMetric** | **Author** (weigh-ins; some via HealthKit) | Store + trend/estimator input | Logging works; append-only |
| **MealPlan, PlannedMeal** | Cache (current week); status **Author** | SoR + LLM generation | View plan; mark eaten / swap to a **cached** recipe; new plan or provider-backed swap needs server |
| **Recipe** | Cache (planned + recently used, incl. images) | Cache-from-provider (Spoonacular/USDA) | Cached recipes fully usable; novel lookup online-only. Macros immutable → **indefinite** stale tolerance (v0.5 §2.3) |
| **Ingredient** (canonical + aisle category) | Cache (referenced only) | SoR + seeded | Fine — effectively static |
| **PantryItem** | **Author** (quick qty edits) | SoR | Edit locally; queued; versioned |
| **GroceryList, GroceryListItem** | Cache list; **Author** check-off + manual adds | SoR + aggregation/categorization | **Full in-store use**: check off, add manual items; regeneration is server-side |
| **Feedback** (free text + MicroPrompt answers) | **Author** (raw) | Parse → `structured` (LLM) | Capture raw offline; parsing happens on sync |
| **SensorSample, ContextState, Observation, CapturePrompt** (v0.4) | **Author** (HealthKit/CoreMotion only readable here) | Receive **derived** events/summaries | Capture continues offline (HealthKit background delivery); buffered; **raw firehose stays on-device**, only estimator-relevant derivations ship (v0.5 §5.4) |
| **MetricEstimate, PlanNode, PreferenceWeight, TrajectorySnapshot** (v0.3) | Cache (latest for display) | **Compute** (estimation engine on scheduler) | Show last-known estimates with confidence/staleness; device never computes these |
| **GenerationCache, LlmCall, BackupRun** (v0.5) | — | Server-only | n/a |
| **OpsConfig** (v0.5) | Cache (read, for Settings) | SoR | Settings view from cache; edits queued |
| **ApiToken** (v0.5) | Device holds **its own** token in Keychain (not the table) | SoR (hashes) | Token already local; auth resumes on reconnect |

The shape to notice: **everything a person does in the moment is device-authored and works offline; everything that needs the brain is server-side and degrades to last-known-good.** The high-value offline write paths — set logging and grocery check-off — are exactly the append-only ones that can never conflict.

---

## 3. The offline contract, per pillar

A crisp promise the app must keep, suitable as an acceptance target.

- **Training — fully *loggable* offline; generation is server-side.** View today/this week, log every set (reps/weight/RPE), mark a session complete/partial/skipped, add feedback. Only *generating a brand-new program or week* requires the server; offline shows the current plan and queues the request. (Progression math is deterministic and server-side; there is no on-device generation.) *(→ Resolved in v0.7 (R20): "fully usable" was an overstatement — the device is fully loggable, and on-device set pre-fill reads the last server-computed targets on the session card, not on-device computation.)*
- **Meals — works mostly offline.** View the week, mark meals eaten, swap to an already-cached recipe, log feedback. *New plan*, *provider-backed swap*, and *novel nutrition lookup* need the server.
- **Grocery — fully *loggable* offline; generation is server-side.** This is the in-store path: view the list, check items off, add manual items, edit the pantry. *Regenerating* the list after a new meal plan is server-side. *(→ Resolved in v0.7 (R20): loggable, not "fully usable" — generation/regeneration is server-side; R19 guarantees an offline check-off survives a server regeneration.)*
- **Profile & settings — works offline.** View and edit; changes queue and reconcile by version.
- **Ambient & health (v0.4) — capture works offline.** Assume-then-ratify plus HealthKit background delivery means data keeps landing with no connection; ratification and derived-event upload happen on sync.

Everywhere the rule is the same: **the moment isn't blocked; the brain catches up.**

---

## 4. On-device storage design

### 4.1 Local store (iPhone/iPad)

The device needs a real local database, not just a response cache, because it must persist unsynced writes across launches and serve every screen offline. Two credible choices:

- **GRDB (SQLite) — recommended.** A mature SQLite layer with full SQL control. It mirrors the server's SQLite shapes almost 1:1, makes the custom **outbox / watermark / tombstone** tables trivial, and gives transparent migrations — all of which the sync engine leans on. SwiftUI views observe it via `ValueObservation`.
- **SwiftData — viable alternative.** Apple-native and less boilerplate, but it hides SQL and its own persistence model, which fights a hand-rolled sync engine (you're building sync regardless — SwiftData doesn't give it to you here). iOS 17+ only.
- *(Core Data is the heavier legacy option; skip it.)*

Recommendation: **GRDB** for control over the offline-first machinery; flagged as your call in §11 (not blocking — iOS is Phase 6+).

### 4.2 Local schema = server subset + sync columns

The device stores the subset of entities from §2 it needs, each carrying the sync columns from §6, plus two device-only tables:

- **`Outbox`** — one row per pending mutation: `{ clientId (UUID), entity, op (upsert|delete), payload (JSON), baseVersion?, clientUpdatedAt, attempts }`. FIFO. Never evicted until the server acks.
- **`SyncState`** — the last pull cursor (per entity or global) + `lastSyncAt`.

### 4.3 Retention, media, secrets

- **Retention:** keep the current period plus a trailing window (recommend **8–12 weeks**) of sessions/plans/logs; recipes referenced by cached plans plus recently used; **never evict undelivered outbox rows**. Full history stays server-side, fetched on demand (e.g., opening a 6-month chart pulls from the server).
- **Media:** recipe images / exercise `mediaUrl` are cached in a **size-capped on-disk image cache**, keyed by URL — never stored in the DB and never in the sync stream.
- **Secrets:** server base URL + this device's bearer token live in the **Keychain**; the local DB is covered by iOS Data Protection (encrypted at rest when the device is locked).

### 4.4 The Apple Watch tier

The Watch keeps its own tiny store for the live session only (current `plannedItems`, rest timer, heart rate from HealthKit, one-tap set-complete + RPE chips). It rarely has independent internet, so it **does not talk to the API directly** — it syncs to the iPhone over `WatchConnectivity` (`transferUserInfo` for reliable queued background delivery; `sendMessage` mid-set when reachable). The phone merges the Watch's outbox into its own and is the single uplink.

> **Three tiers, one uplink: Watch → iPhone → Server.** The Watch is authoritative for in-set logging; the phone de-duplicates by `clientId`, so a set logged on the Watch and never double-counted even if both later reach the server.

---

## 5. The offline sync wire protocol

This is the transport for the merge rule v0.5 §11 already fixed. Two directions, both over the existing bearer-auth REST surface, both added to `openapi.yaml` (the locked single source of truth for both clients).

### 5.1 Push — device → server

`POST /sync/push` with a batch of outbox rows in FIFO order. Each mutation:

```
{ clientId, entity, op, payload, baseVersion?, clientUpdatedAt }
```

The server applies **v0.5 §11 precedence**:

- **Append-only event entities** (`SetLog`, `BodyMetric`, `Feedback`, `SensorSample`, `Observation`) → **upsert by `clientId`**. Idempotent: a replayed batch is a no-op. These merge and cannot conflict.
- **Mutable entities** (`PlannedMeal.status`, `PantryItem`, `GroceryListItem.checked`, profile rows) → **version + precedence**: user-ratified (`confirmed`/`corrected`) beats `assumed`/sensor beats `expired_assumed` regardless of timestamp; between equals, last-writer by `clientUpdatedAt`.

The response returns, per `clientId`, the applied result and the authoritative row (so the client overwrites its local copy when the server resolved a conflict differently).

### 5.2 Pull — server → device

`GET /sync/pull?since={cursor}&entities=…` returns every change with `serverSeq > cursor`, **including tombstones** (soft-deleted rows), plus the new cursor. The device applies changes, honors deletes, and advances `SyncState`. This is the channel by which **server-computed derived data** (fresh estimates, newly generated plans, regenerated grocery lists) reaches the device.

### 5.3 Mechanics

- **Cursor:** a server-side monotonic change sequence (`serverSeq`, §6) bumped on every write. The device stores the last value it has seen.
- **Deletes:** soft-delete (`deletedAt`) so deletions propagate on pull; a background job hard-purges old tombstones server-side.
- **Ordering & failure:** push is FIFO; because the server is idempotent per `clientId`, a partial failure just replays safely on the next attempt. Pull paginates by `serverSeq`.
- **HealthKit boundary:** the phone converts HealthKit samples into the derived events/summaries the estimators need and pushes *those*; it does **not** ship the raw sample firehose (privacy + volume; v0.5 §5.4).
- **When sync runs:** on foreground, on network-regain, and on background app refresh; every failure is non-blocking (v0.5 §2).

---

## 6. Schema deltas needed *now* (Phase 0)

The current `schema.prisma` is not yet sync-ready. Retrofitting sync metadata after real Tier-2 history accumulates is the painful path, so these belong in **Phase 0**, even though the device that uses them arrives in Phase 6.

| Model | `updatedAt` | `version Int` | `deletedAt` (tombstone) | `clientId` (idempotency) |
|---|:--:|:--:|:--:|:--:|
| Profile, Goal, TrainingProfile, DietProfile | ✔ (add where missing) | ✔ | — | — |
| WorkoutSession | ✔ | ✔ (status edits) | — | — |
| SetLog | ✔ | — | — | ✔ |
| BodyMetric | ✔ | — | — | ✔ |
| PlannedMeal | ✔ | ✔ | — | — |
| PantryItem | ✔ (has it) | ✔ | ✔ | ✔ (device-authored) |
| GroceryListItem | ✔ | ✔ | ✔ (manual items) | ✔ (manual items) |
| Feedback | ✔ | — | — | ✔ |

Plus one global mechanism: a **monotonic server change sequence** — either a `ChangeLog` table appended on every write, or a `serverSeq BigInt` column maintained by middleware — to power the `/sync/pull` cursor. This is the single most important "do it now" item in this document; the rest of sync is cheap once these exist. (v0.5 §16 already scheduled the *precedence/idempotency* work as T13.5 for Phase 12–13; this doc pulls only the **columns** forward to Phase 0 so the API is born sync-ready.) *(→ Resolved in v0.7 (R2): the either/or is decided — one append-only `ChangeLog` whose autoincrement PK **is** `serverSeq`, not a per-row column. And (R19) regeneration is non-destructive to in-flight local state — a check-off references `{listId, ingredientId}`, old lists are archived not deleted, and `checked` carries forward by canonical-ingredient match.)*

---

## 7. Deployment — the API as a downloadable service

**Recommendation: ship it as a Docker Compose bundle.** One artifact runs identically on Windows (Docker Desktop / WSL2), macOS, and Linux — which is exactly the "straightforward on all three" ask — and you picked the fastest-path option, so there's no packaging polish to justify a bespoke installer.

### 7.1 The bundle

```yaml
# compose.yaml (sketch)
services:
  api:
    image: intella/api:latest        # or build: ./apps/api
    restart: unless-stopped          # always-on: survives reboots
    env_file: .env
    volumes:
      - ~/Documents/Intella:/data     # intella.db + /backups live here (v0.5 §5.1)
    # no published ports to the public internet — reached only over Tailscale
  # optional: a local model for routine LLM work (v0.5 §3)
  # ollama: { image: ollama/ollama, restart: unless-stopped, volumes: [ollama:/root/.ollama] }
```

### 7.2 First-run setup (one command)

A `setup` entrypoint that is safe to re-run:

1. Create the data dir; enable **WAL** (v0.5 §5.2).
2. Run **Prisma migrations**.
3. **Seed** the `Exercise` library and the `Ingredient`→aisle map (required for training generation and grocery categorization; your real *profile* comes from onboarding, not the seed).
4. Mint a **per-device bearer token** (v0.5 §7.1) and render it as a **pairing QR** — printed to the logs and served at `GET /pair` on the tailnet — so setup on the phone is "scan," not "type a 40-char token." *(→ Resolved in v0.7 (R22): `/pair` is **not** unauthenticated — `setup` opens a time-boxed pairing window and prints a short-lived PIN; the QR carries base URL + PIN, the token is issued only when PIN + open window match, and `/pair` returns 403 otherwise.)*
5. Scaffold `.env` if absent.

### 7.3 Config, data, updates

- **`.env`** (never in git; restore from a password manager): `ANTHROPIC_API_KEY`, `SPOONACULAR_API_KEY`, `DB_PATH`, `BACKUP_DIR`, `LLM_MONTHLY_CEILING`, `LOCAL_MODEL_ENDPOINT`.
- **Data & backups** live in the bind-mounted `~/Documents/Intella` so `docker compose down` never loses anything; the nightly `VACUUM INTO` snapshot job (v0.5 §5) writes to `/backups`.
- **Updates:** `docker compose pull && docker compose up -d` — the pre-migrate backup hook (v0.5 §6.1) takes a snapshot first.
- **Always-on:** `restart: unless-stopped` covers reboots on an always-on desktop. If you ever run without Docker, the equivalents are launchd (Mac), a systemd unit (Linux), or NSSM/Task Scheduler (Windows).
- **Native-Node fallback** (dev, or no-Docker): the README's `pnpm install && pnpm dev`, or a built `node dist/server.js`. A single packaged binary (Bun/`pkg`) is possible later, but Docker is the recommended distributable.

### 7.4 Networking — Tailscale (with HTTPS)

Install Tailscale on the desktop and iPhone in the same tailnet, enable **MagicDNS**, and turn on **device approval** (v0.5 §7.2) so nothing joins silently. Then prefer **`tailscale serve`** to front the API with a real HTTPS certificate at a stable name (`https://<machine>.<tailnet>.ts.net`). This matters for iOS: **App Transport Security** wants HTTPS, and Tailscale Serve gives it to you on the tailnet without a plaintext-HTTP exception. No port-forwarding, nothing public.

---

## 8. Deployment — the iOS & Watch app

### 8.1 Getting it on the device (TestFlight)

Your confirmed path, matching v0.5 §8: enroll in the **paid Apple Developer Program** ($99/yr — required for stable 1-year signing and the HealthKit-background / Live-Activity entitlements the ambient layer needs), build in Xcode, upload to **App Store Connect**, add yourself as an **internal tester**, install via the **TestFlight** app. Internal testing needs **no Beta App Review**, and updates arrive over-the-air with no cable and no 7-day expiry.

### 8.2 First-launch pairing

Scan the setup **QR** (base URL + token) *(→ Resolved in v0.7 (R22): the QR now carries base URL + a short-lived PIN, redeemed for the token only inside the open pairing window)* → store both in the **Keychain** → call `GET /system/status` to verify the connection → run onboarding (Profile / Goal / Training / Diet, essentials-only per the locked design) → request **HealthKit** and **notification** permissions (v0.4). A manual "enter URL + token" fallback covers the no-QR case.

### 8.3 Connectivity UX

A persistent, quiet indicator — **"Synced 2m ago" / "Offline — changes saved"** — sets honest expectations, consistent with Intella's freshness-labeling habit. Sync fires on foreground, network-regain, and background refresh; failures never block a screen.

### 8.4 Watch

The Watch app installs alongside the phone app and pairs automatically; scope stays minimal (§4.4): in-workout logging, heart rate, rest timer, one-tap chips.

---

## 9. New-machine / disaster-recovery runbook

Because the nightly snapshot (v0.5 §5) carries all history *and* the learned estimator parameters, recovering the whole system is essentially **restore + re-pair**:

1. Install Docker + Tailscale on the new machine; authenticate Tailscale and approve the device (v0.5 §7.2).
2. Drop the latest `intella-YYYY-MM-DD.db` snapshot into `~/Documents/Intella/`.
3. Restore `.env` / secrets from your password manager.
4. `docker compose up -d` → the API is back at the same tailnet name.
5. Mint a fresh token, re-pair the phone via a new QR, and revoke the old device token (defense in depth if the old machine is gone).

Keep this as a written checklist alongside the v0.5 §5 restore steps — recovery should be a procedure, not a memory test.

---

## 10. Still to flesh out — the register

What remains genuinely open versus already-settled, so nothing is silently assumed. Items marked *Handled* need no further decision; they're listed so you can see they're covered.

| Item | Status | Recommendation / next step |
|---|---|---|
| Offline **conflict/merge** rule | **Handled — v0.5 §11** | Reused as the §5 wire protocol |
| **iOS distribution** mechanism | **Handled — v0.5 §8 + your choice** | Detailed as §8 flow |
| **Backups / restore / encryption** | **Handled — v0.5 §5** | Runbook §9 |
| **Cost / degraded modes** | **Handled — v0.5 §2–3** | Residency respects it (device shows last-known) |
| **On-device store tech** (GRDB vs SwiftData) | **Open** *(→ v0.7: still an open device call, not resolved)* | GRDB recommended; decide before Phase 6 |
| **Sync wire protocol + sync columns** | **New — this doc** *(→ Resolved in v0.7 (R2): cursor = one append-only `ChangeLog`, PK is `serverSeq`)* | Columns in Phase 0 (§6); endpoints into `openapi.yaml` |
| **Notifications infra** (local vs APNs push) | **Open** *(→ v0.7: still an open device call)* | Local notifications first (no server-push infra); add APNs only when the server must *initiate* a push — needs an APNs auth key + outbound reachability. Revisit at the v0.4 / Phase-12 era |
| **Timezone / "today"** across watch·phone·server | **Open (thin)** *(→ Resolved in v0.7 (R1): `Profile.timezone` IANA, UTC storage, local-day boundary; moved to Phase 0)* | Server stores UTC; day-boundaries computed in the profile's IANA timezone (add `timezone` to Profile); events tagged with capture tz. Specify Phase 0–1 |
| **Units** (kg/lb, metric/imperial) | **Partial — schema is metric** *(→ Resolved in v0.7 (R6): canonical-metric storage + `Profile.unitSystem` display pref)* | Store canonical metric; add a `unitSystem` display pref; convert at the UI and in LLM prompts. Specify Phase 1 |
| **Watch app surface** scope | **Open** | Minimal in-workout set (§4.4); finalize at Phase 6+ |
| **Media/blob caching** | **Open (thin)** | Provider URLs + size-capped on-device image cache; never in DB/sync (§4.3) |
| **Health-sync scope** (which HealthKit types, derived-only) | **Partial — v0.4 table + v0.5 §5.4** | Confirm the exact type list and that only derived events ship; before Phase 12 |
| **Seed data** (exercise lib, ingredient→aisle) + your real profile | **Open** | Ship a seed set in `setup`; profile via onboarding (your real numbers still pending per project notes) |

---

## 11. Consolidated deltas (coding-agent-ready)

**Schema (`schema.prisma`, Phase 0):** add the §6 sync columns; add a monotonic `serverSeq` mechanism (`ChangeLog` table or per-row column); add `Profile.timezone` and a `unitSystem` display pref.

**API (`openapi.yaml`):** `POST /sync/push`, `GET /sync/pull?since=`, `GET /pair` (QR/token bootstrap), and extend `GET /system/status` with `lastSyncAt`. All bearer-authed, consistent with the v0.2 surface. (Complements v0.5 §13, which added auth/system/ops/backup/safety routes but not `/sync/*`.)

**Modules:** a server-side **`sync/`** module (push apply + precedence + pull cursor + tombstone purge); on iOS, a **sync engine over GRDB** (outbox + watermark). Both sit on the scheduler/networking already present.

**Setup:** a `setup` entrypoint (migrate + seed + mint token + render QR) and the `compose.yaml` bundle.

### New tickets (v0.2 AC style)

- **T0.11 — Sync metadata in the schema.** Add `updatedAt`/`version`/`deletedAt`/`clientId` per §6 and a monotonic `serverSeq`; regenerate OpenAPI + clients. *AC:* every syncable entity carries its columns; any write advances `serverSeq`; `clientId` is unique on event tables.
- **T0.12 — Dockerized deployment + first-run setup.** `compose.yaml`; `setup` entrypoint (WAL, migrate, seed, mint token, render pairing QR); bind-mounted data/backups; `restart: unless-stopped`. *AC:* `docker compose up` on a clean machine yields a reachable, seeded API and a scannable pairing QR; data survives `down`/`up`.
- **T0.13 — Tailscale Serve HTTPS.** Document + optional serve config for TLS at the tailnet name. *AC:* API reachable at `https://…ts.net`; iOS connects with no ATS exception.
- **T6.x — Sync endpoints + engine.** `/sync/push` (precedence apply, idempotent by `clientId`) and `/sync/pull` (cursor + tombstones); iOS GRDB store + outbox + watermark. *AC:* airplane-mode writes replay exactly once on reconnect; pull applies a server-side delete; a mutable-row conflict resolves by §11.
- **T6.y — iOS pairing + offline UX.** QR pairing → Keychain; last-synced indicator; foreground/network/background sync triggers. *AC:* pair via QR; the app is fully usable in airplane mode for logging and check-off; it reconciles on reconnect.
- **T6.z — Watch relay.** Watch store + `WatchConnectivity` transfer into the phone outbox. *AC:* a set logged on the Watch offline reaches the server via the phone, de-duplicated by `clientId`.

These extend v0.5 §16 (which scheduled precedence/idempotency as T13.5); the **schema columns** move to Phase 0 so nothing has to be retrofitted onto live data.

---

## 12. Open decisions (your calls)

None block Phase 0 schema/setup work; each is wanted before its phase.

- **On-device store:** GRDB *(recommended)* vs SwiftData. → Still open in v0.7 (a device call, decide before Phase 6).
- **HTTPS on the tailnet:** Tailscale Serve *(recommended)* vs plain HTTP + an iOS ATS exception.
- **Notifications:** local-notifications-first *(recommended)* vs standing up APNs now. → Still open in v0.7 (a device call, revisit at Phase 12).
- **Timezone / units policy:** confirm UTC-store + local-day (`Profile.timezone`) + canonical-metric with a display `unitSystem`. → Resolved in v0.7 (R1/R6): decided as stated; timezone moved to Phase 0.
- **Health-sync type list:** confirm the exact HealthKit types and derived-only shipping (before Phase 12).
- **On-device retention window:** confirm ~8–12 weeks before eviction to server-only history.

---

*Companion files listed in the header. This document (v0.6) specifies the data-residency split, the offline sync transport, and new-machine deployment — the layer between "a system that works on your desk" and "a system that works in your pocket, on the subway, in a grocery aisle, and on a laptop you haven't bought yet."*
