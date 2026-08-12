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
out of a to-do item belongs in `AGENTS.md` under Invariants, not in either list — that is
where the `weight_kg` ruling went, and it is why it survived.

**Closing an item** means ticking it and appending the commit SHA, the same convention the
build has used so far. Closing a *phase* means updating three places together: §12's status
line, the README status banner, and AGENTS.md's "Current state" paragraph.

---

## Status

Phases 1–4 are done: the pure round-trip core, the per-user storage layer, the web app with
OIDC and first run, and the session runner. A full session of the fixture plan can be logged
on a phone, and `e2e/session-runner-walkthrough-a.spec.ts` and `-d.spec.ts` prove it.

**Phase 5 is next.**

| Phase | Deliverable | State |
|---|---|---|
| 1 | Contract schema, parser, diff engine, export generator, both prompt templates | Done |
| 2 | SQLite layer, per-user provisioning, migrations, import writer and review | Done |
| 3 | OIDC auth and group gate, container, AGPL §13 source link, first run | Done |
| 4 | Session runner UI, online only | Done |
| 5 | Export UI — the loop's return crossing | Not started |
| 6 | Offline PWA: IndexedDB, sync queue, idempotency | Not started |
| 7 | Progress, history & the Home screen | Not started |
| 8 | Revision diff review, template editor | Not started |

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

- [ ] **A read path from `gain.db` to `Logs`.** The export generator consumes the plain-data
      `Logs` shape from `src/lib/logs/types.ts`; the database has the rows. One query module,
      windowed at the SQL level or in memory — either is fine at this size, but it must key
      metric values on `(scope, key)`, never the bare key.
- [ ] **The export route.** Window picker (current block / last N weeks / full history),
      generate, and a preview of what will be copied.
- [ ] **Copy with download fallback**, the same pattern as the bootstrap prompt on the home
      screen — `copyText` then `downloadText`. Paste is the primary transport (§1); the file
      is the convenience.
- [ ] **The template substitutions are real.** `{{plan_name}}`, `{{plan_version}}`,
      `{{export_window}}`, `{{today}}`, `{{workouts_logged}}`, `{{weeks_elapsed}}` — an
      unknown token is left as literal text, never blanked (§11).
- [ ] **An e2e walkthrough**: seed a plan, log a session, export, assert Section 1 is
      byte-identical to the imported document and that the summary reflects what was logged.

**Watch for:** the progress summary is arithmetic the reviewing AI will trust and not check
(AGENTS.md, Invariants). Load is per set, "first" and "latest" are chronological, and every
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

- [ ] **Service worker + app-shell precache.** `static/site.webmanifest` exists and is linked
      from `src/app.html`, so GAIN looks installable today and is not offline-capable — the
      worst of both.
- [ ] **IndexedDB as the workout store.** The runner currently keeps the workout's
      `client_id` in `sessionStorage`, which dies with the tab. `src/lib/session/resume.ts`
      already reconstructs the full ledger from rows and is unit-tested — it is the
      persistence underneath it that is missing, not the reconstruction.
- [ ] **The sync queue**: append-only per workout, client-generated ULIDs, replay on
      reconnect. Last-write-wins on the workout record, union on set logs (§9).
- [ ] **A 401 never discards queued data.** The UI shows a "reconnect to sync" state and
      holds. Losing a workout to a token expiry is unacceptable (§4).
- [ ] **Property tests on replay** (§12): any subset of the queue, in any order, produces no
      duplicate sets and no data loss.
- [ ] **The explicit survival test**: connection loss, phone lock, browser kill, container
      restart.

---

## Phase 7 — Progress, history & the Home screen

**Why it widened.** The old phase 6 was charts only, which left three obligations from §9
owned by no phase at all: the suggested next session, one-tap activity logging, and the
next-morning metric prompt. All three live on the Home screen, none of them need offline,
and each is currently a promise the app does not keep. They are folded in here.

**Done when:** double-progression state matches hand-calculated expectations, and the Home
screen suggests the right next session for the fixture plan's `scheduling.sequence`.

- [ ] **Double-progression state as one pure module.** "12/11/11 — one session from a load
      increase" does not exist anywhere yet. Build it once and have *both* the charts and
      `src/lib/export/summary.ts` consume it. Two implementations of this arithmetic is
      exactly the silent-wrong-number failure the export invariant warns about.
- [ ] **Per-exercise progress**: load × reps over time, estimated volume, difficulty
      distribution.
- [ ] **Per-session-type**: duration, completion rate, deviation count.
- [ ] **Metric trends.** Any numeric plan-declared metric is chartable, keyed on
      `(scope, key)` — a plan may legally declare `rpe` at both set and session scope, and
      keying on the bare key merges two unrelated series into a plausible wrong number.
- [ ] **History**: reverse-chronological workout list, drilling into full set detail and the
      plan version it ran under.
- [ ] **Home: the suggested next session**, from `scheduling.sequence`, with any session
      selectable as an override. Home currently lists every session in plan order.
- [ ] **Home: one-tap activity logging.** The `activity` table exists, the export already
      emits an `activities` CSV, and nothing in the app can create a row — the export format
      is writing a cheque no UI can cash. Buttons are the user's previously-used kinds plus
      rest plus a field for a new one. GAIN ships no list of sports (§9).
- [ ] **The `next_morning` metric prompt on next app open.** Wrap-up deliberately does not
      ask (UI-DECISIONS §8) and nothing else picks it up, so a plan declaring one — the
      fixture does — collects nothing. Next-morning symptom data is worthless collected three
      days later.

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

## Loose ends

Small, real, and owned by no phase. Pick them up wherever they fit.

- [ ] **Old plan versions stay browsable** (§8). Workouts are already bound to the version
      they were logged under, so "what did the plan say in week 3" is answerable in the data
      and unanswerable in the UI.
- [ ] **Plan archiving.** `plan.archived_at` is filtered on read in `src/routes/+page.server.ts`
      and nothing ever sets it.
