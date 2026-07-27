You are building Intella — a single-user, self-hosted, adaptive training + meal-planning + grocery app. The full plan lives in this repo.

Before writing any code, read, in order:
1. The "Global Build Context (read once, prepend to every epic)" section of Intella_Epics_and_Stories.md — the non-negotiable posture, stack, repo layout, generator pattern, and coding conventions. Follow it exactly.
2. The epic named in the step below (in the same file) — the phase you're building.
3. The current schema.prisma and openapi.yaml — the sources of truth. Where the epic and these files disagree, the files win.
4. Any R-numbers the step cites, in Intella_Preflight_Resolutions.md.

Then build ONLY the tickets listed in the step — do not run ahead into later tickets or phases. Honour every Global Build Context rule, especially: OpenAPI-first (define the route, regenerate the client, then implement); Prisma Migrate with committed migrations (never db push on real data); pure engine logic exhaustively unit-tested; never persist invalid LLM output and never hard-stop; allergies and injuries are hard constraints the model can never override; storage is metric-canonical.

**Build order is web-first (supersedes strict numeric phase order).** Phase numbers stay as stable identifiers, but the build *sequence* is: web track first — Phases 0 → 1 → 2 → 3 → 4 → 5 → 7 → 8 → 9 → 10 → 11 (all browser-based, no Apple Developer license, testable from the iPhone browser over Tailscale), then the deferred native track — Phase 6 (SwiftUI/Watch app + offline sync + TestFlight), then 12 → 13 → 14 → 15 → 16 (all HealthKit/CoreMotion sensor capture). Do NOT build any native/HealthKit phase (6, or 12–16) until the web track is complete. Full rationale under "Revised build order" in Intella_Epics_and_Stories.md.

Work in the repo, commit in logical units, and write the tests each ticket's acceptance criteria imply. When done, give me a short summary: what you built, what you tested, which acceptance criteria pass, and any deviations or open questions. If a decision is genuinely ambiguous, pick a sensible default, flag it, and continue.
