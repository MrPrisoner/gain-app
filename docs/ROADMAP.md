# GAIN — Roadmap

What is left to build, in the order it should be built, decomposed small enough that one
agent can own one item and "done" is a passing test rather than a judgement call.

**This file tracks execution. [`ARCHITECTURE.md`](./ARCHITECTURE.md) §12 holds the phase
map and the reasoning behind the order; it changes rarely, this file changes constantly.**
Where the two disagree about what is built, this file is wrong and should be corrected —
§12's table is the contract.

Three files, three jobs:

| File | Job |
|---|---|
| `docs/ARCHITECTURE.md` §12 | The phase map. Why each phase exists and what proves it done |
| `docs/ROADMAP.md` | This file. The remaining work, item by item, with acceptance criteria |
| `todo.md` | Inbox for findings from manual testing. Triaged, not accumulated |

**The triage rule:** anything in `todo.md` bigger than a single commit moves here, into the
phase it belongs to. Anything smaller gets done and deleted. A design decision that comes
out of a to-do item belongs in `CLAUDE.md` under Invariants, not in either list — that is
where the `weight_kg` ruling went, and it is why it survived.

**Closing an item** means ticking it and appending the commit SHA, the same convention the
build has used so far. Closing a *phase* means updating three places together: §12's status
line, the README status banner, and CLAUDE.md's "Current state" paragraph.

---

## Status

Phases 1–7 are done: the pure round-trip core, the per-user storage layer, the web app with
OIDC and first run, the session runner, the export UI, the offline PWA, and progress, history
& the Home screen. A full session of the fixture plan can be started, logged and finished with
no connection at all — including across a full browser kill, not just a reload — and syncs
cleanly once reconnected, and `e2e/session-runner-walkthrough-a.spec.ts`, `-d.spec.ts`,
`e2e/export-walkthrough.spec.ts` and `e2e/offline-*.spec.ts` prove it.
Double-progression state, per-exercise and per-session-type charts, metric trends and the
reverse-chronological History all render from real logged sets, and
`e2e/progress-walkthrough.spec.ts` and `e2e/history-walkthrough.spec.ts` walk both end to end.

Phase 9 is also done, built out of order ahead of phase 8: an operator gated on
`OIDC_ADMIN_GROUP` sees every registered user with per-user counts and can reset one to a
clean slate, with no code path in the app able to read another user's training content.
`e2e/admin-walkthrough.spec.ts` proves the cross-user read and the reset both actually
happen, not just that the screen renders.

**Phase 8 is next.**

| Phase | Deliverable | State |
|---|---|---|
| 1 | Contract schema, parser, diff engine, export generator, both prompt templates | Done |
| 2 | SQLite layer, per-user provisioning, migrations, import writer and review | Done |
| 3 | OIDC auth and group gate, container, AGPL §13 source link, first run | Done |
| 4 | Session runner UI, online only | Done |
| 5 | Export UI — the loop's return crossing | Done |
| 6 | Offline PWA: IndexedDB, sync queue, idempotency | Done |
| 7 | Progress, history & the Home screen | Done |
| 8 | Revision diff review, template editor | Not started |
| 9 | Operations — operator view, per-user reset | Done |

---

## Phase 5 — Export

**Why it moved.** This was the tail of the old phase 7. It is pulled forward because
`generateExport` is finished, tested and *unreachable from the app*: a user can import a
plan, log an entire block, and have no way to get any of it back out. The loop is open at
its return crossing, and every week spent on offline sync or charts is a week of data that
cannot leave. It is also the smallest phase in the list — the generator exists, this is a
route, a window picker and a copy button.

**Done when:** a logged block leaves GAIN as one pasteable document, in one tap, and
`extractPlanSourceFromBundle` recovers Section 1 from what the UI actually produced.

Already in place: `generateExport`, `filterLogsToWindow`, `renderRawLogs`, `weeksElapsed`
and `buildProgressSummary` in `src/lib/export/`, all unit-tested, plus the golden
round-trip test. Nothing pure needs writing.

- [x] **A read path from `gain.db` to `Logs`.** The export generator consumes the plain-data
      `Logs` shape from `src/lib/logs/types.ts`; the database has the rows. One query module,
      windowed at the SQL level or in memory — either is fine at this size, but it must key
      metric values on `(scope, key)`, never the bare key. `src/lib/db/logs.ts` (`9f93e9c`).
      The window picker's own options are pure and separate: `src/lib/export/windows.ts`
      derives the default and mid windows from the plan's own `block_length_weeks` rather
      than a constant, and drops the mid option entirely when the plan declares none
      (`6efd06b`).
- [x] **The export route.** Window picker (since the current version / two of the plan's own
      blocks back / full history — see above), generate, and a preview of what will be
      copied. `src/routes/plan/[slug]/export/+page.server.ts` and `bundle-for-plan.ts`
      (`8863994`), `+page.svelte` (`21c1012`).
- [x] **Copy with download fallback**, the same pattern as the bootstrap prompt on the home
      screen — `copyText` then `downloadText`. Paste is the primary transport (§1); the file
      is the convenience. (`21c1012`)
- [x] **The template substitutions are real.** `{{plan_name}}`, `{{plan_version}}`,
      `{{export_window}}`, `{{today}}`, `{{workouts_logged}}`, `{{weeks_elapsed}}` — an
      unknown token is left as literal text, never blanked (§11). Exercised by
      `tests/server/export-route.test.ts` and `e2e/export-walkthrough.spec.ts` (`8863994`,
      `0e235bf`).
- [x] **An e2e walkthrough**: seed a plan, log a session, export, assert Section 1 is
      byte-identical to the imported document and that the summary reflects what was logged.
      `e2e/export-walkthrough.spec.ts` (`0e235bf`).

**Watch for:** the progress summary is arithmetic the reviewing AI will trust and not check
(CLAUDE.md, Invariants). Load is per set, "first" and "latest" are chronological, and every
free-text value gets its `|` escaped or it eats the rest of the Markdown row.

---

## Phase 6 — Offline PWA

**Done when:** an airplane-mode session syncs cleanly on reconnect, the property tests pass,
and a workout survives a full browser kill.

Already in place, and worth knowing before starting: every table the client writes to
(`workout`, `set_log`, `metric_value`, `deviation`, `activity`) already carries
`client_id TEXT UNIQUE`, and `src/lib/db/workout.ts` was written to behave as a replay
target. `src/lib/server/gate.ts` already answers non-navigation requests with 401 rather
than a 303, so an expired session cannot turn a queued POST into a body-discarding GET. The
server half of idempotency is largely done; this phase is the client.

- [x] **Service worker + app-shell precache.** `src/service-worker.ts` precaches the app
      shell and `/offline`, is version-keyed, and serves a `network-first` strategy with an
      `/offline` fallback on a navigation miss; `src/lib/sync/precache.ts` asks it to cache
      each plan's session data on the Home screen. `static/site.webmanifest` gained `id`,
      `start_url`, `scope` and a maskable icon (`983ec12`).
- [x] **IndexedDB as the workout store.** The runner's `client_id` moved from
      `sessionStorage` to `localStorage` plus an IndexedDB outbox
      (`src/lib/sync/idb.ts`), and `+page.server.ts`'s write actions were deleted in favour
      of writing through that outbox directly (`9ee0d34`, `8f66333`).
- [x] **The sync queue**: append-only per workout, client-generated ULIDs, batched and
      replayed through `POST /api/sync` on reconnect. Last-write-wins on the workout
      record, union on set logs (§9). `src/lib/sync/{ops,queue,history}.ts` (`8218b77`,
      `a1acd1c`, `2ee2e83`), `src/lib/sync/replay.ts` and `src/routes/api/sync/+server.ts`
      (`d906c07`).
- [x] **A 401 never discards queued data.** `client.svelte.ts`'s flush loop enters a
      `needs-auth` state that holds the queue and recovers automatically once
      re-authenticated, rather than sticking forever (`9ee0d34`, fixed in `58121b4`).
- [x] **Property tests on replay** (§12): fast-check properties over arbitrary op subsets
      and orderings, asserting no duplicate sets and no data loss.
      `tests/sync/replay.property.test.ts` (`c955238`).
- [x] **The explicit survival test**: connection loss and a full browser kill — proving
      IndexedDB, not `sessionStorage`, is what survives — plus a `visibilitychange`-driven
      flush as the phone-lock proxy. `e2e/offline-*.spec.ts` (`144478a`). Container restart
      is a documented manual check (`todo.md`) rather than an automated one — the harness
      cannot kill the client and server processes independently of each other.

---

## Phase 7 — Progress, history & the Home screen

**Why it widened.** The old phase 6 was charts only, which left three obligations from §9
owned by no phase at all: the suggested next session, one-tap activity logging, and the
next-morning metric prompt. All three live on the Home screen, none of them need offline,
and each is currently a promise the app does not keep. They are folded in here.

**Done when:** double-progression state matches hand-calculated expectations, and the Home
screen suggests the right next session for the fixture plan's `scheduling.sequence`.

- [x] **Double-progression state as one pure module.** "12/11/11 — one session from a load
      increase" does not exist anywhere yet. Build it once and have *both* the charts and
      `src/lib/export/summary.ts` consume it. Two implementations of this arithmetic is
      exactly the silent-wrong-number failure the export invariant warns about.
      `src/lib/progress/double-progression.ts` (`848c3e1`), consumed by
      `src/lib/export/summary.ts` (`b9341c6`) and the exercises list/detail routes
      (`261fea3`, `9569f1a`).
- [x] **Per-exercise progress**: load × reps over time, estimated volume, difficulty
      distribution. `src/lib/progress/exercise-series.ts` (`928bf74`),
      `src/routes/plan/[slug]/progress/exercises/` — list (`261fea3`) and detail
      (`9569f1a`).
- [x] **Per-session-type**: duration, completion rate, deviation count.
      `src/lib/progress/session-stats.ts` (`6545edf`),
      `src/routes/plan/[slug]/progress/+page.server.ts` (`04b244e`).
- [x] **Metric trends.** Any numeric plan-declared metric is chartable, keyed on
      `(scope, key)` — a plan may legally declare `rpe` at both set and session scope, and
      keying on the bare key merges two unrelated series into a plausible wrong number.
      `src/lib/progress/metric-series.ts` (`32f62c5`),
      `src/routes/plan/[slug]/progress/metrics/` — list (`7e3852f`) and detail
      (`21a6073`).
- [x] **History**: reverse-chronological workout list, drilling into full set detail and the
      plan version it ran under. `src/lib/db/history.ts` (`9c2c386`),
      `src/routes/plan/[slug]/history/` — list (`3dbfc4f`, fix `308a6e9`) and detail
      (`633538c`).
- [x] **Home: the suggested next session**, from `scheduling.sequence`, with any session
      selectable as an override. `src/lib/home/next-session.ts`, `src/routes/+page.server.ts`
      (`b7a419b`, `6eb0487`).
- [x] **Home: one-tap activity logging.** `src/lib/db/workout.ts`'s `logActivity`, the
      sync outbox's sixth op kind, `src/routes/ActivityStrip.svelte` and
      `ActivitySheet.svelte` (`b34bbe7`, `1aac26e`).
- [x] **The `next_morning` metric prompt on next app open.**
      `src/lib/home/next-morning.ts`, `src/routes/NextMorningPrompt.svelte` (`c3c3546`, `6b7d6b9`).

**Charts stay simple and read well on a phone.** No dashboard sprawl (§10).

---

## Phase 8 — Revision diff review & templates

**Done when:** a logged block exports, comes back revised from an AI, and the diff is
reviewed and committed. That is the loop closing, and it is the last thing the build owes.

Already in place: the phase-1 diff engine (`src/lib/diff/diff.ts`), and
`prepareImportReview` already returns a real `ContractDiff` for a revision import. The home
screen renders a placeholder saying the detailed review "arrives in a later phase" and
commits as-is. The engine is done; this is the UI on top of it.

- [ ] **The diff review screen**: changed targets, added and removed exercises, added and
      removed metric definitions, in plain language rather than field paths.
- [ ] **Rename mapping.** The hard part, and the one that protects history. An unmatched slug
      is flagged as a possible rename with an offer to map it onto an existing exercise; a
      slug is never silently minted for a name that closely resembles an existing one. If
      `goblet-squat` returns as `goblet_squat`, every chart splits in two, nothing errors,
      and the loss is unrecoverable.
- [ ] **The template editor** for export Section 0. `ai_template` exists and is seeded at
      provisioning; no UI reaches it. Multiple named templates, per §11.

---

## Phase 9 — Operations

Built out of order, ahead of phase 8: the self-hosting operator needed a way to see who
was actually using the alpha and to wipe a test account, and neither depends on the diff
review work above. Phase 8 keeps its place as next.

**Design:** [`docs/superpowers/specs/2026-08-17-admin-section-design.md`](superpowers/specs/2026-08-17-admin-section-design.md).

**Done when:** an operator signed in as a member of `OIDC_ADMIN_GROUP` can see every
registered user with a human-readable label and per-user counts, reset any one of them to
a clean slate, and that reset survives the wiped user reconnecting with a full offline
outbox — while no code path in the app can read another user's training content.

- [x] **`OIDC_ADMIN_GROUP` and the dev admin switch.** A name, not a flag —
      `GAIN_DEV_ADMIN` names which `GAIN_DEV_USER` value is the operator, so one dev server
      can drive both an admin and a non-admin through `x-gain-e2e-user`.
      `src/lib/server/config.ts` (`1fb417e`).
- [x] **`control.db` migration 002**: `display_label` and `data_generation` on
      `control_user`, `is_admin` on `session`. `src/lib/server/control-db.ts` (`8b0a495`).
- [x] **Admin-ness through the session lifecycle.** Re-derived from the OIDC groups at
      login and on every refresh, never a stored user attribute; an unevaluable group check
      leaves `is_admin` unchanged rather than clearing it. `src/lib/server/auth.ts`
      (`dd7968c`).
- [x] **`src/lib/server/admin-stats.ts`** — the one module allowed to open another user's
      `gain.db`, returning only `COUNT(*)`, `MAX(...)` and byte totals (`dd41f3b`).
- [x] **`src/lib/server/admin-reset.ts`** — the ordered per-user reset: sessions first,
      then the generation bump, then the cached handle closed and evicted *before* the
      unlink, then re-provisioning (`66bf5c6`).
- [x] **The `/admin` screen**: a card list (never a table — UI-DECISIONS §12's 360 px
      rule), each card reading its user's activity back as one sentence rather than a grid
      of counts, with a reset that expands in place to a type-to-confirm panel. A non-admin
      gets 404, not 403. `src/lib/admin/user-status.ts`, `src/routes/admin/`, the
      `/admin` link in `src/routes/+layout.svelte` (`5b842cd`).
- [x] **Sync generation.** `syncBatchSchema` carries the generation the outbox was filled
      under; `POST /api/sync` rejects a whole batch on mismatch rather than partially
      applying it, and the client clears its outbox and adopts the server's generation on a
      409 (`0d684d5`).
- [x] **Discarding quarantined ops** — a pre-existing gap the reset work touched anyway: a
      stuck "entries could not sync" banner had no way to clear, whether a reset caused it
      or a removed exercise slug did. `discardQuarantined()`, the Discard control in
      `src/routes/+layout.svelte` (`66771f6`).
- [x] **`e2e/admin-walkthrough.spec.ts`** — an operator resets a disposable per-project
      account and the status line proves the cross-user read and the wipe both actually
      happened, not just that the card's shell rendered (`5ac81fd`).

---

## Loose ends

Small, real, and owned by no phase. Pick them up wherever they fit.

- [ ] **Old plan versions stay browsable** (§8). Workouts are already bound to the version
      they were logged under, so "what did the plan say in week 3" is answerable in the data
      and unanswerable in the UI.
- [ ] **Plan archiving.** `plan.archived_at` is filtered on read in `src/routes/+page.server.ts`
      and nothing ever sets it.
- [x] **The e2e harness shared one seeded database across every spec and every viewport
      project**, so any spec asserting on whole-account state — rather than its own
      `client_id`-scoped rows — would see another spec's or another project's concurrent
      workouts land in between. `e2e/home-walkthrough.spec.ts` was the first (and, as of
      this fix, only) spec to do that: the Home screen's suggested-next-session and
      activity-list reads have no `client_id` to scope by, by design. `GAIN_DEV_USER` is
      read once at server boot (one process, one value, for the whole run), so no env var
      can vary per spec or per project against one running dev server — fixed with a
      dev-only per-request `x-gain-e2e-user` header override in `hooks.server.ts`'s bypass
      branch, which `home-walkthrough.spec.ts` sets from `testInfo.project.name` before
      its first navigation, giving each of the three viewport projects a fully isolated,
      pre-seeded account (`homeDevUserFor`, `e2e/env.ts`). `e2e/seed.ts`'s
      `openSeededUserDb` now resolves a `devUser` to its user id instead of assuming "the
      one entry under `users/`", since seeding more than one user per `DATA_DIR` is now
      normal. Every other spec is untouched — none of them assert on whole-account state
      today — but any future one that does should call `homeDevUserFor` with its own
      project name the same way, rather than reusing this spec's users or the shared
      `E2E_DEV_USER`. (`dd543bc`)
