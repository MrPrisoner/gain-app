# Progress redesign — design

Status: approved, not yet implemented. Delete this file when the work lands and fold the
durable half into ARCHITECTURE §10, UI, and CLAUDE.md (see CLAUDE.md, "Tracking work, and
folding it back in").

> **Shipped.** The work described here landed; the durable half is in ARCHITECTURE section 10, UI
> and CLAUDE.md. This file is kept only until the screen has been used for a week, then deleted.
> It is a record of how the change was made, not a statement of what is still open.

## 1. Why

The Progress feature answers the wrong question. Its landing screen is four session cards
whose largest element is a **duration** sparkline — minutes per workout — and whose only
other content is a completion rate and a deviation count. Nobody trains to move any of
those numbers, and the completion rate cannot move at all: the runner writes only
`completed` (`WrapUpSheet`) or `stopped` (a red-flag stop), `partial` is merely the state a
workout is created in, and `sessionTypeStats` divides completed workouts by *finished*
ones. The stat is therefore always exactly 100% or 0%, never anything between. Meanwhile
the one
genuinely actionable thing GAIN computes — `doubleProgressionState`'s "12/12/12 — ready
for a load increase" — is rendered as muted 14px body text on a second-level list, unsorted
and unhighlighted.

The screen is also expensive to read. Four cards of roughly 650 CSS px each deliver eight
words and a handful of line segments, so learning nothing costs four screens of scrolling
on a phone. And because `Sparkline` auto-scales its y-domain and labels only its last
point, 42 minutes against 37 minutes renders as a dramatic descent — an axis-less
two-point line overstating a 12% difference.

The redesign restates the feature's job: **show what changed and how the user improved**,
in one screen, with the actionable half promoted to the top.

The computation layer is not the problem and is largely kept. `exercise-series`,
`double-progression`, `metric-series` and `chart-geometry` are sound; this is a
re-composition of what exists plus four new pure modules.

## 2. Decisions settled

These were argued and agreed before this document was written. Implement against them.

1. **Progress gets its own time control, decoupled from the export windows.** Pills, not a
   `<select>`: `4w · 12w · 6m · All`, defaulting to 12w. `since_version` disappears from
   Progress entirely.
2. **The headline is "new bests", "ready to go up", and "movements improved".** Per-movement
   improvement is expressed against the start of the window ("up 14% since June"), never as
   a percentage of an all-time max.

   Total volume was the original third stat and was rejected on review. Under double
   progression — the fixture's own model — `6 kg 12/12/12` becoming `8 kg 8/8/8` is exactly
   what success looks like, and tonnage falls from 216 to 192. A motivational headline that
   goes negative at the user's best moment is worse than no headline. "7 of 12 movements
   improved" cannot invert on success, is defined for bodyweight and timed work, and needs
   no synthetic index. Volume survives only where it is already honest: the per-exercise
   detail page's existing `BarChart`.
3. **An estimated 1RM is acceptable as the in-app comparator** that decides whether
   8 kg × 8 beats 6 kg × 12. It is labelled an estimate in the UI and never reaches the
   export bundle.
4. **Streaks are wanted.**
5. **Four routes collapse to two.** The exercises list and both metric routes are deleted;
   the per-exercise detail route stays.
6. **Movers are grouped by movement, not by (session × movement)**, so a movement
   prescribed in two sessions produces one row rather than two with different numbers.
   Readiness stays per-occurrence, where the session name is what makes it actionable.
7. **Duration disappears from Progress entirely.** It remains visible per workout in
   History.
8. **Section order is "what changed" above "ready to go up".**

### Why the export windows could not simply be restyled

`exportWindowOptions` exists to serve the reviewing AI: `since_version` is the span the AI
has not seen yet, and every label is prose written into the bundle's H1. Progress has a
different reader and a different question. Defaulting Progress to `since_version` means a
user who revised their plan on Tuesday opens Progress on Wednesday and sees one data point
— which reads as "you have made no progress" rather than "you changed the window". The two
controls are therefore separate modules that happen to share `filterLogsToWindow`.

`1w` is deliberately not offered. Most plans run a given session once or twice a week, so a
one-week window renders one point per session type and an empty movers list. A default that
can legitimately render nothing is a broken default, and `1w` is the pill a user reaches for
first.

## 3. New pure modules

All four are pure functions over plain data with the clock injected, matching the rest of
`src/lib/progress/`.

### 3.1 `src/lib/progress/progress-window.ts`

```ts
export type ProgressWindowId = "4w" | "12w" | "26w" | "all";

export type ProgressWindow = {
  id: ProgressWindowId;
  /** UI label: "4w" | "12w" | "6m" | "All". */
  label: string;
  /** ISO 8601. Absent for `all`. */
  start?: string;
};

export const DEFAULT_PROGRESS_WINDOW: ProgressWindowId = "12w";

export function progressWindowOptions(now: Date): ProgressWindow[];

/** Never undefined — an unrecognised id resolves to the default. */
export function resolveProgressWindow(id: string | null, now: Date): ProgressWindow;
```

`26w` carries the label `6m` because "26w" reads as arithmetic homework, while the shorter
spans are labelled in weeks to match how training cadence is actually counted.

Resolution never fails. A hand-edited `?window=` falls back to the default rather than
erroring, exactly as the current hub does and deliberately unlike the export route: nothing
on a chart screen leaves the app, so a silent substitution mislabels nothing.

**A window carries no notion of a preceding period, deliberately.** An earlier draft
attached one so a volume delta could compare the window against the equal-length span
before it; dropping volume from the headline removed the only caller, and with it a class
of wrong answers. A user five weeks into training, on `4w`, would have been compared against
a preceding period holding one week of work, producing a large and meaningless number. Every
comparison this screen makes is now *within* one window — first logged session against
latest — which is always either well defined or absent.

### 3.2 `src/lib/progress/personal-best.ts`

One score for every prescription type, so bodyweight and time-based movements are not
second-class citizens of a load-centric screen. Roughly half the fixture is bodyweight or
timed (`dead-bug`, `mcgill-curl-up`, `side-plank-knees`, every warm-up), so any headline
built on tonnage alone reads as flat or zero for half the plan.

| The series carries | Score | Kind |
| ------------------ | ----- | ---- |
| Load and reps | Estimated 1RM, Epley: `weight_kg × (1 + min(reps, 12) / 30)` | `e1rm` |
| Load and time | `weight_kg × duration_s` | `loaded_hold` |
| Reps, no load | Best reps | `reps` |
| Time, no load | Best seconds | `seconds` |

**Reps are capped at 12 inside the Epley estimate.** The formula is a straight line fitted
to low-rep work and drifts badly above roughly twelve; the fixture prescribes ranges running
to fifteen, so an uncapped estimate would rank a long light set above a genuinely heavier
one. Capping makes the estimate conservative in exactly the region where it is least
trustworthy. Wherever a number derived from it is shown, it is labelled an estimate.

**A loaded hold scores `weight × seconds`, not load alone.** An earlier draft scored it on
load with duration as a tiebreak, which cannot work: a breakthrough is defined as a score
strictly exceeding the previous best, and a tiebreak is a comparator rather than a scalar.
Under that draft a user holding 8 kg for 45 s after 30 s at the same load recorded no
improvement at all — the fixture's per-side loaded hold is precisely that movement.

```ts
export type ScoreKind = "e1rm" | "loaded_hold" | "reps" | "seconds";

export type BestSet = {
  score: number;
  kind: ScoreKind;
  weightKg?: number;
  reps?: number;
  durationS?: number;
  side?: "left" | "right";
  workoutId: string;
  startedAt: string;
};

export type Breakthrough = {
  exerciseSlug: string;
  side?: "left" | "right";
  at: BestSet;
  /** The best that stood before it. */
  previous: BestSet;
};

/** Decided once for a whole series, never per set. */
export function scoreKindFor(
  series: readonly ExerciseSeriesPoint[],
  type: "reps" | "time",
): ScoreKind;

export function breakthroughs(
  series: readonly ExerciseSeriesPoint[],
  exerciseSlug: string,
  type: "reps" | "time",
  perSide: boolean,
): Breakthrough[];
```

**The score kind is decided once for the whole series, not per set.** `topSetChartPoints`
already holds this discipline (`tops.some((p) => p.weightKg !== undefined)`) and for the
same reason: a single bodyweight session inside an otherwise-loaded series must not switch
the unit mid-series and rescale everything around it.

**A new best is a running-max breakthrough.** Walk the series chronologically, keeping the
best score so far; a session whose score strictly exceeds it is a breakthrough. Two
consequences, both deliberate:

- The running max is established over **full history**, not the window. A PR must beat
  everything before it, not merely everything since the window opened.
- **The first logged session is a baseline, not a breakthrough.** Without this, week one
  reports twenty-one new bests and the number means nothing thereafter.

This definition stays meaningful on every window including `All`, where a naive
before-window/after-window comparison would have nothing to compare against and would
report zero.

Per-side movements are scored per side, and a breakthrough carries its side so a row can
label it L/R. **The headline count is of distinct exercises, not of breakthroughs** — a
best on each side of one movement is one new best, not two. Inflating the number is exactly
the kind of quietly-wrong arithmetic this screen exists to stop producing.

**The estimated 1RM never leaves the app.** `src/lib/export/` is untouched by this work.
The module doc comment must say so, and ARCHITECTURE gains a line, because the export's
progress summary is arithmetic the reviewing AI trusts and does not check — an estimate
derived from a formula the plan never declared has no business in it.

### 3.3 `src/lib/progress/movers.ts`

```ts
export type Mover = {
  exerciseSlug: string;
  exerciseName: string;
  /** The occurrence to link to. See the note below — never derived from logs alone. */
  linkSessionKey: string;
  kind: ScoreKind;
  first: BestSet;
  latest: BestSet;
  /** Undefined when the window holds only one session for this movement. */
  deltaPct: number | undefined;
  /** For the row's inline sparkline. */
  points: { x: number; y: number }[];
  sessionCount: number;
};

export function buildMovers(
  contract: GainContract,
  windowedLogs: Logs,
  fullLogs: Logs,
): Mover[];
```

**Sorted by recency of last improvement**, not by `deltaPct`. Relative change is not
comparable across score kinds: a hold going 30 s to 45 s is +50% while a squat going 60 kg
to 63 kg is +5%, so a delta-sorted list is topped by the same two or three bodyweight
movements permanently, whatever the user actually did this month. Recency also answers
"what changed" more literally than magnitude does. Ordering is therefore: movements whose
latest session was a breakthrough first, most recent first; then movements that improved
across the window, most recent first; then the rest. Rows with no delta sort last.

`linkSessionKey` **is chosen from `exerciseOccurrences`, never from the logs.** The most
recent set logged against a movement may come from a session where it was swapped in as a
*substitute* rather than prescribed, and the detail route throws 404 ("That exercise is not
prescribed in this session") for exactly that case. Take the occurrences the contract
declares, keep those with logged sets, and pick the one whose most recent set is newest; a
movement with occurrences but no prescribed-session logs does not become a mover at all.

`first` and `latest` are the best sets of the earliest and most recent sessions **inside
the window**, and `deltaPct` is `(latest.score - first.score) / first.score`. `points` plots
one value per session in the window — that session's best score — which is what makes the
row's inline sparkline and its delta the same statement rather than two.

`fullLogs` is passed for one reason: `scoreKindFor` is decided over the movement's whole
history, so switching from `12w` to `4w` can never switch a movement's unit and silently
change what the row means.

Grouping by movement rather than by occurrence needs a by-slug series, which
`exercise-series.ts` does not currently expose — `buildExerciseSeries` groups by
`(session_key, exercise_slug)` because the same movement can carry a different rep range in
different sessions. Add a sibling:

```ts
export function buildSeriesForExercise(logs: Logs, exerciseSlug: string): ExerciseSeriesPoint[];
```

and refactor `buildExerciseSeries` to filter its output by session, so there is one
grouping implementation. The module comment must record **why the by-slug variant is
legitimate here specifically**: the range-per-session concern applies to
double-progression, which compares a performance against a prescribed range, and does not
apply to an absolute score in kilograms, reps or seconds. Readiness therefore stays on the
occurrence-grouped path; movers use the by-slug one.

`type` (`reps` vs `time`) comes from the exercise's first entry in `exerciseOccurrences`
order. A movement prescribed as reps in one session and time in another is theoretically
possible and practically absent; taking the first occurrence is the documented behaviour
rather than an unhandled case.

### 3.4 `src/lib/progress/consistency.ts`

```ts
export type WeekBucket = { weekStart: string; count: number };

export type Consistency = {
  /** Monday-start ISO weeks in UTC, contiguous across the window including empty ones. */
  weeks: WeekBucket[];
  sessionCount: number;
  streakWeeks: number;
  deviationCount: number;
  activityCount: number;
  bySessionType: { key: string; name: string; finished: number; deviations: number }[];
};

export function buildConsistency(
  contract: GainContract,
  windowedLogs: Logs,
  fullLogs: Logs,
  now: Date,
): Consistency;
```

**"Finished" means `completed_at` is set, whatever the `status`** — the same test
`sessionTypeStats` already applies. A red-flag stop is a workout the user turned up for and
counts towards consistency and the streak; a workout still open counts towards neither. This
definition is used identically by `consistency.ts`, the window's session count, and the
movers' session counts, so the three can never disagree on the same screen.

Weeks are bucketed Monday-start in **UTC** rather than local time, so the buckets are
deterministic and testable; a workout logged late on a Sunday evening in a positive
timezone offset falls into the following week, which is accepted and stated in the module
comment.

Empty weeks inside the window are present with `count: 0`, so the bar strip shows the gaps
rather than compressing them out of existence.

**The streak is computed over full history, not the window.** A streak is a fact about the
user, not about the currently selected span; windowing it to `4w` would cap it at four and
report a fifteen-week streak as four.

**The streak is measured to the current week or to the last completed one, whichever ends
it.** Consecutive weeks with at least one finished workout, counting back from the current
week if it already holds one, otherwise from the previous week. Without this second clause,
opening the app on a Monday morning reads "streak: 0" and punishes the user for the
calendar.

`bySessionType` reuses `sessionTypeStats`, dropping its `duration` field at the route
boundary. `session-stats.ts` keeps computing duration — History and any future caller are
free to want it — it simply stops being rendered on Progress.

### 3.5 `src/lib/progress/headline.ts`

```ts
export type Headline = {
  /** Distinct exercises with a breakthrough inside the window. */
  newBests: number;
  readyToIncrease: number;
  /** Movements that improved, out of those comparable at all. */
  improved: { count: number; comparable: number };
};

export function buildHeadline(
  contract: GainContract,
  windowedLogs: Logs,
  fullLogs: Logs,
  /** The window's boundary. Breakthroughs are found over full history and then filtered
   * to it — passing the boundary is cheaper than passing the same logs twice. */
  windowStart: string | undefined,
): Headline;
```

`newBests` counts breakthroughs across every exercise whose `at.startedAt` falls inside the
window — `breakthroughs` itself is always computed over full history, and the window filters
its results rather than its input.
`readyToIncrease` counts occurrences whose `doubleProgressionState` is `ready`, computed
over full unwindowed history — matching what the current exercises list already does, and
correct because readiness is a statement about the next session rather than about a span.

`improved` is a fraction with a stated denominator: **`comparable` counts movements with at
least two logged sessions in the window**, and `count` those whose `deltaPct` is positive. A
movement logged once in the window is neither improved nor unimproved and belongs in
neither number — it is excluded from both rather than counted as a failure. The UI renders
the pair ("7 of 12 movements improved") and never the count alone, because a bare "7
improved" hides whether that is out of eight or out of thirty.

## 4. Route surface

| Route | Change |
| ----- | ------ |
| `/plan/[slug]/progress` | Rewritten — the whole feature |
| `/plan/[slug]/progress/exercises/[session]/[exercise]` | Kept. Back link retargeted to `/progress`; window `<select>` replaced by the pills |
| `/plan/[slug]/progress/exercises` | **Deleted** |
| `/plan/[slug]/progress/metrics` | **Deleted** |
| `/plan/[slug]/progress/metrics/[scope]/[key]` | **Deleted** |

Both metric routes exist only to place a window picker above a single sparkline — two taps
for one line. They become compact rows on the hub with the sparkline inline.

The exercises list is pure indirection: its only content is a readiness string, which
belongs on the hub.

The per-exercise detail route stays a route rather than becoming an in-page expansion. It
renders three charts, doubled for a per-side movement, and inlining twenty of those is
precisely the dashboard sprawl ARCHITECTURE §10 forbids. Keeping it a route also keeps it
linkable and leaves `chart-geometry`'s hit-band tap targets working unchanged.

The detail route's window ids change (`full` becomes `all`, `since_version` and
`recent_blocks` are gone), which breaks two `?window=full` URLs in
`e2e/revision-walkthrough.spec.ts`. Those are updated as part of this work.

Deleting `exercises/+page.*` while keeping its `[session]/[exercise]` child leaves
`/progress/exercises` returning 404, which is correct and needs no redirect.

**Incidental fix this forces:** today the exercises list reads unwindowed history while its
children read windowed history. One window control on one screen makes that inconsistency
unrepresentable.

## 5. The screen

Top to bottom at 360 px:

1. **Window pills** — `4w · 12w · 6m · All`, with the sample size beside them:
   "12w · 19 sessions". A calendar window silently lies about density when someone trains
   fortnightly; stating the count is the cheapest possible correction.
2. **What changed** — three stats: `3 new bests`, `4 ready to go up`, `7 of 12 movements
   improved`.
3. **Ready to go up** — the readiness roll-up as a real list: movement, session name,
   `12/12/12`. Per-occurrence, because the range differs per session and the session name
   is what makes the row actionable.
4. **Movers** — one row per movement: name, `6 → 8 kg`, `+33%`, inline sparkline. Top five,
   expandable in place to the full list. Taps through to the detail route.
5. **Consistency** — weekly bars, then `19 sessions · 5-week streak · 4 deviations`, then a
   compact per-session-type table (name, finished, deviations). No charts.
6. **Metrics** — one compact row per `(scope, key)` with its sparkline inline and its
   declared bounds shown for a `scale` metric.

Keying on `(scope, key)` and never the bare key is the existing invariant: a plan may
legally declare `symptoms_during` at both set and session scope, as the fixture does, and
merging them reports a plausible wrong number.

**A set-scope metric is averaged per workout for its hub row.** `numericMetricSeries`
stamps every value with its workout's `started_at`, so a metric answered once per set —
the fixture's set-scope `symptoms_during` — returns several points sharing one x
coordinate. That is already true on today's metric detail page; inlining the chart on a
busier screen makes a vertical stack of dots at one date look like a rendering fault. The
hub plots one point per workout, the mean of that workout's values; `numericMetricSeries`
itself is unchanged, and the aggregation lives in the route's load function.

The plan's declared `scale` bounds are drawn as the chart's y-domain rather than letting
`Sparkline` auto-scale, so a 0-10 symptom score that ranged 2 to 3 renders as a nearly flat
line near the bottom instead of a dramatic climb — the same overstatement §1 objects to in
the duration charts. This is the **one shared-component change** this work makes:
`layoutLineChart` takes an optional `yDomain: [number, number]` and falls back to today's
`Math.min`/`Math.max` over the points when it is absent, and `Sparkline` passes a matching
optional prop through. Every existing call site keeps its current behaviour untouched, and
`tests/progress/chart-geometry.test.ts` gains a case for the explicit domain.

**`MetricRow.svelte` is not reusable here.** Despite the name it is an input component —
one metric prompt for the pre-session gate and the wrap-up sheet — not a display row. The
hub's metric rows are new markup.

The pills are a new control. They are the correct place to break from the "native `<select>`
stays native" note in UI: that note defends a `<select>` for picking one of many values by
name (the substitute picker's whole catalogue), whereas this is a small fixed set of
toggle-like states, which is exactly what the app's pill pattern is for elsewhere. They must
clear the 44 px touch-target floor, which `touch-targets.spec.ts` already sweeps on
`/progress`.

## 6. Honesty rules

Each of these is a case where the easy rendering states something false.

- **A movement with one session in the window** shows its latest value and no delta, and is
  counted in neither half of "improved". A fabricated 0% is worse than an absent one.
- **"Improved" always states its denominator** — "7 of 12", never a bare "7".
- **The new-bests count is of movements, not of breakthroughs**, so a per-side movement
  cannot report two.
- **An archived plan still renders `ArchivedNote`** above the content, as the current hub
  does. Progress is a read route and archiving leaves every read route open
  (`e2e/archive-walkthrough.spec.ts`).
- **An empty window** renders "nothing logged in the last 12 weeks" with a tap through to
  `All` — not four empty chart wells. `EmptyState` exists for exactly this and its own
  comment records that `/progress` used to draw four wells to say nothing.
- **The estimated 1RM is labelled as an estimate** wherever a number derived from it is
  shown, is capped at 12 reps, and never reaches the export.
- **Deltas state their basis.** "+14% since June", not a bare "+14%".
- **A `scale` metric plots against its declared bounds**, not against its own range, so a
  score that moved 2 to 3 on a 0-10 scale does not render as a climb.

## 7. Accepted gaps

- **A movement dropped from the plan vanishes from Progress despite having history.**
  `exerciseOccurrences` walks the contract, not the logs. This is the existing, documented
  substitute-only gap in a second guise; closing it needs its own design decision about
  what prescription a log-only movement is compared against.
- **A chart with more than roughly six points falls under the 44 px tap floor**
  (ARCHITECTURE §14). Unchanged by this work. The movers' inline sparklines are read rather
  than tapped, and the row itself — a full-width link — is the tap target.
- **UTC week bucketing** puts a late Sunday workout in a positive UTC offset into the
  following week.

## 8. Testing

New unit specs under `tests/progress/`:

| Spec | Covers |
| ---- | ------ |
| `progress-window.test.ts` | Window arithmetic with an injected clock; unknown id falls back to the default; `all` carries no `start` |
| `personal-best.test.ts` | All four score kinds; kind decided series-wide, not per set; the Epley rep cap; a longer hold at a fixed load scores higher; per-side scoring; first session is a baseline not a breakthrough; running max established over full history |
| `movers.test.ts` | Grouping by slug across two sessions; recency ordering with breakthroughs first; single-session rows carry no delta and sort last; `linkSessionKey` never names a session the movement is not prescribed in, including when the newest set was logged as a substitute |
| `consistency.test.ts` | Monday-start UTC buckets; empty weeks present; a red-flag-stopped workout counts as finished; streak measured to last completed week; streak spans the window boundary |
| `headline.test.ts` | New bests counted per movement, not per side; `comparable` excludes single-session movements; a window where nothing is comparable |

Existing specs to update:

- `e2e/progress-walkthrough.spec.ts` — rewritten against the new single screen.
- `e2e/revision-walkthrough.spec.ts` — two `?window=full` URLs become `?window=all`.
- `tests/progress/exercise-series.test.ts` — covers the new `buildSeriesForExercise`.
- `tests/progress/chart-geometry.test.ts` — covers `layoutLineChart`'s optional `yDomain`,
  including that omitting it preserves today's auto-scaling exactly.
- `e2e/touch-targets.spec.ts` and `e2e/theme-coverage.spec.ts` already sweep `/progress`
  only, so they need no route-list change; the pills must pass the touch sweep.

Assertions on charts must prove the data path fired, per CLAUDE.md: `Sparkline` renders its
`<svg aria-label>` in both the populated and the empty branch, so an assertion has to reach
`.dot` or `rect`. The same applies to the new sections — assert on a mover row's delta text,
not on the section heading.

A throwaway spec under `e2e/` takes a 360 px screenshot for a visual check before the work
is called done, and is deleted before committing.

## 9. Documentation to fold back

In the same commit that lands the work:

- **ARCHITECTURE §10** — rewritten. It currently describes per-session duration and
  completion rate as the per-session-type offering; that is what this work removes. Add the
  line that the estimated 1RM is in-app only and must not enter the export.
- **UI** — the "three progress window pickers" reference in the keyboard-cost note and in
  the native-`<select>` note both name controls that no longer exist; the pills need their
  own short entry saying why they are the exception.
- **CLAUDE.md** — the area table's Progress row, and the route counts in the e2e paragraph.
- **This file** — deleted.

## 10. Out of scope

No schema change. No change to `src/lib/export/`. No horizontal paging or downsampling for
dense charts (ARCHITECTURE §14 keeps that open). No attempt to close the substitute-only
occurrence gap. Duration is not re-homed anywhere new — History already shows it per
workout. Total volume gains no new home either: the per-exercise detail page's existing
`BarChart` is the only place it appears, and the headline stat it was proposed for is
"movements improved" instead (§2).
