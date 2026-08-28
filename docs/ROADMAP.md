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
| `docs/todo.md` | Inbox for findings from manual testing. Triaged, not accumulated |

**The triage rule:** anything in `docs/todo.md` bigger than a single commit moves here, into the
phase it belongs to. Anything smaller gets done and deleted. A design decision that comes
out of a to-do item belongs in `CLAUDE.md` under Invariants, not in either list — that is
where the `weight_kg` ruling went, and it is why it survived.

**Closing an item** means ticking it and appending the commit SHA, the same convention the
build has used so far. Closing a *phase* means updating three places together: §12's status
line, the README status banner, and CLAUDE.md's "Current state" paragraph.

---

## Status

**Phases 1–9 are all done. The loop closes:** an AI writes a plan, GAIN imports and logs it,
exports a bundle, and a revision pasted back in is reviewed and committed with a renamed
slug mapped onto its history rather than silently splitting it.

Phases 1–7: the pure round-trip core, the per-user storage layer, the web app with OIDC and
first run, the session runner, the export UI, the offline PWA, and progress, history & the
Home screen. A full session of the fixture plan can be started, logged and finished with no
connection at all — including across a full browser kill, not just a reload — and syncs
cleanly once reconnected, and `e2e/session-runner-walkthrough-a.spec.ts`, `-d.spec.ts`,
`e2e/export-walkthrough.spec.ts` and `e2e/offline-*.spec.ts` prove it.
Double-progression state, per-exercise and per-session-type charts, metric trends and the
reverse-chronological History all render from real logged sets, and
`e2e/progress-walkthrough.spec.ts` and `e2e/history-walkthrough.spec.ts` walk both end to end.

Phase 9, built out of order ahead of phase 8: an operator gated on `OIDC_ADMIN_GROUP` sees
every registered user with per-user counts and can reset one to a clean slate, with no code
path in the app able to read another user's training content. `e2e/admin-walkthrough.spec.ts`
proves the cross-user read and the reset both actually happen, not just that the screen
renders.

Phase 8, the diff review screen and rename mapping: a revised plan is diffed against the
version it is imported over, presented in plain language rather than field paths, and every
departed slug needs an explicit disposition — mapped onto a survivor or confirmed removed —
before the commit button unlocks. `e2e/revision-walkthrough.spec.ts` logs a set, revises the
plan with a rename, reviews the diff and commits, then confirms the set survived under the
new slug.

**Nothing left is phase-numbered.** The [Loose ends](#loose-ends) below took the first
five, and the list is now clear: the e2e suite runs in CI as its own job, a plan can be
archived and brought back without ever putting its logged history at risk, every version
of a plan is browsable as the document that was imported, a user can wipe their own
account and start over without asking an operator, and an operator has a backup recipe
that survives a live WAL database rather than a naive `tar` of the volume.

| Phase | Deliverable | State |
|---|---|---|
| 1 | Contract schema, parser, diff engine, export generator, both prompt templates | Done |
| 2 | SQLite layer, per-user provisioning, migrations, import writer and review | Done |
| 3 | OIDC auth and group gate, container, AGPL §13 source link, first run | Done |
| 4 | Session runner UI, online only | Done |
| 5 | Export UI — the loop's return crossing | Done |
| 6 | Offline PWA: IndexedDB, sync queue, idempotency | Done |
| 7 | Progress, history & the Home screen | Done |
| 8 | Revision diff review | Done |
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
      could not be automated — the harness cannot kill the client and server processes
      independently of each other — so it was carried as a manual step with exact commands
      and **performed by hand against a real container on 2026-08-23**: a restart
      mid-session loses nothing already synced, and an op queued while offline still
      flushes and lands once the container is back. That is the last of phase 6's
      acceptance criteria, and the item is deleted from `docs/todo.md` rather than left
      standing.

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

## Phase 8 — Revision diff review

**Design:** [`docs/superpowers/specs/2026-08-18-phase-8-revision-diff-review-design.md`](superpowers/specs/2026-08-18-phase-8-revision-diff-review-design.md).
**Plan:** [`docs/superpowers/plans/2026-08-18-phase-8-revision-diff-review.md`](superpowers/plans/2026-08-18-phase-8-revision-diff-review.md)
— nine tasks in six independently-committable batches. **Both are archived records of
work that shipped**, not live plans: their checkboxes were never ticked as the batches
landed, so read them for the reasoning and take what shipped from the ticked items below.

**Done when:** a logged block exports, comes back revised from an AI, and the diff is
reviewed and committed. That is the loop closing, and it is the last thing the build owes.

Already in place: the phase-1 diff engine (`src/lib/diff/diff.ts`), and
`prepareImportReview` already returns a real `ContractDiff` for a revision import. The home
screen renders a placeholder saying the detailed review "arrives in a later phase" and
commits as-is. The engine is done; this is the UI on top of it.

- [x] **The diff review screen**: changed targets, added and removed exercises, added and
      removed metric definitions, in plain language rather than field paths.
      `src/lib/diff/present.ts`'s `presentDiff` turns `diffContracts`' output into groups a
      phone screen can render, rebuilding the warning list from the diff's own structured
      fields rather than filtering its strings (`7c3364b`). The import flow moved to its own
      route, `src/routes/import/`, so the paste box, parse-error report and review all live in
      one place instead of three (`5f70a59`). The review screen itself — blocking problems
      first, a required disposition per departed slug, the AI's changelog, then collapsed
      change groups, commit disabled until every disposition is answered — is `e4febdc`.
- [x] **Rename mapping.** The hard part, and the one that protects history. An unmatched slug
      is flagged as a possible rename with an offer to map it onto an existing exercise; a
      slug is never silently minted for a name that closely resembles an existing one. If
      `goblet-squat` returns as `goblet_squat`, every chart splits in two, nothing errors,
      and the loss is unrecoverable. `importPlan` gains a `renames` input; `applyRenames`
      (`src/lib/db/import-plan.ts`) runs inside the existing transaction, immediately before
      `upsertExerciseDefs`, because after that upsert a fresh `exercise_def` row already
      exists for the new slug and the history is already split. It also rewrites
      `deviation.substitute_exercise_slug`, the one slug stored as loose text, scoped through
      `plan_version` so a rename in one plan cannot touch an identically-named slug in
      another (`4d8280e`). `fixtures/plans/home-training-v2.md` and a diff test prove renamed,
      added and removed exercises are all detected and offered correctly (`e6dc0b8`); the
      golden test proves the second import's write path — the one that can move history,
      unlike the first — is lossless (`07d24ee`); and `e2e/revision-walkthrough.spec.ts` walks
      the whole loop from a logged set through a pasted revision to a committed rename, then
      confirms the set survived under the new slug (`5daa81b`).

---

## Phase 9 — Operations

Built out of order, ahead of phase 8: the self-hosting operator needed a way to see who
was actually using the alpha and to wipe a test account, and neither depended on the diff
review work below, which shipped after it.

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

The first four are done. What is left — a backup recipe — has no dependency on any of
them; pick it up whenever.

- [x] **The e2e suite runs in CI.** An `e2e` job in `.github/workflows/ci.yml` on the same
      triggers as `check`, running alongside it rather than after it — the two fail for
      different reasons, and waiting on a lint error before finding out a walkthrough broke
      only serialises the feedback. `~/.cache/ms-playwright` is cached on the *resolved*
      Playwright version (`node -p "require('@playwright/test/package.json').version"`), not
      the range in `package.json`: browser builds are pinned per release, so a cache
      restored across a version bump would hold a chromium the new Playwright refuses to
      launch. On a cache miss the job runs `npx playwright install --with-deps chromium`; on
      a hit, only `install-deps` (the apt half is never cached and is cheap). Failures upload
      `test-results/` so a red job hands back something openable in `playwright show-trace`,
      and the `image` job now gates on `[check, e2e]` so a tag cannot push an image whose
      walkthroughs are red. `npm run verify` is unchanged — the reason e2e is kept out of it
      (CLAUDE.md, Commands) is that a few-second *local* check must never download a
      browser, which a separate CI job does not. The suite is 134 tests across four
      projects in ~1.4 min locally, including the `offline` project's production build.
- [x] **Plan archiving.** `src/lib/db/archive.ts` is the `archivePlan` / `unarchivePlan`
      pair — injected `now`, one column, and idempotent in both directions so a second
      archive cannot stamp today's date over the only record of when the plan was put away.
      The control is on the Home plan card, and the archived plans sit in a collapsed
      "Archived" group below it (`src/routes/+page.svelte`).

      **The semantics settled 2026-08-23: archiving is reversible and read-only, not
      deletion**, and the read half is the load-bearing one. The `archived_at` 404 came off
      `export`, `history`, `progress` and their children — each now returns `planArchived`
      and marks itself with `$lib/components/ArchivedNote.svelte` — and went onto the two
      inbound write paths instead: the session runner 404s, and `/import` refuses a revision
      by name with a 409 rather than a bare "no such plan", which would read as data loss for
      a plan that is right there on the screen behind it. First run is now keyed on "this
      account has never imported anything", not "nothing is active", so archiving your only
      plan cannot drop you into the bootstrap interview as though it had been deleted.

      `tests/db/archive.test.ts` covers the write path (including that every logged workout
      and set stays readable while archived); `tests/server/archive-route.test.ts` covers the
      Home actions, the read routes staying open, and both refusals;
      `e2e/archive-walkthrough.spec.ts` archives from the card, opens the history out of the
      collapsed group, takes the 404 on the session runner, and unarchives back.
- [x] **Old plan versions stay browsable** (§8). `/plan/[slug]/versions` lists every
      version newest first — number, import date, the current marker, the AI's changelog —
      and `/plan/[slug]/versions/[n]` replays that version's verbatim `source_md` with the
      same `copyText`/`downloadText` fallback the bootstrap prompt and the export use.
      Nothing new went into `$lib/db`: `listVersions` and `readSourceMd` already did all the
      reading, so both routes are pure assembly. Reached from the Home plan card beside
      Export, Progress and History, and from the history detail, whose "Plan v2" is now the
      link — that is where the question is actually asked.

      Two details worth keeping. The document rides the textarea as a `value` expression
      rather than as element content, because HTML eats a newline immediately after an
      opening tag and a plan starting with a blank line would come back a byte short. And
      `readSourceMd` is a bare `readFileSync` on a path stored in the row, so a missing
      document renders an explanation naming the path — the row is still good, only the file
      is gone — rather than a 500. `tests/server/versions-route.test.ts` covers byte
      identity, the missing file, and `/versions/2x` being a 404 rather than a loose parse
      that serves version 2 under a URL that never named it;
      `e2e/versions-walkthrough.spec.ts` imports a revision and asserts v1 comes back
      byte-identical to the fixture through the browser.
- [x] **A user can reset their own account.** `/account` (`src/routes/account/`), reached
      from the footer — not Home, since nothing destructive belongs beside the workout the
      user is about to start. Reuses `resetUserData` (`src/lib/server/admin-reset.ts`)
      exactly as `/admin` does, the same expanding type-to-confirm panel and all; only the
      caller changes, never the machinery, per the CLAUDE.md invariant that names it. The
      confirmation phrase is a case-insensitive `RESET`, not the account's own label —
      `/admin`'s confirmation identifies *which* card an operator is about to wipe among
      many, a distinction that does not exist when the account resetting is the only one
      you can ever reach from here.

      Reset ends every session for the account, including the one asking — `resetUserData`
      does not carry an exception for its caller — so the action captures the current
      session's tokens before the wipe and re-mints a fresh session afterwards (OIDC mode
      only; dev-bypass mode has no session row to find or restore). The device that just
      reset also clears its own sync outbox and `gain:workout:*` `localStorage` keys before
      navigating home: those local writes are not protected by the ordinary generation
      check, since this same page load is what re-seeds the client's belief about the
      generation to the fresh value the 409 path exists to react to.
      **Done when:** a user resets themselves and lands on the empty state with the
      bootstrap prompt, and a second device still holding a queued outbox gets the
      generation 409 and clears — rather than quarantining forever, which is the failure this
      reuses `data_generation` to avoid. `tests/server/account-route.test.ts` covers the
      route (wrong confirmation, case-insensitive match, the re-mint, and the bypass
      skip-path); `e2e/account-reset-walkthrough.spec.ts` walks a real reset through the
      browser. The second-device 409 reuses `tests/server/sync-route.test.ts`'s existing
      coverage rather than a new two-context e2e, since the generation-bump path is the same
      one an operator reset already exercises.
- [x] **A backup recipe an operator can actually follow.** ARCHITECTURE §3 said "a single
      volume snapshot is a complete backup," which was true of the *layout* and not of a live
      database: every `gain.db` and `control.db` is opened `journal_mode = WAL`, so a `tar`
      or `docker cp` taken while the container is writing can capture a torn `.db`/`-wal`
      pair and produce a backup that restores to a state that never existed. This is the
      only copy of the user's training history.

      README's "Running it" now has a Backups subsection carrying **both** recipes rather
      than one: stop the container and `docker compose cp` the tree, which is what a
      household instance should do, or snapshot the databases live with `VACUUM INTO` when
      the backup has to be scripted and the app cannot go down for it. Restoring and
      verifying are written down beside them, since a backup nobody has restored is a
      hypothesis.

      Two constraints shaped the live recipe. The runtime image ships no `sqlite3` binary
      (`node:24-bookworm-slim` plus `tzdata`), so it drives the app's own `better-sqlite3`
      through `docker compose exec … node -e` — which also means the recipe works against
      every already-released tag rather than only after the next one. And the container
      runs as an unprivileged user owning `/data` and nothing else, so the snapshot is
      written *inside* the volume and copied out, then deleted so the next backup cannot
      include the last. The snippet copies each user's `plans/` and `exports/` alongside
      the databases, so what lands on the host is a complete `/data` tree and not a set of
      loose `.db` files that would restore into an empty one.

      Verified against a deliberately hostile case rather than reasoned about: a live
      writer holding all three databases open with ~1.6 MB of committed rows sitting in
      the `-wal` and an 8 KB `.db`. The read-only `VACUUM INTO` succeeded against it, the
      snapshot passed `integrity_check`, and it contained the WAL-resident rows a copy of
      the `.db` alone would have missed. §3's bullet and the same claim repeated in the
      Dockerfile's `/data` comment are both corrected — a naive `tar` is now described as
      the hazard it is, in all three places it was implied safe. (`397991d`)
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

---

## Post-review work (2026-08-27)

From [`REVIEW-2026-08-27.md`](REVIEW-2026-08-27.md), a full-stack review conducted ahead of
opening the instance to real users. Findings smaller than a commit went to
[`todo.md`](todo.md); what is here is bigger than that. The documentation corrections the
review called for are **done** — ARCHITECTURE §2 now carries a "why" column, §4 and
CLAUDE.md describe what `control.db` actually holds, and UI-DECISIONS §5, §12 and its
closing section describe the app that exists.

Ordered by what the review recommended, not by size.

### Before real users

- [x] **The auth bypass guard cannot rely on `NODE_ENV`.** `loadConfig` refused
      `GAIN_DEV_USER` in production by testing `nodeEnv === "production"`, but `node build`
      never sets it and neither does adapter-node — so a production bundle started outside
      the container served unauthenticated **and logged "production builds refuse it" while
      doing it.**
      The guard now keys on `ORIGIN`: `GAIN_DEV_USER` and `GAIN_DEV_ADMIN` are refused
      unless it is a loopback address (`localhost`, `127.0.0.1`, `[::1]`), production or
      not. "The presence of OIDC configuration" cannot be the signal, which is worth
      recording rather than rediscovering — the bypass is only ever *selected* when OIDC is
      absent, so keying on it would have been vacuous. `ORIGIN` is the one variable a
      published instance cannot avoid setting correctly, since SvelteKit checks form posts
      against it and it forms the OIDC redirect URI. An unparseable `ORIGIN` counts as
      non-loopback: guessing permissively is how an unauthenticated server ships.
      Setting `GAIN_DEV_USER` on a deployed instance is now fatal even when OIDC is
      complete and would have won the auth branch — a variable that turns authentication
      off has no business surviving there. `tests/server/config.test.ts` covers the
      production-shaped boot the review found (public `ORIGIN`, `NODE_ENV` unset) plus each
      loopback form; verified live against `node build`, which refuses to start with a
      public `ORIGIN` and boots normally on `http://127.0.0.1`. The startup warning in
      `hooks.server.ts` now says why the bypass was permitted rather than claiming a
      refusal that was not happening.

- [x] **A Content-Security-Policy, and the security headers that go with it.** There were
      none at all — confirmed empirically against `node build`, not just by grep — and
      nothing told the operator to set them at the proxy either.
      `svelte.config.js` now carries a `kit.csp` policy (`mode: "auto"`, so dynamic pages
      are nonced and prerendered ones hashed), and `hooks.server.ts` stamps
      `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and
      `Permissions-Policy` from `src/lib/server/headers.ts` on everything it renders, plus
      a `default-src 'none'` CSP on the responses SvelteKit renders no page for. The CSP
      cannot come from the hook: SvelteKit alone knows the nonce it stamped into the page's
      hydration script, and a second policy header is intersected with the first by the
      browser, so it would block the app's own scripts. `style-src-attr 'unsafe-inline'` is
      the one allowance, because `style:` directives compile to inline style attributes;
      `style-src` itself stays `'self'`.
      The split is written down in ARCHITECTURE §3, "Security headers": `Strict-Transport-Security`
      is the proxy's alone, since the container listens on plain HTTP and cannot know it was
      reached over TLS. **`/` and `/healthz` answer with a CSP; a hashed asset does not, and
      that is accepted rather than fixed** — adapter-node serves `client/` and `static/`
      through its own middleware ahead of the SvelteKit handler, so no hook can see those
      responses at all, and closing it means replacing `node build` with a custom server
      around `build/handler.js` in exchange for headers that govern nothing (a CSP on a
      script response does not constrain that script in the page that imported it, and
      every asset here is a build artifact rather than user content). ARCHITECTURE §3 says
      so and points the operator at the proxy.
      `e2e/security-headers.spec.ts` asserts the headers and that the session runner — the
      screen with the most inline-style surface in the app — loads with no policy violation
      in the console; the full Playwright suite passes under the policy, which is the real
      proof that nothing was broken by it.

- [ ] **Branch protection on `main`.** `ci.yml` runs nothing on a push to `main`, and its
      comment justifies that with "every commit that reaches `main` was already vetted by
      its PR". Nothing enforces the premise: the repository reports no branch protection and
      no rulesets, on a public forkable repo. This is a settings change, not code — it makes
      an existing decision true.
      **Done when:** `main` requires a PR and a green `check` + `e2e`, and a tag can only be
      cut from an ancestor of `main`.

- [ ] **The quarantine path is proven only against a test double.** `tests/sync/queue.test.ts`
      exercises `tests/sync/memory-outbox.ts`, a hand-written double; the code that actually
      runs on a phone, `src/lib/sync/idb.ts`, has no unit test, and **no e2e spec has ever
      produced a quarantine**. Both failure modes CLAUDE.md's invariant names — a record
      deleted rather than held, or `pending()` no longer filtering on state and retrying
      forever — are reachable with a fully green suite. CLAUDE.md is explicit that an
      invisible quarantined op "is exactly the data loss this whole phase exists to prevent,
      just moved one step later."
      **Done when:** one e2e syncs an op naming a slug a revision removed, then asserts both
      the surviving IndexedDB record and the banner the user actually sees.

- [x] **Nothing keeps `docs/CONTRACT.md` and the Zod schema in sync.** The three-places rule
      was pure convention: the only test touching CONTRACT.md asserted it is embedded
      *verbatim*, never that its content matches the schema, and `tests/schema.test.ts`'s
      "minimal valid block from CONTRACT §6" was a hand-copy. Edit the spec without touching
      the schema and the suite stayed green while GAIN shipped instructions telling every AI
      to emit something its own parser rejects.
      `tests/schema.test.ts` now reads §6's block out of the file through the real
      `scanFences`, and clones *that* into every mutation test — the raw YAML deliberately,
      since `parsePlanDocument` returns the schema's output with defaults already applied
      and starting from that would quietly stop those tests exercising the shape an AI
      actually emits. A second test runs the whole document through `parsePlanDocument`, so
      the fence scan and the YAML parse are covered on the same path an import takes; its
      failure message is the report GAIN would hand a user whose AI had followed
      CONTRACT.md to the letter. Verified by mutating §6 (`name:` → `title:`) and watching
      it fail with "Unrecognized key". Note §2 holds a *second* ```gain-plan fence nested
      inside a four-backtick ````markdown block, which the scanner consumes as that block's
      body — so the document has exactly one contract block, and any future edit that
      un-nests it will break this test rather than the parser.

### Before more feature work

- [ ] **Decide whether GAIN shows a plan's symptom framework to the user.** `safety.symptom_framework`
      — the green/yellow/red pain guidance, with an action and modifications per level — has
      been parsed, validated and stored in `plan_version.safety_json` since phase 2, and is
      replayed verbatim into every export so the reviewing AI reads it. **No route and no
      component has ever read it back.** The plan tells the user which sensations mean stop,
      and the app never shows them, at the one moment the guidance exists for.

      This is a product decision, not a cleanup, and it is the reason UI-DECISIONS §5 was
      rewritten rather than merely corrected: the colour triad was reserved for this and
      nothing else, so the answer here decides what the colour system is for. Note the data
      models do not line up — the framework has three levels, the metric the app collects is
      a 0–10 scale, and nothing maps one onto the other — so "render the metric as a traffic
      light" is not the cheap version of this.
      **Done when:** either the framework is rendered in the runner and §5's reservation
      comes back with it, or the decision not to render it is recorded in UI-DECISIONS §5
      with its reason. Storing safety guidance the user never sees is the one outcome that
      should not continue by default.

- [ ] **Per-user migration observability.** Migrations run lazily, per user, only when that
      user's next request opens their database — so a deploy migrates nobody, there is no
      point at which the fleet is known to be on one schema, a failure for one user is
      invisible, and a rollback strands whoever already advanced. `appliedSchemaVersion`
      exists and is exactly the right function; it is called only from
      `tests/db/provision.test.ts`. `admin-stats.ts` also reads foreign databases without
      migrating them, so a future migration that restructures `plan`, `plan_version`,
      `workout` or `set_log` breaks the operator screen for exactly the users who have not
      logged in since the deploy.
      **Done when:** `/admin` shows each user's applied schema version, and the rollback
      policy is written down — "we roll forward" is a fine answer, an unwritten one is not.

- [ ] **`/import`'s failure screens have no coverage of any kind.** The parser side is
      excellent — all seven `ParseFailureKind` variants are tested, malformed YAML included.
      The screen has nothing: no e2e renders a parse failure, the pasted-bundle explanation
      (a UI-DECISIONS §11 requirement) or the blocking-revision report, and `blockingReport()`
      lives inside `src/routes/import/+page.svelte` where no unit test can reach it. The
      user's whole recovery path from the most likely failure in the loop is unverified.
      **Done when:** `blockingReport` moves to `$lib` with unit tests, and one e2e pastes a
      broken plan and asserts the report is on screen and copyable.

- [ ] **Server error reporting.** `src/lib/server/log.ts` is one `console.error` wrapper with
      a single call site, and there is no custom `handleError` hook — so an unhandled error
      reaches the operator as a raw stack trace against minified bundle paths, with no
      timestamp, no request id, no user id and ANSI codes in the stream. "Which user lost a
      workout" is currently unanswerable. Worth doing before real users rather than after,
      because the first unreproducible bug report is when you cannot add it retroactively.
      **Done when:** a `handleError` hook attaches a request id and user id, and there is one
      log line per request.

- [x] **`/healthz` verified nothing**, so a container whose storage had failed reported
      healthy to both Docker and Portainer and was never restarted. The failure presents as
      *new and uncached users breaking while existing sessions continue*, because handles
      are cached process-wide — harder to notice, not easier.
      The endpoint now checks `access(R_OK | W_OK)` on the data directory and then
      `SELECT 1` on `control.db`, answering 503 with the error on either. **The `SELECT 1`
      this item originally specified is not sufficient on its own, and that is worth
      knowing rather than rediscovering:** reproducing the review's own scenario — `chmod
      000` on the data directory under a running server — left the query *succeeding*,
      because SQLite reads through a file descriptor opened at startup and revoking a
      directory's permissions does not revoke an open fd. It answered 200 while the app
      500'd, which is the bug verbatim. The `access` check is the load-bearing half; the
      `SELECT 1` is kept for a corrupted or closed handle, which `access` cannot see.
      Verified end to end against a real `node build`: 200 healthy → 503 on `chmod 000` →
      200 again on restore. A full disk is still not caught, and nothing cheap catches it.

- [ ] **Dependency automation and scanning.** No Dependabot, no Renovate, no `npm audit` in
      CI, no image scan, no SBOM. The stated "every dependency on a current major" policy has
      already drifted — TypeScript is a full major behind. Note the audit blind spot when
      wiring this up: `npm audit --omit=dev` reports zero while `npm audit` reports three,
      because adapter-node inlines `@sveltejs/kit` — a devDependency — into the shipped
      server bundle.
      **Done when:** a dependency bot is configured and CI runs a non-gating `npm audit`.

- [x] **Make the cross-user module boundary real.** CLAUDE.md described `admin-stats.ts` as
      the single cross-user reader and called that "a property of a module boundary rather
      than a rule" — but nothing enforced it, so a second reader added anywhere dissolved
      ARCHITECTURE §4 silently.
      `eslint.config.js` now restricts the *value* import of `better-sqlite3` to
      `control-db.ts`, `user-db.ts` and `admin-stats.ts`, with `allowTypeImports` so
      `Database.Statement` as a type stays free — `import-plan.ts` moved to `import type`
      for exactly that. Verified by adding a value import to `src/lib/db/read.ts` and
      watching it fail. A fourth entry in that ignore list is the guarantee dissolving, not
      a rule to widen.
      `tests/db/log-tables.test.ts` covers the `client_id` half, asserting off `PRAGMA
      index_list` on a freshly-migrated database rather than off DDL text, so a table-level
      `UNIQUE(...)` or a separate unique index counts too. It also scans
      `src/lib/db/workout.ts` for `INSERT INTO` targets — that being the module every sync
      op is written through, whereas `replay.ts` issues no SQL of its own — and asserts the
      scan found all five, so it cannot pass vacuously and a sixth log table cannot join the
      replay uncovered. Verified by dropping a `UNIQUE` and watching it fail.
