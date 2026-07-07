# Intella — Phase 1 (Profile & Onboarding) Review

**Version:** 1.0 · **Date:** July 7, 2026 · **Reviewer:** Claude (Opus 4.8) · **Branch:** `Phase1`

> A code review of Phase 1 against Epic 1 (`Intella_Epics_and_Stories.md`, tickets **T1.1–T1.3**), the Global Build Context, the sources of truth (`schema.prisma`, `openapi.yaml`), and the in-force resolutions (**R1, R4, R6, R7, R9, R14, R23**). It records the verdict, a per-ticket scorecard, every finding with severity and a recommended action, what was done well, and the items to carry into later phases. Unlike the Phase 0 review, the findings here are **not yet fixed** — this document is the input to that decision. Where this review and the source files disagree, the files + code win and this doc should be corrected.

---

## 1. Verdict

**Phase 1 is complete to a high standard and unlocks Phase 2.** All four profile endpoints plus the encrypted API-key store are Zod-validated and round-trip through the generated OpenAPI client; the 5-step onboarding flow writes `Profile`, `Goal`, `TrainingProfile`, and `DietProfile`, resumes from saved values, skips optional fields cleanly, and hands off to the "generating your first plan" state; Settings edits every onboarding field with allergies/injuries flagged as hard constraints and provider keys stored encrypted and shown only masked. Every resolution the epic names (R1/R4/R6/R7/R9/R14/R23) is implemented, and the OpenAPI-first / metric-canonical / never-persist-invalid disciplines from the Global Build Context are honoured. This is the same well-engineered, heavily-commented quality as Phase 0.

The review found **one item that is actually broken** — `pnpm lint` fails — and **one design item that came due from Phase 0 and was not addressed**: the `GET /profile` read-side-effect (Phase 0 §5.2, explicitly slated for "revisit in Phase 1"), which on closer inspection **defeats the R1 browser-timezone default on the fresh-onboarding path**. Neither blocks Phase 2. The remaining findings are low-severity or forward-looking. A short punch-list (§7) closes the gaps; items 1–3 are quick and best done while the context is fresh.

---

## 2. Verification evidence

| Check | Result |
|---|---|
| `pnpm test` | **94/94 pass** — 84 API across 14 suites + 10 shared `units` tests |
| `pnpm typecheck` | clean (shared → scripts → eval → api → web) |
| `pnpm lint` | **FAILS** — 2333 errors, **all** in `apps/web/.vite/deps/**` (Vite's pre-bundled dep cache); **0 in real source** (source lints clean once `.vite` is ignored) — see §4.1 |
| `pnpm openapi:generate` → git diff | **no drift** — the generated TS client regenerates identically; `422` documented on every PUT via `components.responses.ValidationError` |
| Generated client wiring | `api-client.ts` drives `/profile`, `/diet-profile`, `/training-profile`, `/goals`, `/settings/api-keys`; tests exercise the **generated** client against **real** routes in-process (`app.inject`) |
| Secrets / caches committed | none — `.vite/` gitignored (0 tracked); `ProviderCredential.ciphertext` is asserted never to appear in a response body |

---

## 3. Ticket scorecard (T1.1–T1.3)

| Ticket | Status | Notes |
|---|---|---|
| **T1.1** Profile/diet/training/goal endpoints | ✅ | CRUD with Zod at the edge (`safeParse` → 422 `validation_error`); `.strict()` schemas reject unknown fields; engine-computed `kcal`/`macros` rejected as client input (tested); diet/training 404 before first write; goal PUT is an upsert that 404s an unknown id; multi-goal ordered by `priority` (R14). Version-bump + `serverSeq` are applied centrally by the ChangeLog extension for all four syncable models, and correctly **not** applied to `ProviderCredential`. |
| **T1.2** Onboarding flow (web) | ✅ | Five steps (Physiology → Goals → Training → Nutrition → Review) into a first-plan hand-off; structured goal builder (kind/value/unit + note + priority); activity level; optional baseline lifts; unit-system pick; resume-from-saved; per-step persistence with server goal-id capture + a full re-save safety net on generate. ⚠️ timezone default regression, §4.2. |
| **T1.3** Settings edit + API keys | ✅ | Every onboarding field editable; allergies/injuries carry a rose "Hard limit" badge + explicit "the coach can never override" copy; provider keys AES-256-GCM encrypted at rest, returned only masked (`set` + last-4), entered via `type=password`, cleared from state after save; `readProviderKey` decrypts server-side only (never over HTTP). |

### Acceptance-criteria mapping (epic one-shot checklist)

- ✅ Four profile endpoints validate (Zod) and round-trip; 422 on bad input — `profile/diet-profile/training-profile/goals.test.ts`.
- ✅ 5-step onboarding writes all four records; structured goal + priority; activity level; optional baseline lifts; timezone + unit system — `OnboardingWizard.tsx` (⚠️ timezone value defaults to `UTC`, not device — §4.2).
- ✅ Units display per `unitSystem` but persist metric — `units.ts` + `units.test.ts` ("stores metric no matter which display unit was typed"); UI boundary in `measurement-inputs.tsx`.
- ✅ Settings edits every field; allergies/injuries flagged hard; API keys masked — `SettingsScreen.tsx`, `settings.test.ts` ("never returns the plaintext key in any response body").
- ✅ Onboarding ends in the first-plan hand-off — `first-plan.ts` + `TodayScreen`.

---

## 4. Findings

### 4.1 `pnpm lint` is broken — ESLint lints Vite's `.vite/deps` cache *(medium — trivial fix)*

**Finding.** `eslint.config.js` ignores `**/dist/**`, `**/coverage/**`, `**/node_modules/**`, `prisma/migrations/**` — but **not `.vite`**. Once the web app has been run or built, `apps/web/.vite/deps/*` (Vite's pre-bundled vendor cache: `react-dom`, `tailwind-merge`, `@tanstack/*`, …) exists, and ESLint reports 2333 errors against that machine-generated code. Every error is in `.vite/deps`; **source lints clean** (`eslint . --ignore-pattern "**/.vite/**"` is silent). The cache is gitignored so it never lands in a commit, but a CI lint gate — recommended in Phase 0 §5.3 — would fail on any dev machine that has run the web app. Phase 0 reported lint clean because `.vite` did not exist yet.

**Recommended action.** Add `"**/.vite/**"` to the `ignores` list (and, defensively, `"**/.vitest/**"` and `"packages/*/src/generated/**"` so the generated OpenAPI client is never linted). Then the lint gate is green and safe to wire into CI.

### 4.2 `GET /profile` still auto-creates — and it defeats the R1 browser-timezone default *(medium)*

**Finding.** Phase 0 §5.2 flagged that `getProfile` mutates on a read (auto-creates an empty `Profile`, advancing `serverSeq`) and said *"revisit in Phase 1 … consider returning an unpersisted default until the first `PUT`."* It was not changed — `apps/api/src/profile.ts` still does `prisma.profile.create({ data: {} })` when none exists. Tracing the consequence through onboarding:

1. A fresh visit to `/onboarding` calls `getProfile()`, which persists a `Profile` with the schema default `timezone: "UTC"` (`schema.prisma`).
2. `loadPhysiology` (`apps/web/src/lib/profile-forms.ts`) computes `timezone: profile.timezone || base.timezone`, where `base.timezone = browserTimezone()`. Because `"UTC"` is truthy, the browser zone is **never** used.
3. The branch that *would* apply the device zone (`if (!profile) return base`) is unreachable, because `getProfile` guarantees a profile always exists.

So a new user in, say, `America/New_York` who accepts the defaults persists `timezone: "UTC"` — silently breaking the `[local-midnight, next local-midnight)` "today" boundary that R1 exists to define (today's session/meals, the nightly estimator, day-boundary adherence), until they manually correct it in Settings. R1's acceptance criterion is "capture the timezone at onboarding, **defaulted from the device**"; on the default path it is not. Secondary effect: because `/profile` can never return "not created," the app has no clean "has the user onboarded?" signal and no onboarding gate/redirect.

**Recommended action.** Implement the §5.2 recommendation now (Phase 1 is the first real writer, and Phase 2 multiplies profile readers): make `GET /profile` return an **unpersisted default** (or a 404-style "not created") so the client's device timezone flows through the first `PUT`. This restores the R1 default and yields a real onboarding signal. If auto-create is kept for any reason, at minimum have onboarding treat a never-saved profile as blank so `browserTimezone()` wins.

### 4.3 `macros` JSON shape disagrees between the schema comment and Zod/OpenAPI *(low — latent, bites Phase 3)*

**Finding.** `schema.prisma` documents `DietProfile.macros` as `Json { proteinG, carbsG, fatG }` (no `kcal`), but the shared `macrosSchema` (`apps/api/src/schemas.ts`) and the OpenAPI `Macros` component require `kcal` as well, and `DietProfile` also carries a separate top-level `kcal` column. Harmless in Phase 1 (both are engine-computed and always null), but when the Phase 3 nutrition engine writes `macros`: following the prisma comment (`{proteinG,carbsG,fatG}`) makes `parseTypedObject(row.macros, macrosSchema)` fail validation and **silently drop the blob to null** on read (the forgiving JSON-field parser degrades rather than throws); following the Zod shape duplicates per-day `kcal` across the column and the blob.

**Recommended action.** Reconcile the shape before Phase 3 writes it — decide whether per-day `kcal` lives in the `kcal` column, inside `macros`, or both, and align the `schema.prisma` comment, `macrosSchema`, and the OpenAPI `Macros` component to match. (Note `Recipe.macrosPerServ` deliberately includes `kcal`; that's a separate, consistent shape.)

### 4.4 No web / UI tests *(low — acceptable for a prototype, but onboarding is the most stateful surface)*

**Finding.** `apps/web` has zero test files. The R6 conversion is exhaustively unit-tested at the pure-function level (`units.test.ts`), but the actual imperial↔metric boundary the user touches (`measurement-inputs.tsx`) is untested, and two T1.2 acceptance criteria — "resuming shows saved values" and "skipping optional fields still completes" — have no automated evidence. The forgiving `buildTrainingInput` logic that drops half-filled injury/baseline rows (so a touched-but-empty optional never 422s) is exactly the kind of thing a regression test should pin.

**Recommended action.** Add a small set of component/integration tests for the measurement inputs and the onboarding resume/skip paths. Not a Phase 1 blocker, but cheap insurance before Phase 2+ refactors move this code.

### 4.5 Settings and onboarding manage only the first goal *(low)*

**Finding.** The API and tests fully support multiple prioritized goals (R14 — `goals.test.ts` proves priority ordering and `listGoals` returns all), but the UI only ever edits `goals[0]` (`GoalSettings`, `OnboardingWizard`); there is no affordance to add, list, or retire a second goal. Consistent with onboarding capturing one primary goal, and multi-goal conflict resolution formally lands with Phase 8 horizon planning — noted so the gap is deliberate, not forgotten.

### 4.6 Nits *(very low)*

- **Singleton race / no uniqueness.** Each `put*` helper does read-then-(create-or-update) as two operations, and `Profile`/`DietProfile`/`TrainingProfile` have no unique constraint; two concurrent creates could duplicate, after which `findFirst`-oldest silently hides the newer row. Negligible for one user over Tailscale, but a fixed singleton id or `@@unique` would make it robust.
- **PUT semantics differ by resource.** Diet is partial-merge (only provided keys written); goal is full-replace (unset optionals → null); profile writes required scalars every time and merges the optional ones. Each is documented, but the divergence is worth being deliberate about as write sites grow.
- **`last4 = value.slice(-4)`** on a 1–3-character key (schema min length 1) would expose the whole key as the "mask." Real provider keys are long; cosmetic.
- **Imperial input granularity.** Display rounds to 0.1 (lb / inch), so finer values can't be entered in imperial. Fine for the domain.

---

## 5. What was done well (keep as the pattern)

- **OpenAPI-first is real, not aspirational.** Regenerating the client produces zero diff, and tests drive the *generated* client through *real* routes via `app.inject` — server, contract, and client cannot silently diverge.
- **R6 metric invariant done right.** Drafts hold metric-canonical values as strings; the unit pick only changes rendering; exact conversion constants (`0.45359237`, `2.54`); round-trip and "stores metric regardless of typed unit" tests. The one place the invariant lives is isolated and pure.
- **Safety posture is visible, not just enforced.** Injuries and allergies carry a rose "Hard limit" badge and "the coach can never override" copy wherever they're edited, and allergens render as red chips — the hard-constraint posture is legible to the user, which is the point of R23.
- **Secrets handled correctly.** AES-256-GCM (`iv || tag || ciphertext`, auth tag for tamper detection), decrypt-for-server-use only, inputs cleared after save, and a test asserts the raw response body never contains the plaintext.
- **Uniform cross-cutting writes.** Zod-at-the-edge is identical across every PUT, and version-bump/`serverSeq` is centralized in the ChangeLog extension rather than duplicated per endpoint — the Phase 0 forward-note about a uniform validated write path is substantially satisfied.
- **Honest degraded reads.** The forgiving JSON-field parsers degrade a corrupt column to a safe fallback instead of throwing, matching the "never hard-stop" posture; the write path (Zod) is what guarantees only well-formed values are persisted.

---

## 6. Forward-looking notes for later phases

- **Phase 2** — resolve the Phase 0 §5.1 ChangeLog nested-write constraint before the training generator's first multi-row atomic write (write syncable children as top-level ops, or extend the interceptor). This is also where `constraintsHash`/`hashVersion` (R20b) and the LLM gateway get exercised for real, and where `readProviderKey` (already built here) first decrypts the Anthropic key.
- **Phase 3** — reconcile the `macros` shape (§4.3) before the nutrition engine writes `DietProfile.macros`/`kcal`; `readProviderKey("spoonacular")` comes online.
- **Phase 5 / CI** — once §4.1 is fixed, the three gates (`typecheck`/`lint`/`test`) are all green and the Phase 0 §5.3 CI workflow can be committed (tests build their own DB by replaying committed migrations, so CI needs only install + generate + the gates).

---

## 7. Recommended punch-list before Phase 2

1. **Fix lint (§4.1).** Add `.vite` (and `generated`) to the ESLint `ignores`; confirm `pnpm lint` is green; then the CI gate is safe to add. *(~2 min)*
2. **Fix the profile read side-effect + timezone default (§4.2).** Stop `GET /profile` auto-creating; let the device timezone flow through the first `PUT`. *(small)*
3. **Reconcile the `macros` shape (§4.3)** and leave a note for Phase 3. *(~2 min)*
4. *(Optional)* Add a couple of onboarding/measurement-input tests to lock the T1.2 resume/skip and R6-at-the-UI criteria (§4.4).

None are blockers — Phase 1 genuinely achieves its objective. Items 1–3 are quick and worth doing now.

---

*Companion to `Intella_Product_and_Build_Plan.md`, `Intella_Epics_and_Stories.md` (Epic 1), and `Intella_Phase0_Review.md`. Where this review and those files disagree, the source files + code win and this doc should be corrected.*
