# Phase 7b — Progress, charts & history: design

**Status:** approved design, not yet planned or built.
**Date:** 2026-08-16.
**Contract:** ARCHITECTURE §10 ("Progress & history"), §12 phase 7; `docs/ROADMAP.md`
phase 7's five unstarted items; CLAUDE.md's export invariant on `buildProgressSummary`.

**Done when:** double-progression state matches hand-calculated expectations, and every
item in ROADMAP's phase 7 checklist is ticked — the roadmap's own words for this half of
the phase.

---

## 1. What this half is, and what 7a already built

7a shipped the Home screen: the suggested next session, one-tap activity logging, the
`next_morning` prompt. This half is the read-side analytics ARCHITECTURE §10 promises and
ROADMAP's five remaining phase-7 bullets: double-progression state as one pure module,
per-exercise progress, per-session-type stats, metric trends, and workout history. They
share no code with 7a beyond the plan card they are linked from.

### What already exists and must not be rebuilt

- `src/lib/db/logs.ts` — `logsForPlan(userDb, planId)` reads every version's workouts,
  set logs, metric values, deviations and activities into the plain-data `Logs` shape
  (`src/lib/logs/types.ts`). Every chart and stat in this phase reads from this, exactly
  as `buildProgressSummary` already does.
- `src/lib/export/bundle.ts` — `filterLogsToWindow(logs, window)`. Windows charts and
  export the same way; there is no reason for a second definition of "windowed".
- `src/lib/export/windows.ts` — `exportWindowOptions`, `resolveExportWindow`. Derives
  window choices from the plan's own `block_length_weeks`. Reused as-is even though it
  lives under `export/`: it is window logic, not export-specific logic.
- `src/lib/export/summary.ts` — `renderExerciseSets`, `formatNum`, `isoDate`. Set
  rendering is reused verbatim for History's drill-down, so a workout reads the same way
  whether it is viewed in the app or in an exported bundle.
- `src/lib/contract/schema.ts` / `src/lib/session/session-view.ts` — `resolveSession`
  resolves a session's blocks and exercises with every prescription-level override
  applied, giving `ResolvedExercise.reps`/`.durationSec`/`.perSide` — the resolved range
  double-progression reads is this, not a second pass over the raw contract.
- `src/lib/db/read.ts` — `listPlans`, `getCurrentVersion`, `contractOfVersion`.

---

## 2. Decisions settled before design

| # | Decision | Rejected alternative |
|---|---|---|
| 1 | Charts are hand-rolled inline SVG | A charting dependency — the repo has zero non-essential deps today |
| 2 | Per-exercise state keys on `(session_key, exercise_slug)` | Bare `exercise_slug` — the same exercise legally carries different rep ranges in different sessions (goblet-squat: `[8,12]` in A, `[12,15]` in D) |
| 3 | Progress and History live at `/plan/[slug]/progress` and `/plan/[slug]/history` | Embedded in the Home screen |
| 4 | Double-progression readiness reads range vs. reps/duration only | Also weighing a metric like `rir` — plan-declared metric keys are free text with no structural meaning (ARCHITECTURE: progression fields are "largely free-text ... does not act on them automatically", `scheduling.sequence` is the one carve-out) |
| 5 | Charts share the export window picker | A second, chart-specific windowing scheme |
| 6 | History states the plan version as plain text, no drill-in | Building a version viewer now — browsing old versions is a separate, unbuilt ROADMAP loose end |
| 7 | Per-exercise progress is a list (compact rows) that drills into a detail page per row | Every `(session, exercise)` pair's charts rendered inline — at fixture scale, 15–25+ chart blocks stacked on one screen |
| 8 | Progress and History are two routes | One route with tabs |
| 9 | Charts use one accent hue only, no categorical palette; per-side exercises render as two small charts (Left / Right) rather than one two-series chart | A categorical palette for L/R — this design system has never needed one; icons are `currentColor`, nothing charts today |
| 10 | Difficulty distribution (easy/medium/hard) renders as 3 sequential accent shades | Green/amber/red — CLAUDE.md reserves those for the symptom framework (§5) only |
| 11 | `summary.ts` refactors onto the new shared module, splitting its "Per-exercise progression" table to one row per `(session, exercise)` | Re-merging the new per-session series back into today's bare-exercise rows to preserve the exact current export text |

On (11): `summary.ts` today groups sets by bare `exercise_slug`, so goblet-squat's
session-A and session-D history are currently rendered as one merged "first/latest" row.
Once the shared module keys on `(session_key, exercise_slug)`, the honest choice is to let
`summary.ts` key the same way rather than maintain a second, different grouping just to
keep old export text unchanged — two groupings of the same data is exactly the
"silent-wrong-number" risk CLAUDE.md's export invariant warns about, just moved one level
up. No existing test pins the merged format (`tests/summary.test.ts`,
`tests/golden.test.ts` only assert the string `goblet-squat` appears). This changes
Section 2 of every export bundle produced after this ships.

The refactored row gains a column too: alongside first/latest sets and last difficulty,
`doubleProgressionState` supplies a readiness verdict ("ready for a load increase" /
"in progress" / blank for a scalar target) — the whole reason ROADMAP frames this as one
module "consumed by *both* the charts and `buildProgressSummary`", not a grouping helper
consumed by one and a readiness check consumed by the other.

---

## 3. Architecture

Pure logic in `$lib`, thin routes — phases 4, 5 and 6's shape.

```
src/lib/progress/exercise-series.ts    buildExerciseSeries()        pure
src/lib/progress/double-progression.ts doubleProgressionState()     pure
src/lib/progress/session-stats.ts      sessionTypeStats()           pure
src/lib/progress/metric-series.ts      numericMetricSeries()        pure
src/lib/db/history.ts                  versionsByWorkout()          one read
src/lib/export/summary.ts              buildProgressSummary()       refactored onto exercise-series.ts
src/routes/plan/[slug]/progress/       the hub + exercise/metric drill-downs
src/routes/plan/[slug]/history/        the workout list + drill-down
```

`exercise-series.ts` is the one piece every other per-exercise concern is built from:
given `Logs`, the resolved contract, a `session_key` and an `exercise_slug`, it returns
one point per workout the exercise was logged in — the sets that occurred, grouped by
side, plus each set's weight/reps/duration/difficulty. Volume and difficulty distribution
are reductions over this output, not separate reads. `doubleProgressionState` is a pure
function of one exercise-series plus the resolved range; nothing in it touches the
database.

`double-progression.ts` always reads the **full, unwindowed** series — never the chart
window picker's selection. This mirrors `prefill.ts`, which pre-fills from true last
performance regardless of any UI filter: whether a load increase is warranted is a fact
about the most recent session, not about how far back the user happens to be looking on a
chart screen.

**One exception: `summary.ts`.** The export table's readiness column is computed from the
*same windowed series* as that row's "latest logged" column, not full history. A row
whose "latest logged" is the most recent workout inside the chosen window would otherwise
sit beside a readiness verdict drawn from a workout outside it — two claims about
"latest" disagreeing within one row. The live app's per-exercise page keeps the
full-history rule; only this one export-table consumer scopes to its own window.

---

## 4. Double-progression state

Applies to any resolved prescription whose `reps` or `durationSec` is a genuine range
(`[min, max]` with `min !== max`) — not gated on `contract.progression?.model`, which is
free text (§2, decision 4's reasoning). A scalar target (e.g. `dead-bug` at a fixed `reps:
16`) has no range to progress through and reports no state. Checkoff-tracked exercises
generate no `set_log` rows and are naturally excluded.

For a `per_side` exercise, state is computed **per side independently** — a lift can be
ready on the left and not the right, which is exactly the asymmetry the fixture's own
per-side sets exist to surface.

```ts
type DoubleProgressionState =
  | { status: "no_data" }
  | { status: "in_progress"; latest: number[] /* one value per set, most recent workout */ }
  | { status: "ready"; latest: number[] };
```

`ready` means every set in the most recent workout met or exceeded the range's upper
bound. `in_progress` means there is history but the latest workout did not. The headline
text ("12/11/11 — one session from a load increase") is a presentation-layer format of
this value, not part of the pure module's return shape.

---

## 5. Per-exercise progress

`/plan/[slug]/progress/exercises` lists one row per `(session_key, exercise_slug)` pair
that has any logged sets: exercise name, session name, and a one-line summary
(`formatLastPerformance`-style text plus the readiness verdict). No charts on this screen.

Each row opens `/plan/[slug]/progress/exercises/[session]/[exercise]`:

- **Readiness headline** — text, not a chart (a single current value is a stat, not a
  plot; see the dataviz skill's form guidance).
- **Load × reps over time** — one line chart, not two. Each point is that workout's top
  weight for the exercise/side; each point is **directly labeled with the reps done at
  that weight**. This keeps it a single axis — a separate reps axis would be the
  dual-axis mistake the dataviz skill calls out by name.
- **Volume over time** — a bar per workout, `Σ(weight_kg × reps)` across every set logged
  that workout for that exercise/side. Skipped entirely for `type: time` exercises, which
  have no reps to multiply.
- **Difficulty distribution** — three bars (easy/medium/hard) across the charted window,
  in the sequential accent tint from §2, decision 10.

A `per_side` exercise renders each of the three charts twice, under "Left" and "Right"
headings, per §2 decision 9.

---

## 6. Per-session-type

Shown inline on `/plan/[slug]/progress` — one compact card per declared session, no
drill-down. A handful of sessions (the fixture has four) is not the sprawl §10 warns
against; a wall of per-exercise charts would be.

Each card, windowed by the shared picker:

- **Completion rate** — a stat: `completed / (completed + partial + stopped)` among
  **finished** workouts of that session (`completed_at` set). A workout still in progress
  (`completed_at` null) is not yet resolved and is excluded from both sides of the ratio.
- **Deviation count** — a stat: count of `deviation` rows on workouts of that session in
  the window.
- **Duration** — a small sparkline, one point per finished workout,
  `completed_at − started_at` in minutes.

---

## 7. Metric trends

`/plan/[slug]/progress/metrics` lists every `(scope, key)` pair with `type: "number"` or
`type: "scale"` (CONTRACT's numeric types — the same test `buildProgressSummary` already
uses) that has logged values in the window: label, scope, latest value. Non-numeric
metrics (`enum`/`text`/`bool`) are out of scope for charting, matching ROADMAP's own
wording ("any **numeric** plan-declared metric is chartable").

Each row opens `/plan/[slug]/progress/metrics/[scope]/[key]` — one line chart, the same
mark spec as the load × reps chart, direct-labeled at its most recent point. One function,
`numericMetricSeries`, serves every metric regardless of which plan declared it or at
which scope — there is no per-metric-name branching anywhere in this module, the same
discipline `buildProgressSummary` already holds for `(scope, key)` keying.

---

## 8. History

`/plan/[slug]/history` — every workout across every version of the plan, reverse
chronological: date, session name, status, a one-line set/exercise count. Simple
"load more" pagination (a fixed page size, e.g. 20) rather than rendering the full history
at once, as a safety margin against very long histories rather than a response to any
known problem today.

`/plan/[slug]/history/[workoutId]` drills into full detail: every set rendered with
`renderExerciseSets` (reused verbatim from `summary.ts`, so a workout reads identically
here and in an exported bundle), every deviation, every metric value logged against that
workout, and — per §2, decision 6 — "Plan v2, imported 2026-07-01" as plain text next to
it, sourced from the new `versionsByWorkout` read.

`src/lib/db/history.ts` adds exactly one thing `logsForPlan` doesn't already carry: the
version each workout ran under. It does not duplicate `logsForPlan`'s set/deviation/metric
reads — the route composes `logsForPlan`'s already-fetched data (filtered to one
`workout_id` for the detail view) with this module's `versionsByWorkout(userDb, planId):
Map<string, { versionNo: number; importedAt: string }>`. The phase-1 `Logs.Workout` type
is deliberately left unchanged: it is export-shaped, export replays `source_md` verbatim
rather than needing a version number, and widening a settled phase-1 type for a feature
that reads it exactly once is not worth carrying into every existing consumer.

---

## 9. Chart visual system

- **One accent hue** (`--accent`/`--accent-soft`/`--dim`/`--muted`/`--line`) everywhere.
  No new categorical palette is introduced (§2, decision 9) — every multi-thing case
  (per-side, per-session) is small multiples of a single-hue chart, not one chart with
  several series.
- **Marks**: 2px lines with rounded data-ends, ≥8px markers, thin bars with a 2px gap
  between adjacent bars — the dataviz skill's mark spec, applied at phone width.
  Difficulty's three bars use three steps of a sequential accent tint (§2, decision 10),
  since easy/medium/hard is an ordinal scale, not an identity — sequential is dataviz's
  documented default for that job.
- **Direct labels, not hover.** This is a touch phone app: no floating hover tooltips.
  Every chart directly labels its most recent point, so the current value is always
  visible with zero interaction (dataviz's "reachable without hovering" rule, satisfied
  by a label rather than a tap-only readout). Tapping any other point reveals its value in
  a small readout beneath the chart. No table-view fallback — these charts run to at most
  ~15–20 points, well short of where dataviz recommends one.
- **Layout is verified in a browser at 360 px**, per the phase-4 review's rule
  (`npm run test:e2e`, `assertNoHorizontalOverflow`). A chart is exactly the kind of
  component whose worst bug is a fixed-width SVG that cannot shrink.

---

## 10. Routes

```
/plan/[slug]/progress                                    session-type cards, links to exercises & metrics lists
/plan/[slug]/progress/exercises                           list, one row per (session, exercise)
/plan/[slug]/progress/exercises/[session]/[exercise]      readiness + 3 charts
/plan/[slug]/progress/metrics                             list, one row per (scope, key)
/plan/[slug]/progress/metrics/[scope]/[key]               one line chart
/plan/[slug]/history                                      reverse-chronological, paginated
/plan/[slug]/history/[workoutId]                          full set/deviation/metric detail
```

The Home screen's plan card gains two links beside the existing Export link: **Progress**
and **History**.

---

## 11. Testing

**Unit, against plain data (`tests/progress/*`):**

- `exercise-series.test.ts` — grouping by `(session_key, exercise_slug)`, side splitting,
  chronological ordering, an exercise with no logs, a `type: time` exercise.
- `double-progression.test.ts` — the ROADMAP example (`12/11/11`) by hand, top-of-range on
  every set vs. one set short, a scalar target reporting no state, `per_side` readiness
  diverging between sides, no history.
- `session-stats.test.ts` — completion rate excluding an unfinished workout, deviation
  count, duration from `completed_at − started_at`.
- `metric-series.test.ts` — `(scope, key)` disambiguation with a key declared at two
  scopes (the fixture's `symptoms_during`), a non-numeric metric excluded, empty window.

**`summary.ts`'s refactor**: existing `tests/summary.test.ts` cases keep passing, plus a
new case asserting the same exercise in two sessions renders as two rows.

**`history.ts`**: `tests/db/history.test.ts` — a workout logged under v1, plan revised to
v2, a new workout logged; `versionsByWorkout` reports each correctly.

**e2e:**

- `e2e/progress-walkthrough.spec.ts` — log an exercise across two different sessions,
  assert both rows appear on the exercises list, open one, assert the readiness headline
  and all three charts render, assert no horizontal overflow at all three viewports.
- `e2e/history-walkthrough.spec.ts` — log a workout, assert it appears in History, drill
  in, assert set detail matches what was logged and the version label is correct.

---

## 12. Documentation on close

This closes ROADMAP's phase 7 entirely (7a already shipped). On merge: tick all five
remaining phase-7 checklist items with commit SHAs, move the phase table's "Not started"
to "Done", update README's status banner, CLAUDE.md's "Current state" paragraph (adding a
"What the phase-7 review changed" subsection if the build surfaces rules worth carrying
forward), and ARCHITECTURE §12's "Done when" column.

---

## 13. Out of scope

Editing or deleting a logged set, deviation or activity. Browsing an old plan version's
actual document (ROADMAP loose end, unowned). Plan archiving (same). Automating
`scheduling.rules` or any progression judgement beyond the mechanical range check in §4 —
GAIN states facts, the reviewing AI and the user make the call, same restraint as 7a's
next-session suggestion and UI-DECISIONS §8's celebration message. A categorical or
multi-series chart palette. Charting non-numeric metrics.
