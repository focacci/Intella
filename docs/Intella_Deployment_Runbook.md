# Intella — Deployment & Pairing Runbook

*How to stand Intella up on a fresh machine, reach it privately from your iPhone over Tailscale, and pair a device by scanning a QR. Covers tickets **T0.12** (Dockerized deployment + first-run setup), **T0.6** (remote access over Tailscale), and **T0.13** (Tailscale Serve HTTPS). Companion to `Intella_Data_Residency_and_Deployment.md` §7.*

---

## 0. What you get

- One `docker compose up` on a clean machine → a reachable, seeded API and a **PIN-gated pairing QR** printed to the logs.
- The API is **never exposed to the public internet** — it binds to host loopback and is reached only over your Tailscale tailnet.
- **HTTPS** at a stable tailnet name (`https://<machine>.<tailnet>.ts.net`) via Tailscale Serve, so the iOS app needs no App Transport Security exception later.
- Data and encrypted backups live in a **bind-mounted host directory**, so `docker compose down` never loses anything.

---

## 1. One-time host prerequisites

1. Install **Docker** (Docker Desktop on macOS/Windows, or Docker Engine on Linux).
2. Install **Tailscale** on the desktop **and** the iPhone, and sign both into the **same tailnet**.
3. In the Tailscale admin console, enable **MagicDNS** and turn on **device approval** (so nothing joins the tailnet silently — v0.5 §7.2).

Find your desktop's stable tailnet name (MagicDNS):

```bash
tailscale status            # shows the machine name
tailscale cert --help       # (Serve provisions certs automatically; see §4)
```

Your API will live at `https://<machine>.<tailnet>.ts.net` — e.g. `https://desktop.tail1a2b.ts.net`.

---

## 2. Configure `.env`

```bash
cp .env.example .env
```

Then set, at minimum:

| Variable | Set it to | Why |
|---|---|---|
| `INTELLA_DATA_DIR` | Absolute host path, e.g. `/Users/you/Documents/Intella` | Bind-mounted to `/data`; holds `intella.db` + `/backups`. Survives `down`/`up`. |
| `INTELLA_PUBLIC_BASE_URL` | `https://<machine>.<tailnet>.ts.net` | Embedded in the pairing QR so the phone dials a reachable HTTPS address. |
| `INTELLA_AUTH_TOKEN` | A strong random string | Bootstrap/console token. Device tokens are minted via pairing; this is the break-glass admin token. |
| `ANTHROPIC_API_KEY`, `SPOONACULAR_API_KEY` | Your keys | Not used in Phase 0, but restore them here from your password manager. |
| `INTELLA_BACKUP_OFFSITE` | A synced path (iCloud/Time Machine/external) | Silences the offsite-coverage warning (R21). Optional but recommended. |

> **Compose and `~`:** Docker Compose does **not** expand `~`. Use a fully-qualified absolute path for `INTELLA_DATA_DIR`.

---

## 3. Deploy

```bash
docker compose up          # add -d to detach once you've captured the QR
```

What happens:

1. The **`setup`** service runs once (re-runnable, idempotent): ensures the SQLite file, takes a pre-migrate snapshot, runs `prisma migrate deploy`, seeds the exercise/ingredient libraries + seed plans (enabling **WAL**), then **opens a time-boxed pairing window**, prints a short-lived **PIN**, and renders a **pairing QR** (base URL + PIN) to the logs.
2. The **`api`** service starts only after `setup` exits successfully (`restart: unless-stopped`, so it survives reboots).

Grab the QR/PIN from the setup logs:

```bash
docker compose logs setup
```

**Data survives `down`/`up`** because `intella.db` lives in the bind-mounted `INTELLA_DATA_DIR`, not in the container.

### Pair another device later

The pairing window is **single-use and time-boxed**. To pair another device (or after a window expires), open a fresh one:

```bash
docker compose run --rm setup pnpm setup:pair    # opens a new window, prints a new PIN + QR
```

`GET /pair` returns **403** whenever there is no open, unconsumed window — a trusted tailnet peer can never silently pull a token (R22).

---

## 4. HTTPS over Tailscale Serve (T0.13)

The container publishes **only** to `127.0.0.1:8787`. Put Tailscale Serve in front of it to get a real HTTPS certificate at your tailnet name — run this **on the host**:

```bash
# Proxy tailnet HTTPS (443) → the loopback-published API. Persistent across reboots.
tailscale serve --bg --https=443 http://127.0.0.1:8787
tailscale serve status        # confirm: https://<machine>.<tailnet>.ts.net → 127.0.0.1:8787
```

Now the API answers at `https://<machine>.<tailnet>.ts.net` with a valid cert. Because that is the same value you put in `INTELLA_PUBLIC_BASE_URL`, the pairing QR already points at it.

> **Do not** use `tailscale funnel` — that would expose the API to the public internet. Serve keeps it inside the tailnet.

To stop serving: `tailscale serve --https=443 off`.

---

## 5. Remote access from the iPhone (T0.6)

With the desktop and phone on the same tailnet and Serve running:

1. On the iPhone (connected to Tailscale), open Safari to **`https://<machine>.<tailnet>.ts.net/health`**.
2. Unauthenticated, `/health` returns **401** (proof the endpoint is reachable and auth is enforced). With a valid bearer token it returns **200** — the native app supplies its paired token.

That round-trip is the T0.6 acceptance check: a phone on the tailnet reaches the desktop API over MagicDNS/HTTPS.

If you prefer plain MagicDNS without HTTPS during bring-up, the API is also reachable at `http://<machine>.<tailnet>.ts.net:8787` **only if** you widen the published port from `127.0.0.1:8787` to the tailscale interface — but the recommended, iOS-ready path is Serve + HTTPS above (no ATS exception needed).

---

## 6. New-machine / disaster recovery

Because the nightly encrypted snapshot (T0.7 / R21) carries all history, recovery is essentially **restore + re-pair**:

1. Install Docker + Tailscale on the new machine; authenticate and approve the device.
2. Drop the latest `intella-YYYY-MM-DD.db` snapshot into `INTELLA_DATA_DIR` (restore/decrypt per the backup runbook), or start fresh to re-seed.
3. Restore `.env` / secrets from your password manager.
4. `docker compose up -d` → the API returns at the same tailnet name (re-run `tailscale serve` if needed).
5. `docker compose run --rm setup pnpm setup:pair`, re-pair the phone via the new QR, and **revoke the old device token** (`DELETE /auth/tokens/:id`) as defense in depth.

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `/pair` always 403 | No open window (expired or consumed). Re-run `docker compose run --rm setup pnpm setup:pair`. |
| QR points at `http://localhost:8787` | `INTELLA_PUBLIC_BASE_URL` is unset. Set it to your tailnet HTTPS name and re-run setup. |
| Phone can't reach the API | Confirm both devices are on the tailnet (`tailscale status`), MagicDNS is on, and `tailscale serve status` shows the proxy. |
| Data lost after `down` | `INTELLA_DATA_DIR` wasn't an absolute host path, so the DB stayed in the container. Fix the path; restore from a snapshot. |
| `setup` warns about backups | Provision a keystore-backed `INTELLA_BACKUP_KEY` and set `INTELLA_BACKUP_OFFSITE` (R21). |

---

*This runbook is the operational companion to `Intella_Data_Residency_and_Deployment.md` §7–§9. Keep it current as deployment evolves.*
