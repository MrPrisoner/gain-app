# Progress Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GAIN's four-route Progress feature, whose landing screen leads with session duration, with a two-route feature whose landing screen answers "what changed and how did I improve".

**Architecture:** Five new pure modules under `src/lib/progress/` compute the screen; the route stays thin and composes them, per the repo's standing rule that logic worth testing lives in `$lib`. Nothing in `src/lib/export/` changes. One shared component (`Sparkline`, via `chart-geometry`) gains an optional explicit y-domain; everything else is new markup or deletion.

**Tech Stack:** TypeScript 6 (strict), SvelteKit with Svelte 5 runes, Vitest 4 (`environment: "node"`, no DOM), Playwright for anything that renders.

**Spec:** [`docs/superpowers/specs/2026-09-05-progress-redesign-design.md`](../specs/2026-09-05-progress-redesign-design.md) — read it before starting; this plan argues from it and does not restate its reasoning.

## Global Constraints

- **Node 24 LTS.** Run `npm run verify` before declaring any task done — never piped through `head`/`tail`, because the shell is fish and a pipeline reports the filter's exit status, hiding a failure. Redirect to a file and read it.
- **Zod 4, Svelte 5 runes.** No `export let`, no `createEventDispatcher`, no `z.object().strict()`. Every component in this plan uses `$props`/`$state`/`$derived`.
- **No literal control characters** anywhere — write the escape (a backslash-u-zero-zero-zero-zero sequence), never the character itself. `npm run check:chars` enforces it across all tracked text, Markdown included.
- **Icons** come from `~icons/lucide/*` only. Never `@iconify/svelte` (it fetches at runtime; offline is a hard requirement).
- **No inline `<script>` or `<style>` elements** — CSP is `script-src 'self' 'nonce-…'` and `style-src 'self'`. Svelte's `style:` directives are fine (`style-src-attr 'unsafe-inline'`).
- **Colour:** outside the session runner, `--red`/`--amber`/`--green` carry their ordinary meanings and are allowed. Progress is outside the runner.
- **Touch targets:** every `a[href]`/`button` on `/progress` must clear `min-height: 2.75rem` — `e2e/touch-targets.spec.ts` sweeps that route.
- **Chart assertions must prove the data path fired.** `Sparkline` renders its `<svg aria-label>` in both the populated and empty branch, so assert on `.dot` or `rect`, never on the container.
- **Prettier** runs on edited `.ts`/`.svelte` files (`npx prettier --write <file>` if the hook is not active). `docs/` is `.prettierignore`d — do not format this file or the spec.
- **Commit style:** `type(scope): imperative summary`, lowercase, no trailing period, body in prose paragraphs, closing with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/progress/progress-window.ts` | **new** — the `4w/12w/6m/All` pills' spans, clock injected |
| `src/lib/progress/personal-best.ts` | **new** — the one score per prescription type; breakthrough detection; score formatting |
| `src/lib/progress/movers.ts` | **new** — per-movement improvement over a window |
| `src/lib/progress/consistency.ts` | **new** — weekly buckets, streak, per-session-type counts |
| `src/lib/progress/headline.ts` | **new** — the three "what changed" numbers |
| `src/lib/progress/exercise-series.ts` | **modify** — extract `buildSeriesForExercise`; `buildExerciseSeries` filters it |
| `src/lib/progress/chart-geometry.ts` | **modify** — optional `yDomain` on `layoutLineChart` |
| `src/lib/progress/metric-series.ts` | **modify** — add `hubMetricRows` (per-workout aggregation + declared bounds) |
| `src/lib/components/Sparkline.svelte` | **modify** — optional `yDomain` prop passed through |
| `src/lib/components/WindowPills.svelte` | **new** — the shared pill row, used by both surviving routes |
| `src/routes/plan/[slug]/progress/+page.server.ts` | **rewrite** — composes the five modules |
| `src/routes/plan/[slug]/progress/+page.svelte` | **rewrite** — the whole feature, six sections |
| `src/routes/plan/[slug]/progress/exercises/[session]/[exercise]/+page.*` | **modify** — pills, back link, window ids |
| `src/routes/plan/[slug]/progress/exercises/+page.*` | **delete** |
| `src/routes/plan/[slug]/progress/metrics/**` | **delete** |

---

### Task 1: Progress windows

**Files:**
- Create: `src/lib/progress/progress-window.ts`
- Test: `tests/progress/progress-window.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ProgressWindowId`, `ProgressWindow` (`{ id, label, start? }`), `DEFAULT_PROGRESS_WINDOW`, `progressWindowOptions(now: Date): ProgressWindow[]`, `resolveProgressWindow(id: string | null, now: Date): ProgressWindow`.

`ProgressWindow` is structurally assignable to `export/bundle.ts`'s `ExportWindow` (`{ label: string; start?: string; end?: string }`), which is what lets `filterLogsToWindow` take it unchanged. Do not widen `ExportWindow` and do not import from `export/windows.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/progress/progress-window.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROGRESS_WINDOW,
  progressWindowOptions,
  resolveProgressWindow,
} from "../../src/lib/progress/progress-window";

const NOW = new Date("2026-09-05T10:00:00Z");

describe("progressWindowOptions", () => {
  it("offers four spans in pill order, labelled for a phone", () => {
    expect(progressWindowOptions(NOW).map((o) => [o.id, o.label])).toEqual([
      ["4w", "4w"],
      ["12w", "12w"],
      ["26w", "6m"],
      ["all", "All"],
    ]);
  });

  it("dates each bounded span back from the injected clock", () => {
    const byId = new Map(progressWindowOptions(NOW).map((o) => [o.id, o]));
    expect(byId.get("4w")?.start).toBe("2026-08-08T10:00:00.000Z");
    expect(byId.get("12w")?.start).toBe("2026-06-13T10:00:00.000Z");
    expect(byId.get("26w")?.start).toBe("2026-03-07T10:00:00.000Z");
  });

  it("gives `all` no start, so it filters nothing", () => {
    expect(progressWindowOptions(NOW).find((o) => o.id === "all")?.start).toBeUndefined();
  });
});

describe("resolveProgressWindow", () => {
  it("defaults to 12w rather than to the first option", () => {
    expect(DEFAULT_PROGRESS_WINDOW).toBe("12w");
    expect(resolveProgressWindow(null, NOW).id).toBe("12w");
  });

  it("falls back to the default for an unrecognised id instead of failing", () => {
    // Deliberately unlike the export route, which must fail(400): nothing on a chart
    // screen leaves the app, so a silent substitution mislabels nothing.
    expect(resolveProgressWindow("since_version", NOW).id).toBe("12w");
    expect(resolveProgressWindow("", NOW).id).toBe("12w");
  });

  it("resolves each offered id to itself", () => {
    for (const option of progressWindowOptions(NOW)) {
      expect(resolveProgressWindow(option.id, NOW).id).toBe(option.id);
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/progress/progress-window.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/progress/progress-window`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/progress/progress-window.ts`:

```ts
/**
 * The Progress screen's own time control, deliberately separate from
 * `export/windows.ts`.
 *
 * The export windows exist to serve the reviewing AI: `since_version` is the span it has
 * not seen yet, and every label is prose written into the bundle's H1. Progress has a
 * different reader and a different question. Defaulting it to `since_version` meant a user
 * who revised their plan on Tuesday opened Progress on Wednesday, saw one data point, and
 * read it as "you have made no progress" rather than "you changed the window".
 *
 * `1w` is deliberately not offered. Most plans run a given session once or twice a week,
 * so a one-week window renders one point per session type and an empty movers list — and
 * it is the pill a user reaches for first. A default that can legitimately render nothing
 * is a broken default.
 *
 * There is no notion of a preceding period. An earlier draft carried one so a volume delta
 * could compare the window against the equal-length span before it; volume was cut from
 * the headline (it falls when a double-progression load increase succeeds), which removed
 * the only caller and with it a class of wrong answers — a user five weeks in, on `4w`,
 * would have been compared against a period holding one week of work. Every comparison
 * this screen makes is now within one window.
 *
 * Pure, with the clock injected, like everything else under `src/lib/progress/`.
 */

export type ProgressWindowId = "4w" | "12w" | "26w" | "all";

/** Structurally assignable to `export/bundle.ts`'s `ExportWindow`, which is what lets
 * `filterLogsToWindow` take one of these unchanged. */
export type ProgressWindow = {
  id: ProgressWindowId;
  /** UI label. `26w` reads as arithmetic homework, so it shows as `6m`; the shorter spans
   * stay in weeks, which is how training cadence is actually counted. */
  label: string;
  /** ISO 8601. Absent for `all`. */
  start?: string;
};

/** Long enough to hold ~24 occurrences of a twice-weekly movement, recent enough to be
 * about the user now. */
export const DEFAULT_PROGRESS_WINDOW: ProgressWindowId = "12w";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const SPANS: { id: ProgressWindowId; label: string; weeks: number | null }[] = [
  { id: "4w", label: "4w", weeks: 4 },
  { id: "12w", label: "12w", weeks: 12 },
  { id: "26w", label: "6m", weeks: 26 },
  { id: "all", label: "All", weeks: null },
];

export function progressWindowOptions(now: Date): ProgressWindow[] {
  return SPANS.map(({ id, label, weeks }) =>
    weeks === null
      ? { id, label }
      : { id, label, start: new Date(now.getTime() - weeks * WEEK_MS).toISOString() },
  );
}

/**
 * Never undefined. A hand-edited `?window=` resolves to the default rather than erroring.
 */
export function resolveProgressWindow(id: string | null, now: Date): ProgressWindow {
  const options = progressWindowOptions(now);
  // `SPANS` always contains DEFAULT_PROGRESS_WINDOW, so the fallback is never undefined —
  // the assertion documents that invariant rather than papering over a real gap.
  return options.find((o) => o.id === id) ?? options.find((o) => o.id === DEFAULT_PROGRESS_WINDOW)!;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/progress/progress-window.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify and commit**

```bash
npx prettier --write src/lib/progress/progress-window.ts tests/progress/progress-window.test.ts
npm run verify > /tmp/verify.log 2>&1; echo $status; tail -20 /tmp/verify.log
git add src/lib/progress/progress-window.ts tests/progress/progress-window.test.ts
git commit -m "feat(progress): add the progress screen's own time windows

The export windows serve the reviewing AI, so their default is the span it has
not seen yet. Progress has a different reader: defaulting it to since_version
shows a user who revised on Tuesday a single data point on Wednesday, which
reads as no progress rather than a changed window. Four spans, defaulting to
twelve weeks, and no 1w — most plans run a session once or twice a week, so a
one-week window renders an empty screen and it is the pill a user reaches for
first.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: An explicit y-domain for line charts

**Files:**
- Modify: `src/lib/progress/chart-geometry.ts:40-62`
- Modify: `src/lib/components/Sparkline.svelte`
- Test: `tests/progress/chart-geometry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `layoutLineChart(points, width, height, padding, yDomain?: readonly [number, number])`; `Sparkline` gains an optional `yDomain?: [number, number]` prop.

Every existing call site omits the parameter and must keep today's behaviour exactly. This exists so a `scale` metric plots against its plan-declared bounds — a 0-10 symptom score that moved 2 to 3 must not render as a climb, which is the same overstatement the duration charts were guilty of.

- [ ] **Step 1: Write the failing test**

Append to `tests/progress/chart-geometry.test.ts`:

```ts
describe("layoutLineChart with an explicit y-domain", () => {
  const points = [
    { x: 0, y: 2 },
    { x: 1, y: 3 },
  ];

  it("scales against the given domain, not the data's own range", () => {
    // Domain 0-10 in a 120-tall chart with 20 padding: the plot area is 80 tall, so
    // y=2 sits 16px up from the baseline (100) and y=3 sits 24px up.
    const { plotted } = layoutLineChart(points, 320, 120, 20, [0, 10]);
    expect(plotted[0]?.cy).toBeCloseTo(84);
    expect(plotted[1]?.cy).toBeCloseTo(76);
  });

  it("auto-scales exactly as before when the domain is omitted", () => {
    const { plotted } = layoutLineChart(points, 320, 120, 20);
    expect(plotted[0]?.cy).toBeCloseTo(100);
    expect(plotted[1]?.cy).toBeCloseTo(20);
  });

  it("keeps a flat series on the baseline rather than dividing by zero", () => {
    const { plotted } = layoutLineChart([{ x: 0, y: 5 }], 320, 120, 20, [5, 5]);
    expect(Number.isFinite(plotted[0]?.cy ?? NaN)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/progress/chart-geometry.test.ts`
Expected: FAIL — the first case reports the auto-scaled `cy` (100 and 20), because the fifth argument is ignored.

- [ ] **Step 3: Write the implementation**

In `src/lib/progress/chart-geometry.ts`, change the signature and the two bounds:

```ts
export function layoutLineChart(
  points: readonly ChartPoint[],
  width: number,
  height: number,
  padding: number,
  /** Plot against these bounds instead of the data's own range. A plan-declared `scale`
   * metric passes its declared min/max, so a 2-to-3 movement on a 0-10 scale renders as
   * the near-flat line it is rather than as a climb. Omitted everywhere else, which
   * preserves the auto-scaling every other chart relies on. */
  yDomain?: readonly [number, number],
): { plotted: PlottedPoint[]; path: string } {
  if (points.length === 0) return { plotted: [], path: "" };

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = yDomain ? yDomain[0] : Math.min(...ys);
  const yMax = yDomain ? yDomain[1] : Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
```

Leave the rest of the function unchanged.

In `src/lib/components/Sparkline.svelte`, add the prop and thread it through:

```svelte
  let {
    points,
    width = 320,
    height = 120,
    ariaLabel = "trend chart",
    formatPointLabel,
    formatReadout,
    emptyLabel = "No data yet",
    yDomain,
  }: {
    points: ChartPoint[];
    width?: number;
    height?: number;
    ariaLabel?: string;
    formatPointLabel: (point: ChartPoint, index: number, all: ChartPoint[]) => string | undefined;
    formatReadout: (point: ChartPoint) => string;
    emptyLabel?: string;
    /** Plot against fixed bounds rather than the series' own range. */
    yDomain?: [number, number];
  } = $props();

  const padding = 20;
  const layout = $derived(layoutLineChart(points, width, height, padding, yDomain));
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/progress/chart-geometry.test.ts`
Expected: PASS — including every pre-existing case, which proves the omitted-parameter path is unchanged.

- [ ] **Step 5: Verify and commit**

```bash
npx prettier --write src/lib/progress/chart-geometry.ts src/lib/components/Sparkline.svelte tests/progress/chart-geometry.test.ts
npm run verify > /tmp/verify.log 2>&1; echo $status; tail -20 /tmp/verify.log
git add src/lib/progress/chart-geometry.ts src/lib/components/Sparkline.svelte tests/progress/chart-geometry.test.ts
git commit -m "feat(progress): let a line chart plot against explicit bounds

Sparkline auto-scales its y-domain, which is right for an open-ended quantity
and wrong for a declared scale: a 0-10 symptom score that moved from 2 to 3
renders as a dramatic climb when the axis is fitted to the data. layoutLineChart
now takes an optional domain and falls back to the data's own range when it is
absent, so every existing call site is untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: A by-movement exercise series

**Files:**
- Modify: `src/lib/progress/exercise-series.ts:26-62`
- Test: `tests/progress/exercise-series.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildSeriesForExercise(logs: Logs, exerciseSlug: string): ExerciseSeriesPoint[]`. `buildExerciseSeries(logs, sessionKey, exerciseSlug)` keeps its exact current signature and behaviour, now implemented as a filter over the new function.

- [ ] **Step 1: Write the failing test**

Append to `tests/progress/exercise-series.test.ts`:

```ts
describe("buildSeriesForExercise", () => {
  it("collects a movement's sessions across every session type, chronologically", () => {
    // goblet-squat is prescribed in session A ([8,12]) and session D ([12,15]) of the
    // fixture. buildExerciseSeries deliberately keeps those apart, because
    // double-progression compares a performance against a prescribed range. An absolute
    // score in kg, reps or seconds has no such dependency, so movers group by movement.
    const series = buildSeriesForExercise(logs, "goblet-squat");
    expect(series.map((p) => p.workoutId)).toEqual(["w-a1", "w-d1", "w-a2"]);
  });

  it("still splits by session when asked, over the same grouping code", () => {
    expect(buildExerciseSeries(logs, "A", "goblet-squat").map((p) => p.workoutId)).toEqual([
      "w-a1",
      "w-a2",
    ]);
    expect(buildExerciseSeries(logs, "D", "goblet-squat").map((p) => p.workoutId)).toEqual([
      "w-d1",
    ]);
  });
});
```

Add the fixture this describes to the top of the file if the existing `logs` const does not already carry a session-D goblet squat — the three workouts must be `w-a1` (session A, earliest), `w-d1` (session D, middle) and `w-a2` (session A, latest), each with at least one `goblet-squat` set:

```ts
const logs: Logs = {
  ...EMPTY_LOGS,
  workouts: [
    { id: "w-a1", session_key: "A", started_at: "2026-08-03T07:00:00Z", completed_at: "2026-08-03T07:40:00Z", status: "completed" },
    { id: "w-d1", session_key: "D", started_at: "2026-08-07T07:00:00Z", completed_at: "2026-08-07T07:40:00Z", status: "completed" },
    { id: "w-a2", session_key: "A", started_at: "2026-08-10T07:00:00Z", completed_at: "2026-08-10T07:40:00Z", status: "completed" },
  ],
  set_logs: [
    { id: "s1", workout_id: "w-a1", exercise_slug: "goblet-squat", set_no: 1, reps: 10, weight_kg: 6 },
    { id: "s2", workout_id: "w-d1", exercise_slug: "goblet-squat", set_no: 1, reps: 13, weight_kg: 6 },
    { id: "s3", workout_id: "w-a2", exercise_slug: "goblet-squat", set_no: 1, reps: 12, weight_kg: 6 },
  ],
};
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/progress/exercise-series.test.ts`
Expected: FAIL — `buildSeriesForExercise` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/lib/progress/exercise-series.ts`, replace the body of `buildExerciseSeries` with a filter and lift the grouping into the new function:

```ts
/**
 * Every workout a movement was logged in, chronological, regardless of session type.
 *
 * The module's `(session_key, exercise_slug)` grouping exists because the same movement
 * can carry a different rep range in different sessions, and comparing a performance
 * against the wrong range is a silent wrong answer. That concern belongs to
 * double-progression, which compares against a prescribed range; it does not apply to an
 * absolute score in kilograms, reps or seconds. Readiness therefore stays on the
 * occurrence-grouped path below, and `movers.ts` uses this one.
 */
export function buildSeriesForExercise(
  logs: Logs,
  exerciseSlug: string,
): ExerciseSeriesPoint[] {
  const workoutById = new Map(logs.workouts.map((w) => [w.id, w]));

  const byWorkout = new Map<string, SetLog[]>();
  for (const set of logs.set_logs) {
    if (set.exercise_slug !== exerciseSlug) continue;
    const list = byWorkout.get(set.workout_id) ?? [];
    list.push(set);
    byWorkout.set(set.workout_id, list);
  }

  const points: ExerciseSeriesPoint[] = [];
  for (const [workoutId, sets] of byWorkout) {
    const workout = workoutById.get(workoutId);
    if (!workout) continue;
    points.push({
      workoutId,
      startedAt: workout.started_at,
      sets: [...sets].sort(
        (a, b) => a.set_no - b.set_no || (a.side ?? "").localeCompare(b.side ?? ""),
      ),
    });
  }

  return points.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** One point per workout of THIS session type the exercise was logged in, chronological.
 * `renderExerciseSets` (export/summary.ts) accepts `.sets` directly — no adapter needed. */
export function buildExerciseSeries(
  logs: Logs,
  sessionKey: string,
  exerciseSlug: string,
): ExerciseSeriesPoint[] {
  const sessionWorkoutIds = new Set(
    logs.workouts.filter((w) => w.session_key === sessionKey).map((w) => w.id),
  );
  return buildSeriesForExercise(logs, exerciseSlug).filter((p) =>
    sessionWorkoutIds.has(p.workoutId),
  );
}
```

- [ ] **Step 4: Run the full progress suite and confirm nothing regressed**

Run: `npx vitest run tests/progress/ tests/export.test.ts tests/summary.test.ts`
Expected: PASS — `buildExerciseSeries`'s existing callers (the detail route, `export/summary.ts`) must be unaffected.

- [ ] **Step 5: Verify and commit**

```bash
npx prettier --write src/lib/progress/exercise-series.ts tests/progress/exercise-series.test.ts
npm run verify > /tmp/verify.log 2>&1; echo $status; tail -20 /tmp/verify.log
git add src/lib/progress/exercise-series.ts tests/progress/exercise-series.test.ts
git commit -m "feat(progress): group an exercise series by movement as well as by session

The (session, exercise) grouping exists because the same movement can carry a
different rep range in two sessions, and double-progression compares against a
prescribed range. An absolute score in kilograms, reps or seconds carries no
such dependency, so the progress hub's movers list wants the movement whole.
buildExerciseSeries keeps its signature and is now a filter over the new
function, so there is one grouping implementation rather than two.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The score, and what a new best is

**Files:**
- Create: `src/lib/progress/personal-best.ts`
- Test: `tests/progress/personal-best.test.ts`

**Interfaces:**
- Consumes: `ExerciseSeriesPoint` from Task 3.
- Produces: `ScoreKind`, `BestSet`, `Breakthrough`, `EPLEY_REP_CAP`, `scoreKindFor(series, type)`, `bestSetsBySession(series, kind, filter?)`, `breakthroughs(series, exerciseSlug, type, perSide)`, `formatScore(best)`.

`filter` is `(set: SetLog) => boolean`. Breakthrough detection passes a side filter; `movers.ts` passes none, so a mover row summarises both sides while the detail route keeps them apart.

- [ ] **Step 1: Write the failing test**

Create `tests/progress/personal-best.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ExerciseSeriesPoint } from "../../src/lib/progress/exercise-series";
import {
  bestSetsBySession,
  breakthroughs,
  formatScore,
  scoreKindFor,
} from "../../src/lib/progress/personal-best";

function session(
  id: string,
  startedAt: string,
  sets: ExerciseSeriesPoint["sets"],
): ExerciseSeriesPoint {
  return { workoutId: id, startedAt, sets };
}

describe("scoreKindFor", () => {
  it("picks e1rm for a loaded rep movement and reps for a bodyweight one", () => {
    const loaded = [session("w1", "2026-08-01T07:00:00Z", [
      { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, reps: 10, weight_kg: 6 },
    ])];
    const bodyweight = [session("w1", "2026-08-01T07:00:00Z", [
      { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, reps: 10 },
    ])];
    expect(scoreKindFor(loaded, "reps")).toBe("e1rm");
    expect(scoreKindFor(bodyweight, "reps")).toBe("reps");
  });

  it("picks loaded_hold for a loaded timed movement and seconds for a bodyweight one", () => {
    const loaded = [session("w1", "2026-08-01T07:00:00Z", [
      { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, duration_s: 30, weight_kg: 4 },
    ])];
    const bodyweight = [session("w1", "2026-08-01T07:00:00Z", [
      { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, duration_s: 30 },
    ])];
    expect(scoreKindFor(loaded, "time")).toBe("loaded_hold");
    expect(scoreKindFor(bodyweight, "time")).toBe("seconds");
  });

  it("decides once for the whole series, so one bodyweight session cannot switch the unit", () => {
    const mixed = [
      session("w1", "2026-08-01T07:00:00Z", [
        { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, reps: 10, weight_kg: 6 },
      ]),
      session("w2", "2026-08-08T07:00:00Z", [
        { id: "b", workout_id: "w2", exercise_slug: "x", set_no: 1, reps: 14 },
      ]),
    ];
    expect(scoreKindFor(mixed, "reps")).toBe("e1rm");
  });
});

describe("bestSetsBySession", () => {
  it("caps reps at 12 inside the Epley estimate", () => {
    // Uncapped, 6 kg x 20 would score 10.0 and beat 8 kg x 8 (10.13) only just; at
    // reps far above the formula's fitted range it would sail past genuinely heavier
    // work. Capped, 6 kg x 20 scores as 6 kg x 12 = 8.4.
    const series = [
      session("w1", "2026-08-01T07:00:00Z", [
        { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, reps: 20, weight_kg: 6 },
      ]),
    ];
    expect(bestSetsBySession(series, "e1rm")[0]?.score).toBeCloseTo(8.4);
  });

  it("scores a loaded hold as weight x seconds, so a longer hold at one load counts", () => {
    const series = [
      session("w1", "2026-08-01T07:00:00Z", [
        { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, duration_s: 30, weight_kg: 8 },
      ]),
      session("w2", "2026-08-08T07:00:00Z", [
        { id: "b", workout_id: "w2", exercise_slug: "x", set_no: 1, duration_s: 45, weight_kg: 8 },
      ]),
    ];
    const scores = bestSetsBySession(series, "loaded_hold").map((b) => b.score);
    expect(scores).toEqual([240, 360]);
  });

  it("takes the best set of each session and skips sessions with nothing scoreable", () => {
    const series = [
      session("w1", "2026-08-01T07:00:00Z", [
        { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, reps: 8 },
        { id: "b", workout_id: "w1", exercise_slug: "x", set_no: 2, reps: 11 },
      ]),
      session("w2", "2026-08-08T07:00:00Z", [
        { id: "c", workout_id: "w2", exercise_slug: "x", set_no: 1, duration_s: 40 },
      ]),
    ];
    expect(bestSetsBySession(series, "reps").map((b) => b.score)).toEqual([11]);
  });

  it("honours a filter, which is how a per-side movement is scored per side", () => {
    const series = [
      session("w1", "2026-08-01T07:00:00Z", [
        { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, side: "left", reps: 9 },
        { id: "b", workout_id: "w1", exercise_slug: "x", set_no: 1, side: "right", reps: 12 },
      ]),
    ];
    expect(bestSetsBySession(series, "reps", (s) => s.side === "left")[0]?.score).toBe(9);
  });
});

describe("breakthroughs", () => {
  const rising = [
    session("w1", "2026-08-01T07:00:00Z", [
      { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, reps: 10 },
    ]),
    session("w2", "2026-08-08T07:00:00Z", [
      { id: "b", workout_id: "w2", exercise_slug: "x", set_no: 1, reps: 12 },
    ]),
    session("w3", "2026-08-15T07:00:00Z", [
      { id: "c", workout_id: "w3", exercise_slug: "x", set_no: 1, reps: 11 },
    ]),
    session("w4", "2026-08-22T07:00:00Z", [
      { id: "d", workout_id: "w4", exercise_slug: "x", set_no: 1, reps: 13 },
    ]),
  ];

  it("reports a session that beats every session before it", () => {
    expect(breakthroughs(rising, "x", "reps", false).map((b) => b.at.workoutId)).toEqual([
      "w2",
      "w4",
    ]);
  });

  it("treats the first logged session as a baseline, never a breakthrough", () => {
    const single = [rising[0]!];
    expect(breakthroughs(single, "x", "reps", false)).toEqual([]);
  });

  it("carries the best that stood before it, for a was-this line", () => {
    const first = breakthroughs(rising, "x", "reps", false)[0];
    expect(first?.previous.score).toBe(10);
  });

  it("scores each side of a per-side movement separately", () => {
    const perSide = [
      session("w1", "2026-08-01T07:00:00Z", [
        { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, side: "left", reps: 8 },
        { id: "b", workout_id: "w1", exercise_slug: "x", set_no: 1, side: "right", reps: 8 },
      ]),
      session("w2", "2026-08-08T07:00:00Z", [
        { id: "c", workout_id: "w2", exercise_slug: "x", set_no: 1, side: "left", reps: 10 },
        { id: "d", workout_id: "w2", exercise_slug: "x", set_no: 1, side: "right", reps: 8 },
      ]),
    ];
    const found = breakthroughs(perSide, "x", "reps", true);
    expect(found.map((b) => b.side)).toEqual(["left"]);
  });
});

describe("formatScore", () => {
  it("renders each kind in the unit the user logged", () => {
    expect(
      formatScore({
        score: 8.4, kind: "e1rm", weightKg: 6, reps: 12,
        workoutId: "w1", startedAt: "2026-08-01T07:00:00Z",
      }),
    ).toBe("6 kg × 12");
    expect(
      formatScore({
        score: 360, kind: "loaded_hold", weightKg: 8, durationS: 45,
        workoutId: "w1", startedAt: "2026-08-01T07:00:00Z",
      }),
    ).toBe("8 kg × 45s");
    expect(
      formatScore({
        score: 12, kind: "reps", reps: 12,
        workoutId: "w1", startedAt: "2026-08-01T07:00:00Z",
      }),
    ).toBe("12 reps");
    expect(
      formatScore({
        score: 45, kind: "seconds", durationS: 45,
        workoutId: "w1", startedAt: "2026-08-01T07:00:00Z",
      }),
    ).toBe("45s");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/progress/personal-best.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/progress/personal-best`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/progress/personal-best.ts`:

```ts
/**
 * One score per movement, so bodyweight and timed work are not second-class citizens of
 * a load-centric screen — roughly half the fixture is bodyweight or timed, and a headline
 * built on tonnage reads as flat or zero for all of it.
 *
 *   load + reps   estimated 1RM, Epley, reps capped at 12
 *   load + time   weight x seconds
 *   reps only     best reps
 *   time only     best seconds
 *
 * **The estimated 1RM never leaves the app.** `src/lib/export/` neither imports this
 * module nor reproduces its arithmetic. The export's progress summary is a number the
 * reviewing AI trusts and does not check (CLAUDE.md), and an estimate derived from a
 * formula the plan never declared has no business in it.
 *
 * Epley is a straight line fitted to low-rep work and drifts badly above roughly twelve
 * reps; the fixture prescribes ranges running to fifteen. Capping makes the estimate
 * conservative exactly where it is least trustworthy, so a long light set cannot outrank
 * genuinely heavier work.
 *
 * A loaded hold scores `weight x seconds` rather than load with duration as a tiebreak. A
 * breakthrough is a score strictly exceeding the previous best, and a tiebreak is a
 * comparator rather than a scalar — under the tiebreak draft, holding 8 kg for 45s after
 * 30s at the same load recorded no improvement at all.
 */

import type { SetLog } from "../logs/types";
import type { ExerciseSeriesPoint } from "./exercise-series";

export type ScoreKind = "e1rm" | "loaded_hold" | "reps" | "seconds";

/** Above this the Epley estimate is not worth trusting; see the module comment. */
export const EPLEY_REP_CAP = 12;

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
  /** The best that stood before it. Always present: the first logged session is a
   * baseline, never a breakthrough. */
  previous: BestSet;
};

/**
 * Decided once for a whole series, never per set — `topSetChartPoints` already holds this
 * discipline for the same reason: a single bodyweight session inside an otherwise-loaded
 * series must not switch the unit mid-series.
 */
export function scoreKindFor(
  series: readonly ExerciseSeriesPoint[],
  type: "reps" | "time",
): ScoreKind {
  const loaded = series.some((p) => p.sets.some((s) => s.weight_kg !== undefined));
  if (type === "time") return loaded ? "loaded_hold" : "seconds";
  return loaded ? "e1rm" : "reps";
}

function scoreOf(set: SetLog, kind: ScoreKind): number | undefined {
  switch (kind) {
    case "e1rm":
      if (set.weight_kg === undefined || set.reps === undefined) return undefined;
      return set.weight_kg * (1 + Math.min(set.reps, EPLEY_REP_CAP) / 30);
    case "loaded_hold":
      if (set.weight_kg === undefined || set.duration_s === undefined) return undefined;
      return set.weight_kg * set.duration_s;
    case "reps":
      return set.reps;
    case "seconds":
      return set.duration_s;
  }
}

/**
 * The best set of each session, chronological. A session with nothing scoreable under
 * `kind` — a bodyweight logging of an otherwise-loaded movement, a filtered-out side —
 * yields no point at all rather than a zero, which would draw a false trough.
 */
export function bestSetsBySession(
  series: readonly ExerciseSeriesPoint[],
  kind: ScoreKind,
  filter?: (set: SetLog) => boolean,
): BestSet[] {
  const bests: BestSet[] = [];
  for (const point of series) {
    let best: BestSet | undefined;
    for (const set of point.sets) {
      if (filter && !filter(set)) continue;
      const score = scoreOf(set, kind);
      if (score === undefined) continue;
      if (best && score <= best.score) continue;
      best = {
        score,
        kind,
        weightKg: set.weight_kg,
        reps: set.reps,
        durationS: set.duration_s,
        side: set.side,
        workoutId: point.workoutId,
        startedAt: point.startedAt,
      };
    }
    if (best) bests.push(best);
  }
  return bests;
}

/**
 * Every session that beat every session before it.
 *
 * The running max is established over whatever series it is given, which callers pass
 * unwindowed: a personal best must beat everything before it, not merely everything since
 * the window opened. Callers then keep the breakthroughs whose `at.startedAt` falls inside
 * the window. This also keeps the count meaningful on `All`, where a naive
 * before-window/after-window comparison has nothing to compare against.
 */
export function breakthroughs(
  series: readonly ExerciseSeriesPoint[],
  exerciseSlug: string,
  type: "reps" | "time",
  perSide: boolean,
): Breakthrough[] {
  const kind = scoreKindFor(series, type);
  const sides: ("left" | "right" | undefined)[] = perSide ? ["left", "right"] : [undefined];

  const found: Breakthrough[] = [];
  for (const side of sides) {
    const bests = bestSetsBySession(series, kind, (s) => (s.side ?? undefined) === side);
    let standing = bests[0];
    for (const best of bests.slice(1)) {
      if (standing && best.score > standing.score) {
        found.push({ exerciseSlug, side, at: best, previous: standing });
        standing = best;
      }
    }
  }
  return found.sort((a, b) => a.at.startedAt.localeCompare(b.at.startedAt));
}

/** What the user logged, in their own units — never the score, which is an internal
 * comparator and, for `e1rm`, an estimate. */
export function formatScore(best: BestSet): string {
  switch (best.kind) {
    case "e1rm":
      return `${best.weightKg} kg × ${best.reps}`;
    case "loaded_hold":
      return `${best.weightKg} kg × ${best.durationS}s`;
    case "reps":
      return `${best.reps} reps`;
    case "seconds":
      return `${best.durationS}s`;
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/progress/personal-best.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Verify and commit**

```bash
npx prettier --write src/lib/progress/personal-best.ts tests/progress/personal-best.test.ts
npm run verify > /tmp/verify.log 2>&1; echo $status; tail -20 /tmp/verify.log
git add src/lib/progress/personal-best.ts tests/progress/personal-best.test.ts
git commit -m "feat(progress): score every prescription type on one scale

Roughly half the fixture is bodyweight or timed, so a load-centric measure of
improvement reads as flat or zero for half the plan. Four score kinds, chosen
once per series so a single bodyweight session cannot switch the unit
mid-series: an Epley estimate for loaded reps, weight times seconds for a
loaded hold, best reps, best seconds.

Reps are capped at twelve inside the estimate because Epley is fitted to
low-rep work and the fixture prescribes ranges to fifteen. A loaded hold scores
weight times seconds rather than load with duration as a tiebreak, because a
breakthrough is a score strictly exceeding the previous best and a tiebreak is
a comparator, not a scalar — the tiebreak draft gave no credit at all for
holding the same load longer.

The estimate stays in the app. Nothing under src/lib/export imports this module.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Movers

**Files:**
- Create: `src/lib/progress/movers.ts`
- Test: `tests/progress/movers.test.ts`

**Interfaces:**
- Consumes: `buildSeriesForExercise` (Task 3); `scoreKindFor`, `bestSetsBySession`, `breakthroughs`, `BestSet`, `ScoreKind` (Task 4); `exerciseOccurrences` from `exercise-series.ts`.
- Produces: `Mover`, `buildMovers(contract: GainContract, windowedLogs: Logs, fullLogs: Logs): Mover[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/progress/movers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { EMPTY_LOGS, type Logs } from "../../src/lib/logs/types";
import { buildMovers } from "../../src/lib/progress/movers";

const source = readFileSync("fixtures/plans/home-training-v1.md", "utf8");
const parsed = parsePlanDocument(source);
if (!parsed.ok) throw new Error("fixture must parse");
const contract = parsed.contract;

function workout(id: string, sessionKey: string, day: string) {
  return {
    id,
    session_key: sessionKey,
    started_at: `${day}T07:00:00Z`,
    completed_at: `${day}T07:40:00Z`,
    status: "completed" as const,
  };
}

function set(id: string, workoutId: string, slug: string, reps: number, weightKg?: number) {
  return { id, workout_id: workoutId, exercise_slug: slug, set_no: 1, reps, weight_kg: weightKg };
}

describe("buildMovers", () => {
  it("gives a movement prescribed in two sessions one row, not two", () => {
    // goblet-squat is prescribed in both session A and session D of the fixture.
    // exercise-series keeps those apart for readiness; a mover is about the movement.
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        workout("w-a1", "A", "2026-08-03"),
        workout("w-d1", "D", "2026-08-07"),
        workout("w-a2", "A", "2026-08-10"),
      ],
      set_logs: [
        set("s1", "w-a1", "goblet-squat", 10, 6),
        set("s2", "w-d1", "goblet-squat", 13, 6),
        set("s3", "w-a2", "goblet-squat", 12, 8),
      ],
    };
    const rows = buildMovers(contract, logs, logs).filter(
      (m) => m.exerciseSlug === "goblet-squat",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sessionCount).toBe(3);
  });

  it("computes the delta from the window's first session to its latest", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03"), workout("w2", "A", "2026-08-10")],
      set_logs: [set("s1", "w1", "goblet-squat", 10, 6), set("s2", "w2", "goblet-squat", 10, 9)],
    };
    const row = buildMovers(contract, logs, logs).find((m) => m.exerciseSlug === "goblet-squat");
    // 6 kg x 10 scores 8.0, 9 kg x 10 scores 12.0 — a 50% improvement.
    expect(row?.deltaPct).toBeCloseTo(0.5);
  });

  it("leaves a single-session movement without a delta rather than calling it 0%", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03")],
      set_logs: [set("s1", "w1", "goblet-squat", 10, 6)],
    };
    const row = buildMovers(contract, logs, logs).find((m) => m.exerciseSlug === "goblet-squat");
    expect(row?.deltaPct).toBeUndefined();
    expect(row?.sessionCount).toBe(1);
  });

  it("orders breakthrough-latest rows first, then improved, then the rest, each by recency", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        workout("w1", "A", "2026-08-03"),
        workout("w2", "A", "2026-08-10"),
        workout("w3", "A", "2026-08-17"),
      ],
      set_logs: [
        // goblet-squat improves and its latest session is a breakthrough.
        set("s1", "w1", "goblet-squat", 10, 6),
        set("s2", "w3", "goblet-squat", 10, 9),
        // db-floor-press improves, but its best session is not the latest.
        set("s3", "w1", "db-floor-press", 8, 10),
        set("s4", "w2", "db-floor-press", 8, 14),
        set("s5", "w3", "db-floor-press", 8, 12),
      ],
    };
    const order = buildMovers(contract, logs, logs)
      .filter((m) => ["goblet-squat", "db-floor-press"].includes(m.exerciseSlug))
      .map((m) => m.exerciseSlug);
    expect(order).toEqual(["goblet-squat", "db-floor-press"]);
  });

  it("never links to a session the movement is not prescribed in", () => {
    // reverse-crunch is prescribed in session D only. A set logged against it during a
    // session-A workout — a mid-session substitution — must not become the link target,
    // because the detail route 404s on an unprescribed (session, exercise) pair.
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w-d1", "D", "2026-08-07"), workout("w-a2", "A", "2026-08-10")],
      set_logs: [
        set("s1", "w-d1", "reverse-crunch", 10),
        set("s2", "w-a2", "reverse-crunch", 12),
      ],
    };
    const row = buildMovers(contract, logs, logs).find(
      (m) => m.exerciseSlug === "reverse-crunch",
    );
    expect(row?.linkSessionKey).toBe("D");
    // And the substituted-in set does not inflate the row's session count.
    expect(row?.sessionCount).toBe(1);
  });

  it("plots one point per session, which is the same statement as the delta", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03"), workout("w2", "A", "2026-08-10")],
      set_logs: [set("s1", "w1", "goblet-squat", 10, 6), set("s2", "w2", "goblet-squat", 10, 9)],
    };
    const row = buildMovers(contract, logs, logs).find((m) => m.exerciseSlug === "goblet-squat");
    expect(row?.points).toHaveLength(2);
    expect(row?.points[0]?.y).toBeCloseTo(8);
    expect(row?.points[1]?.y).toBeCloseTo(12);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/progress/movers.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/progress/movers`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/progress/movers.ts`:

```ts
/**
 * One row per movement: how far it moved across the window, and where to go to see why.
 *
 * Grouped by movement rather than by (session, exercise) occurrence, because "am I getting
 * stronger at squats" is not a per-session question — a movement prescribed in two
 * sessions should be one row, not two with different numbers. Readiness, which compares a
 * performance against a prescribed range, stays per-occurrence in `double-progression.ts`.
 *
 * Ordered by recency of improvement, never by delta. Relative change is not comparable
 * across score kinds: a hold going 30s to 45s is +50% while a squat going 60 kg to 63 kg
 * is +5%, so a delta-sorted list is permanently topped by the same two or three bodyweight
 * movements whatever the user actually did this month. Recency also answers "what changed"
 * more literally than magnitude does.
 */

import type { GainContract } from "../contract/schema";
import type { Logs } from "../logs/types";
import { buildSeriesForExercise, exerciseOccurrences } from "./exercise-series";
import {
  bestSetsBySession,
  breakthroughs,
  scoreKindFor,
  type BestSet,
  type ScoreKind,
} from "./personal-best";

export type Mover = {
  exerciseSlug: string;
  exerciseName: string;
  /** Always an occurrence the contract declares — see `linkSessionKey` below. */
  linkSessionKey: string;
  linkSessionName: string;
  kind: ScoreKind;
  first: BestSet;
  latest: BestSet;
  /** Undefined when the window holds only one session for this movement. */
  deltaPct: number | undefined;
  /** True when the movement's latest session in the window beat everything before it. */
  latestIsBreakthrough: boolean;
  points: { x: number; y: number }[];
  sessionCount: number;
};

export function buildMovers(
  contract: GainContract,
  windowedLogs: Logs,
  fullLogs: Logs,
): Mover[] {
  const bySlug = new Map<string, ReturnType<typeof exerciseOccurrences>>();
  for (const occurrence of exerciseOccurrences(contract)) {
    const list = bySlug.get(occurrence.exerciseSlug) ?? [];
    list.push(occurrence);
    bySlug.set(occurrence.exerciseSlug, list);
  }

  const movers: Mover[] = [];
  for (const [slug, occurrences] of bySlug) {
    // Only sessions the contract prescribes this movement in. A set logged against it
    // during another session — a mid-session substitution — belongs to that session's own
    // movement, and letting it in here would both inflate the row and produce a
    // `linkSessionKey` the detail route 404s on ("not prescribed in this session").
    const prescribedKeys = new Set(occurrences.map((o) => o.sessionKey));
    const prescribed = (logs: Logs): Set<string> =>
      new Set(
        logs.workouts.filter((w) => prescribedKeys.has(w.session_key)).map((w) => w.id),
      );

    const fullIds = prescribed(fullLogs);
    const fullSeries = buildSeriesForExercise(fullLogs, slug).filter((p) =>
      fullIds.has(p.workoutId),
    );
    if (fullSeries.length === 0) continue;

    // `type` comes from the first occurrence in catalogue order. A movement prescribed as
    // reps in one session and time in another is possible in principle and absent in
    // practice; this is the documented behaviour rather than an unhandled case.
    const first = occurrences[0]!;
    const type = first.resolved.type;

    // Decided over full history, so switching from 12w to 4w can never switch a
    // movement's unit and silently change what the row means.
    const kind = scoreKindFor(fullSeries, type);

    const windowIds = prescribed(windowedLogs);
    const windowSeries = buildSeriesForExercise(windowedLogs, slug).filter((p) =>
      windowIds.has(p.workoutId),
    );
    // Both sides at once: a mover row summarises the movement, and the detail route is
    // where left and right are kept apart.
    const bests = bestSetsBySession(windowSeries, kind);
    if (bests.length === 0) continue;

    const firstBest = bests[0]!;
    const latestBest = bests[bests.length - 1]!;
    const deltaPct =
      bests.length < 2 || firstBest.score === 0
        ? undefined
        : (latestBest.score - firstBest.score) / firstBest.score;

    const latestIsBreakthrough = breakthroughs(fullSeries, slug, type, false).some(
      (b) => b.at.workoutId === latestBest.workoutId,
    );

    const withLogs = occurrences.filter((o) =>
      windowSeries.some((p) =>
        windowedLogs.workouts.some(
          (w) => w.id === p.workoutId && w.session_key === o.sessionKey,
        ),
      ),
    );
    const link = withLogs[withLogs.length - 1] ?? first;

    movers.push({
      exerciseSlug: slug,
      exerciseName: first.exerciseName,
      linkSessionKey: link.sessionKey,
      linkSessionName: link.sessionName,
      kind,
      first: firstBest,
      latest: latestBest,
      deltaPct,
      latestIsBreakthrough,
      points: bests.map((b) => ({ x: new Date(b.startedAt).getTime(), y: b.score })),
      sessionCount: bests.length,
    });
  }

  return movers.sort((a, b) => rank(a) - rank(b) || compareRecency(a, b));
}

/** Breakthroughs first, then anything that improved, then the rest. */
function rank(mover: Mover): number {
  if (mover.latestIsBreakthrough) return 0;
  if (mover.deltaPct !== undefined && mover.deltaPct > 0) return 1;
  return 2;
}

function compareRecency(a: Mover, b: Mover): number {
  return b.latest.startedAt.localeCompare(a.latest.startedAt);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/progress/movers.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify and commit**

```bash
npx prettier --write src/lib/progress/movers.ts tests/progress/movers.test.ts
npm run verify > /tmp/verify.log 2>&1; echo $status; tail -20 /tmp/verify.log
git add src/lib/progress/movers.ts tests/progress/movers.test.ts
git commit -m "feat(progress): build the per-movement movers list

One row per movement rather than per (session, exercise) occurrence: whether
squats are moving is not a per-session question, and two rows carrying
different numbers for one movement is the confusion the old exercises list
shipped with. Readiness stays per-occurrence, where the range it compares
against lives.

Ordered by recency of improvement rather than by delta. Relative change is not
comparable across score kinds — a hold going 30s to 45s is +50% while a squat
going 60 to 63 kg is +5% — so a delta-sorted list is topped by the same
bodyweight movements forever.

The link target is drawn from the contract's own occurrences, never from the
newest log: a set logged during a session the movement was only substituted
into would otherwise produce a link the detail route answers with a 404.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Consistency and streak

**Files:**
- Create: `src/lib/progress/consistency.ts`
- Test: `tests/progress/consistency.test.ts`

**Interfaces:**
- Consumes: `sessionTypeStats` from `session-stats.ts`.
- Produces: `WeekBucket`, `Consistency`, `buildConsistency(contract: GainContract, windowedLogs: Logs, fullLogs: Logs, now: Date): Consistency`.

- [ ] **Step 1: Write the failing test**

Create `tests/progress/consistency.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { EMPTY_LOGS, type Logs, type Workout } from "../../src/lib/logs/types";
import { buildConsistency } from "../../src/lib/progress/consistency";

const source = readFileSync("fixtures/plans/home-training-v1.md", "utf8");
const parsed = parsePlanDocument(source);
if (!parsed.ok) throw new Error("fixture must parse");
const contract = parsed.contract;

function finished(id: string, sessionKey: string, day: string): Workout {
  return {
    id,
    session_key: sessionKey,
    started_at: `${day}T07:00:00Z`,
    completed_at: `${day}T07:40:00Z`,
    status: "completed",
  };
}

// 2026-08-03, 2026-08-10, 2026-08-17, 2026-08-24 are Mondays.
const NOW = new Date("2026-08-26T09:00:00Z");

describe("buildConsistency", () => {
  it("buckets finished workouts into Monday-start UTC weeks", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        finished("w1", "A", "2026-08-03"),
        finished("w2", "B", "2026-08-06"),
        finished("w3", "A", "2026-08-10"),
      ],
    };
    const c = buildConsistency(contract, logs, logs, NOW);
    expect(c.weeks.find((w) => w.weekStart === "2026-08-03")?.count).toBe(2);
    expect(c.weeks.find((w) => w.weekStart === "2026-08-10")?.count).toBe(1);
  });

  it("keeps empty weeks in the strip rather than compressing the gap away", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [finished("w1", "A", "2026-08-03"), finished("w2", "A", "2026-08-17")],
    };
    const c = buildConsistency(contract, logs, logs, NOW);
    expect(c.weeks.map((w) => w.weekStart)).toEqual([
      "2026-08-03",
      "2026-08-10",
      "2026-08-17",
      "2026-08-24",
    ]);
    expect(c.weeks[1]?.count).toBe(0);
  });

  it("counts a red-flag stop as showing up", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        { ...finished("w1", "A", "2026-08-03"), status: "stopped" },
        // Still open — no completed_at — counts towards nothing.
        { id: "w2", session_key: "A", started_at: "2026-08-04T07:00:00Z", status: "partial" },
      ],
    };
    expect(buildConsistency(contract, logs, logs, NOW).sessionCount).toBe(1);
  });

  it("measures the streak to the last completed week when this week is still empty", () => {
    // NOW is Wednesday 2026-08-26 and nothing is logged in that week yet. Without this
    // rule, opening the app on a Monday morning reads "streak: 0".
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        finished("w1", "A", "2026-08-10"),
        finished("w2", "A", "2026-08-17"),
        finished("w3", "A", "2026-08-24"),
      ],
    };
    expect(buildConsistency(contract, logs, logs, NOW).streakWeeks).toBe(3);
  });

  it("breaks the streak on a missed week", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [finished("w1", "A", "2026-08-03"), finished("w2", "A", "2026-08-24")],
    };
    expect(buildConsistency(contract, logs, logs, NOW).streakWeeks).toBe(1);
  });

  it("computes the streak over full history, not the window", () => {
    const full: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        finished("w1", "A", "2026-08-03"),
        finished("w2", "A", "2026-08-10"),
        finished("w3", "A", "2026-08-17"),
        finished("w4", "A", "2026-08-24"),
      ],
    };
    const windowed: Logs = { ...EMPTY_LOGS, workouts: full.workouts.slice(2) };
    // A streak is a fact about the user, not about the selected span — windowing it to
    // two weeks would report a four-week streak as two.
    expect(buildConsistency(contract, windowed, full, NOW).streakWeeks).toBe(4);
  });

  it("breaks down finished workouts and deviations per session type", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [finished("w1", "A", "2026-08-03"), finished("w2", "B", "2026-08-04")],
      deviations: [{ id: "d1", workout_id: "w1", exercise_slug: "goblet-squat", kind: "skip" }],
    };
    const c = buildConsistency(contract, logs, logs, NOW);
    const a = c.bySessionType.find((s) => s.key === "A");
    expect(a?.finished).toBe(1);
    expect(a?.deviations).toBe(1);
    expect(c.deviationCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/progress/consistency.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/progress/consistency`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/progress/consistency.ts`:

```ts
/**
 * Showing up: weekly buckets, a streak, and the per-session-type counts that replace the
 * hub's four duration charts.
 *
 * "Finished" means `completed_at` is set, whatever the status — the same test
 * `sessionTypeStats` already applies. A red-flag stop is a workout the user turned up for
 * and counts; a workout still open counts towards neither the buckets nor the streak. The
 * window's session count, the buckets and the movers' session counts all use this one
 * definition, so the three can never disagree on the same screen.
 *
 * Weeks are Monday-start in UTC rather than in local time, so the buckets are
 * deterministic and testable. The accepted consequence: a workout logged late on a Sunday
 * evening in a positive UTC offset falls into the following week.
 *
 * The streak is computed over full history, never the window — it is a fact about the
 * user, not about the selected span, and windowing it to `4w` would cap it at four. It is
 * measured to the current week if that week already holds a workout and otherwise to the
 * previous one, so opening the app on a Monday morning does not read "streak: 0" and
 * punish the user for the calendar.
 */

import type { GainContract } from "../contract/schema";
import type { Logs, Workout } from "../logs/types";
import { sessionTypeStats } from "./session-stats";

export type WeekBucket = { weekStart: string; count: number };

export type Consistency = {
  weeks: WeekBucket[];
  sessionCount: number;
  streakWeeks: number;
  deviationCount: number;
  activityCount: number;
  bySessionType: { key: string; name: string; finished: number; deviations: number }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function isFinished(workout: Workout): boolean {
  return workout.completed_at !== undefined;
}

/** The Monday of the UTC week an ISO timestamp falls in, as `YYYY-MM-DD`. */
export function weekStartOf(iso: string): string {
  const date = new Date(iso);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const monday = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - mondayOffset,
  );
  return new Date(monday).toISOString().slice(0, 10);
}

function previousWeek(weekStart: string): string {
  return new Date(new Date(`${weekStart}T00:00:00Z`).getTime() - 7 * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function nextWeek(weekStart: string): string {
  return new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + 7 * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function buildConsistency(
  contract: GainContract,
  windowedLogs: Logs,
  fullLogs: Logs,
  now: Date,
): Consistency {
  const finished = windowedLogs.workouts.filter(isFinished);

  const counts = new Map<string, number>();
  for (const workout of finished) {
    const week = weekStartOf(workout.started_at);
    counts.set(week, (counts.get(week) ?? 0) + 1);
  }

  // Contiguous from the earliest logged week to the current one, so a gap renders as a
  // gap rather than being compressed out of existence.
  const weeks: WeekBucket[] = [];
  const thisWeek = weekStartOf(now.toISOString());
  const earliest = [...counts.keys()].sort()[0];
  if (earliest) {
    for (let week = earliest; week <= thisWeek; week = nextWeek(week)) {
      weeks.push({ weekStart: week, count: counts.get(week) ?? 0 });
    }
  }

  const trained = new Set(fullLogs.workouts.filter(isFinished).map((w) => weekStartOf(w.started_at)));
  let cursor = trained.has(thisWeek) ? thisWeek : previousWeek(thisWeek);
  let streakWeeks = 0;
  while (trained.has(cursor)) {
    streakWeeks += 1;
    cursor = previousWeek(cursor);
  }

  const bySessionType = contract.sessions.map((session) => {
    const stats = sessionTypeStats(windowedLogs, session.key);
    return {
      key: session.key,
      name: session.name,
      finished: stats.finishedCount,
      deviations: stats.deviationCount,
    };
  });

  return {
    weeks,
    sessionCount: finished.length,
    streakWeeks,
    deviationCount: windowedLogs.deviations.length,
    activityCount: windowedLogs.activities.length,
    bySessionType,
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/progress/consistency.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify and commit**

```bash
npx prettier --write src/lib/progress/consistency.ts tests/progress/consistency.test.ts
npm run verify > /tmp/verify.log 2>&1; echo $status; tail -20 /tmp/verify.log
git add src/lib/progress/consistency.ts tests/progress/consistency.test.ts
git commit -m "feat(progress): count showing up, in weeks and in streaks

One weekly strip replaces the hub's four duration charts. Weeks bucket
Monday-start in UTC so they are deterministic; empty weeks stay in the strip,
because a gap the user took is information rather than noise to compress out.

The streak reads full history rather than the window — it is a fact about the
user, not about the selected span — and is measured to the last completed week
when the current one is still empty, so opening the app on a Monday morning
does not report a streak of zero and punish the user for the calendar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The three headline numbers

**Files:**
- Create: `src/lib/progress/headline.ts`
- Test: `tests/progress/headline.test.ts`

**Interfaces:**
- Consumes: `buildMovers` (Task 5); `breakthroughs` (Task 4); `buildSeriesForExercise`/`exerciseOccurrences` (Task 3); `doubleProgressionState` from `double-progression.ts`.
- Produces: `Headline`, `buildHeadline(contract: GainContract, windowedLogs: Logs, fullLogs: Logs, windowStart: string | undefined): Headline`.

Note the fourth parameter: the spec's signature block omits it, because new-best counting needs the window boundary while `breakthroughs` itself must see full history. Passing the boundary is cheaper and clearer than passing the same logs twice.

- [ ] **Step 1: Write the failing test**

Create `tests/progress/headline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { EMPTY_LOGS, type Logs } from "../../src/lib/logs/types";
import { buildHeadline } from "../../src/lib/progress/headline";

const source = readFileSync("fixtures/plans/home-training-v1.md", "utf8");
const parsed = parsePlanDocument(source);
if (!parsed.ok) throw new Error("fixture must parse");
const contract = parsed.contract;

function workout(id: string, sessionKey: string, day: string) {
  return {
    id,
    session_key: sessionKey,
    started_at: `${day}T07:00:00Z`,
    completed_at: `${day}T07:40:00Z`,
    status: "completed" as const,
  };
}

function set(
  id: string,
  workoutId: string,
  slug: string,
  reps: number,
  weightKg?: number,
  side?: "left" | "right",
) {
  return {
    id,
    workout_id: workoutId,
    exercise_slug: slug,
    set_no: 1,
    reps,
    weight_kg: weightKg,
    side,
  };
}

describe("buildHeadline", () => {
  it("counts a new best only when it beats every session before it", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03"), workout("w2", "A", "2026-08-10")],
      set_logs: [set("s1", "w1", "goblet-squat", 10, 6), set("s2", "w2", "goblet-squat", 10, 9)],
    };
    expect(buildHeadline(contract, logs, logs, undefined).newBests).toBe(1);
  });

  it("does not count the first ever session as a new best", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03")],
      set_logs: [set("s1", "w1", "goblet-squat", 10, 6)],
    };
    expect(buildHeadline(contract, logs, logs, undefined).newBests).toBe(0);
  });

  it("counts movements, not breakthroughs, so a per-side best cannot report two", () => {
    // split-squat is per_side in the fixture. A best on each side is one new best.
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "D", "2026-08-03"), workout("w2", "D", "2026-08-10")],
      set_logs: [
        set("s1", "w1", "split-squat", 8, 6, "left"),
        set("s2", "w1", "split-squat", 8, 6, "right"),
        set("s3", "w2", "split-squat", 10, 6, "left"),
        set("s4", "w2", "split-squat", 10, 6, "right"),
      ],
    };
    expect(buildHeadline(contract, logs, logs, undefined).newBests).toBe(1);
  });

  it("keeps a breakthrough outside the window out of the count", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03"), workout("w2", "A", "2026-08-10")],
      set_logs: [set("s1", "w1", "goblet-squat", 10, 6), set("s2", "w2", "goblet-squat", 10, 9)],
    };
    expect(buildHeadline(contract, logs, logs, "2026-08-20T00:00:00Z").newBests).toBe(0);
  });

  it("states improvement as a fraction whose denominator excludes single-session work", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03"), workout("w2", "A", "2026-08-10")],
      set_logs: [
        // Improved across two sessions.
        set("s1", "w1", "goblet-squat", 10, 6),
        set("s2", "w2", "goblet-squat", 10, 9),
        // Went backwards across two sessions.
        set("s3", "w1", "db-floor-press", 8, 14),
        set("s4", "w2", "db-floor-press", 8, 10),
        // Logged once — neither improved nor unimproved, and in neither number.
        set("s5", "w1", "prone-row", 10, 8),
      ],
    };
    const headline = buildHeadline(contract, logs, logs, undefined);
    expect(headline.improved).toEqual({ count: 1, comparable: 2 });
  });

  it("reports nothing comparable rather than dividing by zero on an empty window", () => {
    const headline = buildHeadline(contract, EMPTY_LOGS, EMPTY_LOGS, undefined);
    expect(headline).toEqual({
      newBests: 0,
      readyToIncrease: 0,
      improved: { count: 0, comparable: 0 },
    });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/progress/headline.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/progress/headline`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/progress/headline.ts`:

```ts
/**
 * The three numbers at the top of the Progress screen: what changed.
 *
 * Total volume was the original third stat and was cut. Under double progression — the
 * fixture's own model — `6 kg 12/12/12` becoming `8 kg 8/8/8` is exactly what success
 * looks like, and tonnage falls from 216 to 192, so a motivational headline would have
 * gone negative at the user's best moment. "7 of 12 movements improved" cannot invert on
 * success, is defined for bodyweight and timed work, and needs no synthetic index.
 *
 * `improved` always carries its denominator, because a bare "7 improved" hides whether
 * that is out of eight or out of thirty. `comparable` counts movements with at least two
 * logged sessions in the window; a movement logged once is neither improved nor
 * unimproved and belongs in neither number rather than being counted as a failure.
 */

import type { GainContract } from "../contract/schema";
import type { Logs } from "../logs/types";
import { doubleProgressionState } from "./double-progression";
import { buildExerciseSeries, buildSeriesForExercise, exerciseOccurrences } from "./exercise-series";
import { breakthroughs } from "./personal-best";
import { buildMovers } from "./movers";

export type Headline = {
  /** Distinct exercises with a breakthrough inside the window — never per side. */
  newBests: number;
  readyToIncrease: number;
  improved: { count: number; comparable: number };
};

export function buildHeadline(
  contract: GainContract,
  windowedLogs: Logs,
  fullLogs: Logs,
  windowStart: string | undefined,
): Headline {
  const occurrences = exerciseOccurrences(contract);

  const bySlug = new Map<string, (typeof occurrences)[number]>();
  for (const occurrence of occurrences) {
    if (!bySlug.has(occurrence.exerciseSlug)) bySlug.set(occurrence.exerciseSlug, occurrence);
  }

  const improvedSlugs = new Set<string>();
  for (const [slug, occurrence] of bySlug) {
    // Full history, then filtered by date: a personal best must beat everything before it,
    // not merely everything since the window opened.
    const series = buildSeriesForExercise(fullLogs, slug);
    const found = breakthroughs(
      series,
      slug,
      occurrence.resolved.type,
      occurrence.resolved.perSide,
    );
    const inWindow = found.filter(
      (b) => windowStart === undefined || b.at.startedAt >= windowStart,
    );
    if (inWindow.length > 0) improvedSlugs.add(slug);
  }

  let readyToIncrease = 0;
  for (const occurrence of occurrences) {
    const series = buildExerciseSeries(fullLogs, occurrence.sessionKey, occurrence.exerciseSlug);
    const target =
      occurrence.resolved.type === "time"
        ? occurrence.resolved.durationSec
        : occurrence.resolved.reps;
    const state = doubleProgressionState(
      series,
      target,
      occurrence.resolved.sets,
      occurrence.resolved.type,
      occurrence.resolved.perSide,
    );
    if (state === undefined) continue;
    const sides = [state.none, state.left, state.right].filter((s) => s !== undefined);
    if (sides.length > 0 && sides.every((s) => s.status === "ready")) readyToIncrease += 1;
  }

  const movers = buildMovers(contract, windowedLogs, fullLogs);
  const comparable = movers.filter((m) => m.deltaPct !== undefined);

  return {
    newBests: improvedSlugs.size,
    readyToIncrease,
    improved: {
      count: comparable.filter((m) => (m.deltaPct ?? 0) > 0).length,
      comparable: comparable.length,
    },
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/progress/headline.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify and commit**

```bash
npx prettier --write src/lib/progress/headline.ts tests/progress/headline.test.ts
npm run verify > /tmp/verify.log 2>&1; echo $status; tail -20 /tmp/verify.log
git add src/lib/progress/headline.ts tests/progress/headline.test.ts
git commit -m "feat(progress): compute the three what-changed numbers

New bests, movements ready for a load increase, and movements improved. Total
volume was the original third stat and is not here: under double progression,
6 kg 12/12/12 becoming 8 kg 8/8/8 is what success looks like and tonnage falls,
so the headline would have gone negative at the user's best moment.

New bests count movements rather than breakthroughs, so a per-side movement
that improved on both sides reports one rather than two. Improvement always
carries its denominator, and a movement logged once in the window sits in
neither half of it rather than being counted as a failure.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Metric rows for the hub

**Files:**
- Modify: `src/lib/progress/metric-series.ts`
- Test: `tests/progress/metric-series.test.ts`

**Interfaces:**
- Consumes: `numericMetricDefs`, `numericMetricSeries` (existing in this module).
- Produces: `HubMetricRow`, `hubMetricRows(contract: GainContract, logs: Logs): HubMetricRow[]`.

`HubMetricRow` is `{ scope: MetricScope; key: string; label: string; points: { x: number; y: number }[]; latest: number | undefined; domain: [number, number] | undefined }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/progress/metric-series.test.ts`:

```ts
describe("hubMetricRows", () => {
  it("averages a set-scope metric per workout instead of stacking points on one date", () => {
    // numericMetricSeries stamps every value with its workout's started_at, so a metric
    // answered once per set returns several points sharing one x. Inlined on the hub that
    // renders as a vertical stack of dots and reads as a fault.
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        {
          id: "w1",
          session_key: "A",
          started_at: "2026-08-03T07:00:00Z",
          completed_at: "2026-08-03T07:40:00Z",
          status: "completed",
        },
      ],
      set_logs: [
        { id: "s1", workout_id: "w1", exercise_slug: "goblet-squat", set_no: 1, reps: 10 },
        { id: "s2", workout_id: "w1", exercise_slug: "goblet-squat", set_no: 2, reps: 10 },
      ],
      metric_values: [
        { id: "m1", key: "symptoms_during", ref: { scope: "set", set_log_id: "s1" }, value_num: 2 },
        { id: "m2", key: "symptoms_during", ref: { scope: "set", set_log_id: "s2" }, value_num: 4 },
      ],
    };
    const row = hubMetricRows(contract, logs).find(
      (r) => r.key === "symptoms_during" && r.scope === "set",
    );
    expect(row?.points).toHaveLength(1);
    expect(row?.points[0]?.y).toBe(3);
  });

  it("carries a scale metric's declared bounds so the chart cannot overstate it", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        {
          id: "w1",
          session_key: "A",
          started_at: "2026-08-03T07:00:00Z",
          completed_at: "2026-08-03T07:40:00Z",
          status: "completed",
        },
      ],
      metric_values: [
        { id: "m1", key: "energy", ref: { scope: "session", workout_id: "w1" }, value_num: 3 },
      ],
    };
    const row = hubMetricRows(contract, logs).find((r) => r.key === "energy");
    expect(row?.domain).toBeDefined();
  });

  it("omits a metric with nothing logged", () => {
    expect(hubMetricRows(contract, EMPTY_LOGS)).toEqual([]);
  });
});
```

Before running, check the fixture's actual metric keys and pick a real `scale` metric for the second case — `npx vitest run tests/fixture-coverage.test.ts` and the fixture's `metrics:` block name them. Substitute the real key and scope if `energy` is not one.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/progress/metric-series.test.ts`
Expected: FAIL — `hubMetricRows` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/progress/metric-series.ts`:

```ts
export type HubMetricRow = {
  scope: MetricScope;
  key: string;
  label: string;
  points: { x: number; y: number }[];
  latest: number | undefined;
  /** A `scale` metric's declared bounds, for `Sparkline`'s `yDomain`. */
  domain: [number, number] | undefined;
};

/**
 * One row per `(scope, key)` with something logged, ready to render inline on the hub.
 *
 * A set-scope metric is averaged per workout. `numericMetricSeries` stamps every value
 * with its workout's `started_at`, so a metric answered once per set — the fixture's
 * set-scope `symptoms_during` — returns several points sharing one x coordinate. That is
 * already true on the old metric detail page; inlining the chart on a busier screen makes
 * a vertical stack of dots at one date look like a rendering fault.
 *
 * A `scale` metric carries its declared bounds so `Sparkline` plots against them rather
 * than auto-scaling: a 0-10 score that moved 2 to 3 must render as the near-flat line it
 * is, not as a climb.
 */
export function hubMetricRows(contract: GainContract, logs: Logs): HubMetricRow[] {
  const rows: HubMetricRow[] = [];
  for (const { scope, def } of numericMetricDefs(contract)) {
    const series = numericMetricSeries(logs, scope, def.key);
    if (series.length === 0) continue;

    const sums = new Map<string, { startedAt: string; total: number; count: number }>();
    for (const point of series) {
      const entry = sums.get(point.workoutId) ?? {
        startedAt: point.startedAt,
        total: 0,
        count: 0,
      };
      entry.total += point.value;
      entry.count += 1;
      sums.set(point.workoutId, entry);
    }

    const points = [...sums.values()]
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((entry) => ({
        x: new Date(entry.startedAt).getTime(),
        y: entry.total / entry.count,
      }));

    rows.push({
      scope,
      key: def.key,
      label: def.label,
      points,
      latest: points.at(-1)?.y,
      domain:
        def.type === "scale" && def.min !== undefined && def.max !== undefined
          ? [def.min, def.max]
          : undefined,
    });
  }
  return rows;
}
```

Import `GainContract` and `Logs` at the top of the file if they are not already imported. The schema requires `min`/`max` on both `number` and `scale` metrics, so the `def.type === "scale"` guard is load-bearing: a `number` metric (a bodyweight in kg, say) also carries bounds, and plotting a real trend against them would flatten it to nothing.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/progress/metric-series.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
npx prettier --write src/lib/progress/metric-series.ts tests/progress/metric-series.test.ts
npm run verify > /tmp/verify.log 2>&1; echo $status; tail -20 /tmp/verify.log
git add src/lib/progress/metric-series.ts tests/progress/metric-series.test.ts
git commit -m "feat(progress): shape metric trends for an inline hub row

Two routes existed to put a window picker above a single sparkline, which is
two taps for one line. The chart moves onto the hub, which needs two things the
detail page could get away with ignoring: a set-scope metric averaged per
workout rather than stacking a vertical column of dots on one date, and a scale
metric's declared bounds so a score that moved from 2 to 3 on a 0-10 scale does
not render as a climb.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The window pills component

**Files:**
- Create: `src/lib/components/WindowPills.svelte`
- Test: exercised by Task 10's e2e; no unit test (no DOM tooling in this repo, by design).

**Interfaces:**
- Consumes: nothing.
- Produces: a component taking `{ options: { id: string; label: string }[]; selected: string; hrefFor: (id: string) => string; caption?: string }`.

Links rather than buttons: the window is a URL parameter, so a link is the honest control, needs no JS, and is what `touch-targets.spec.ts` sweeps. This is the deliberate exception to UI's "native `<select>` stays native" note — that note defends a `<select>` for picking one of many values by name, whereas this is a small fixed set of toggle-like states, which is what the app's pill pattern is for.

- [ ] **Step 1: Write the component**

Create `src/lib/components/WindowPills.svelte`:

```svelte
<!-- src/lib/components/WindowPills.svelte -->
<script lang="ts">
  /**
   * The Progress time control: a small fixed set of spans, rendered as links because the
   * window is a URL parameter. UI's "native <select> stays native" note defends a
   * <select> for picking one of many values by name — a whole exercise catalogue — and
   * this is the opposite case: four toggle-like states, which is what the pill pattern is
   * for everywhere else in the app.
   *
   * `caption` states the window's sample size beside it. A calendar window silently lies
   * about density when someone trains fortnightly, and saying "19 sessions" is the
   * cheapest possible correction.
   */
  let {
    options,
    selected,
    hrefFor,
    caption,
  }: {
    options: { id: string; label: string }[];
    selected: string;
    hrefFor: (id: string) => string;
    caption?: string;
  } = $props();
</script>

<nav class="window-pills" aria-label="Time window">
  {#each options as option (option.id)}
    <a
      class="pill"
      class:selected={option.id === selected}
      href={hrefFor(option.id)}
      aria-current={option.id === selected ? "true" : undefined}
      data-window={option.id}>{option.label}</a
    >
  {/each}
  {#if caption}<span class="caption">{caption}</span>{/if}
</nav>

<style>
  .window-pills {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
    margin: 1rem 0;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* The app's 44px floor; touch-targets.spec.ts sweeps this route. */
    min-height: 2.75rem;
    min-width: 2.75rem;
    padding: var(--s-2) var(--s-4);
    border-radius: var(--r-sm);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font-size: var(--t-sm);
    font-weight: var(--w-semi);
    text-decoration: none;
  }
  .pill.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, var(--raised));
  }
  .caption {
    color: var(--muted);
    font-size: var(--t-sm);
  }
</style>
```

- [ ] **Step 2: Confirm it compiles and is theme-clean**

Run: `npm run check > /tmp/check.log 2>&1; echo $status; tail -20 /tmp/check.log`
Expected: exit 0. Then confirm every colour used is an existing token:

Run: `grep -n "\-\-accent\|--raised\|--line\b\|--text\|--muted" src/app.css | head`
Expected: each token is defined there.

- [ ] **Step 3: Commit**

```bash
npx prettier --write src/lib/components/WindowPills.svelte
git add src/lib/components/WindowPills.svelte
git commit -m "feat(progress): add the shared window pill row

Links rather than buttons, because the window is a URL parameter and a link is
the control that says so — it needs no JS and it is what the touch-target sweep
checks. This is the deliberate exception to UI's note about keeping native
selects native: that note defends a select for picking one of many values by
name, and this is four toggle-like states.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: The Progress hub

**Files:**
- Rewrite: `src/routes/plan/[slug]/progress/+page.server.ts`
- Rewrite: `src/routes/plan/[slug]/progress/+page.svelte`
- Test: `e2e/progress-walkthrough.spec.ts` (rewritten)

**Interfaces:**
- Consumes: everything from Tasks 1 and 4-9.
- Produces: the `/plan/[slug]/progress` data contract used by no other module.

- [ ] **Step 1: Write the load function**

Replace `src/routes/plan/[slug]/progress/+page.server.ts` entirely:

```ts
/**
 * The Progress screen, whole. Four routes collapsed to two: the exercises list was pure
 * indirection over a readiness string, and both metric routes existed to put a window
 * picker above a single sparkline.
 *
 * Thin by construction — every number here comes from a unit-tested module under
 * `$lib/progress/`. The one thing this file decides is what the screen shows first.
 */

import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import { logsForPlan } from "$lib/db/logs";
import { filterLogsToWindow } from "$lib/export/bundle";
import { progressWindowOptions, resolveProgressWindow } from "$lib/progress/progress-window";
import { buildExerciseSeries, exerciseOccurrences } from "$lib/progress/exercise-series";
import { doubleProgressionState, formatReadiness } from "$lib/progress/double-progression";
import { buildMovers } from "$lib/progress/movers";
import { buildConsistency } from "$lib/progress/consistency";
import { buildHeadline } from "$lib/progress/headline";
import { hubMetricRows } from "$lib/progress/metric-series";
import { formatScore } from "$lib/progress/personal-best";

export const load: PageServerLoad = ({ params, locals, url }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan) throw error(404, "No such plan");

  const version = getCurrentVersion(userDb, plan.id);
  if (!version) throw error(409, "That plan has no current version");
  const contract = contractOfVersion(version);

  const now = new Date();
  const window = resolveProgressWindow(url.searchParams.get("window"), now);
  const logs = logsForPlan(userDb, plan.id);
  const windowed = filterLogsToWindow(logs, window);

  const movers = buildMovers(contract, windowed, logs).map((mover) => ({
    exerciseSlug: mover.exerciseSlug,
    exerciseName: mover.exerciseName,
    linkSessionKey: mover.linkSessionKey,
    linkSessionName: mover.linkSessionName,
    from: formatScore(mover.first),
    to: formatScore(mover.latest),
    deltaPct: mover.deltaPct,
    latestIsBreakthrough: mover.latestIsBreakthrough,
    points: mover.points,
    sessionCount: mover.sessionCount,
  }));

  // Readiness reads full unwindowed history: it is a statement about the next session,
  // not about a span.
  const ready = exerciseOccurrences(contract).flatMap((occurrence) => {
    const series = buildExerciseSeries(logs, occurrence.sessionKey, occurrence.exerciseSlug);
    if (series.length === 0) return [];
    const target =
      occurrence.resolved.type === "time"
        ? occurrence.resolved.durationSec
        : occurrence.resolved.reps;
    const state = doubleProgressionState(
      series,
      target,
      occurrence.resolved.sets,
      occurrence.resolved.type,
      occurrence.resolved.perSide,
    );
    if (state === undefined) return [];
    const sides = [state.none, state.left, state.right].filter((s) => s !== undefined);
    if (sides.length === 0 || !sides.every((s) => s.status === "ready")) return [];
    return [
      {
        exerciseSlug: occurrence.exerciseSlug,
        exerciseName: occurrence.exerciseName,
        sessionKey: occurrence.sessionKey,
        sessionName: occurrence.sessionName,
        summary: formatReadiness(state, "No range to progress through"),
      },
    ];
  });

  return {
    planSlug: plan.slug,
    planName: plan.name,
    planArchived: !!plan.archived_at,
    windowOptions: progressWindowOptions(now).map((o) => ({ id: o.id, label: o.label })),
    selectedWindow: window.id,
    headline: buildHeadline(contract, windowed, logs, window.start),
    ready,
    movers,
    consistency: buildConsistency(contract, windowed, logs, now),
    metrics: hubMetricRows(contract, windowed),
  };
};
```

- [ ] **Step 2: Write the page**

Replace `src/routes/plan/[slug]/progress/+page.svelte` entirely:

```svelte
<!-- src/routes/plan/[slug]/progress/+page.svelte -->
<script lang="ts">
  import Sparkline from "$lib/components/Sparkline.svelte";
  import BarChart from "$lib/components/BarChart.svelte";
  import ArchivedNote from "$lib/components/ArchivedNote.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import WindowPills from "$lib/components/WindowPills.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const MOVERS_SHOWN = 5;
  let showAllMovers = $state(false);
  const visibleMovers = $derived(
    showAllMovers ? data.movers : data.movers.slice(0, MOVERS_SHOWN),
  );

  const sessionCaption = $derived(
    `${data.consistency.sessionCount} session${data.consistency.sessionCount === 1 ? "" : "s"}`,
  );

  function windowHref(id: string): string {
    return `/plan/${data.planSlug}/progress?window=${id}`;
  }

  /** Always with its basis, never a bare percentage. */
  function formatDelta(pct: number | undefined): string {
    if (pct === undefined) return "First session in this window";
    const rounded = Math.round(pct * 100);
    return `${rounded >= 0 ? "+" : ""}${rounded}%`;
  }

  function weekBars(weeks: { weekStart: string; count: number }[]) {
    return weeks.map((w) => ({ value: w.count, label: w.weekStart.slice(5) }));
  }
</script>

<PageHeader title={`${data.planName} — progress`} backHref="/" backLabel="Back to your plans" />

{#if data.planArchived}
  <ArchivedNote />
{/if}

<WindowPills
  options={data.windowOptions}
  selected={data.selectedWindow}
  hrefFor={windowHref}
  caption={sessionCaption}
/>

{#if data.consistency.sessionCount === 0}
  <EmptyState title="Nothing logged in this window" />
  <p class="empty-hint">
    <a href={windowHref("all")}>Look at your full history instead</a>
  </p>
{:else}
  <section class="headline" aria-label="What changed">
    <p class="stat"><strong>{data.headline.newBests}</strong> new bests</p>
    <p class="stat"><strong>{data.headline.readyToIncrease}</strong> ready to go up</p>
    <p class="stat">
      <strong>{data.headline.improved.count} of {data.headline.improved.comparable}</strong>
      movements improved
    </p>
  </section>

  {#if data.ready.length > 0}
    <section aria-labelledby="ready-heading">
      <h2 id="ready-heading">Ready to go up</h2>
      <ul class="ready-list">
        {#each data.ready as row (row.sessionKey + ":" + row.exerciseSlug)}
          <li>
            <a
              href={`/plan/${data.planSlug}/progress/exercises/${row.sessionKey}/${row.exerciseSlug}`}
            >
              <span class="row-name">{row.exerciseName}</span>
              <span class="row-sub">{row.sessionName}</span>
              <span class="row-sub">{row.summary}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section aria-labelledby="movers-heading">
    <h2 id="movers-heading">Where you're moving</h2>
    <ul class="mover-list">
      {#each visibleMovers as mover (mover.exerciseSlug)}
        <li>
          <a
            href={`/plan/${data.planSlug}/progress/exercises/${mover.linkSessionKey}/${mover.exerciseSlug}`}
          >
            <span class="row-name">
              {mover.exerciseName}
              {#if mover.latestIsBreakthrough}<span class="badge">new best</span>{/if}
            </span>
            <span class="row-sub">
              {#if mover.deltaPct === undefined}
                {mover.to} · one session so far
              {:else}
                {mover.from} → {mover.to} · <span class="delta">{formatDelta(mover.deltaPct)}</span>
              {/if}
            </span>
            <Sparkline
              points={mover.points}
              width={320}
              height={48}
              ariaLabel={`${mover.exerciseName} progress trend chart`}
              formatPointLabel={() => undefined}
              formatReadout={(p) => `${p.y.toFixed(1)} on ${new Date(p.x).toISOString().slice(0, 10)}`}
            />
          </a>
        </li>
      {/each}
    </ul>
    {#if data.movers.length > MOVERS_SHOWN && !showAllMovers}
      <button class="show-all" onclick={() => (showAllMovers = true)}>
        Show all {data.movers.length} movements
      </button>
    {/if}
  </section>

  <section aria-labelledby="consistency-heading">
    <h2 id="consistency-heading">Showing up</h2>
    <BarChart
      data={weekBars(data.consistency.weeks)}
      ariaLabel="sessions per week bar chart"
      formatReadout={(d) => `${d.value} session${d.value === 1 ? "" : "s"} in the week of ${d.label}`}
    />
    <p class="stat-line">
      {sessionCaption} · {data.consistency.streakWeeks}-week streak · {data.consistency
        .deviationCount} deviation{data.consistency.deviationCount === 1 ? "" : "s"}
    </p>
    <table class="session-table">
      <thead>
        <tr><th scope="col">Session</th><th scope="col">Done</th><th scope="col">Deviations</th></tr>
      </thead>
      <tbody>
        {#each data.consistency.bySessionType as row (row.key)}
          <tr><td>{row.name}</td><td>{row.finished}</td><td>{row.deviations}</td></tr>
        {/each}
      </tbody>
    </table>
  </section>

  {#if data.metrics.length > 0}
    <section aria-labelledby="metrics-heading">
      <h2 id="metrics-heading">How you've felt</h2>
      {#each data.metrics as metric (metric.scope + ":" + metric.key)}
        <div class="metric-row">
          <p class="row-name">{metric.label}</p>
          <p class="row-sub">{metric.scope} scope · latest {metric.latest?.toFixed(1)}</p>
          <Sparkline
            points={metric.points}
            height={64}
            yDomain={metric.domain}
            ariaLabel={`${metric.label} (${metric.scope}) trend chart`}
            formatPointLabel={(p, i, all) => (i === all.length - 1 ? p.y.toFixed(1) : undefined)}
            formatReadout={(p) => `${p.y.toFixed(1)} on ${new Date(p.x).toISOString().slice(0, 10)}`}
          />
        </div>
      {/each}
    </section>
  {/if}
{/if}

<style>
  .headline {
    display: grid;
    gap: var(--s-2);
    padding: var(--pad-card);
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    margin-bottom: 1.25rem;
  }
  .stat {
    margin: 0;
    color: var(--muted);
    font-size: var(--t-sm);
  }
  .stat strong {
    color: var(--text);
    font-size: var(--t-base);
  }
  h2 {
    font-size: var(--t-base);
    margin: 0 0 0.5rem;
  }
  section {
    margin-bottom: 1.5rem;
  }
  .ready-list,
  .mover-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--s-3);
  }
  .ready-list a,
  .mover-list a {
    display: grid;
    gap: var(--s-1);
    min-height: 2.75rem;
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--line-soft);
    color: var(--text);
    text-decoration: none;
  }
  .row-name {
    font-weight: var(--w-bold);
  }
  .row-sub {
    font-size: var(--t-sm);
    color: var(--muted);
  }
  .delta {
    color: var(--accent);
    font-weight: var(--w-semi);
  }
  .badge {
    margin-left: var(--s-2);
    padding: 0 var(--s-2);
    border-radius: var(--r-xs);
    background: color-mix(in srgb, var(--accent) 22%, var(--surface));
    color: var(--accent);
    font-size: var(--t-sm);
    font-weight: var(--w-semi);
  }
  .show-all {
    margin-top: var(--s-3);
    min-height: 2.75rem;
    padding: var(--s-2) var(--s-4);
    border-radius: var(--r-sm);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
  }
  .stat-line {
    margin: var(--s-3) 0 0;
    color: var(--muted);
    font-size: var(--t-sm);
  }
  .session-table {
    width: 100%;
    margin-top: var(--s-3);
    border-collapse: collapse;
    font-size: var(--t-sm);
  }
  .session-table th,
  .session-table td {
    text-align: left;
    padding: var(--s-2) 0;
    border-bottom: 1px solid var(--line-soft);
    color: var(--muted);
  }
  .session-table td:first-child {
    color: var(--text);
  }
  .metric-row {
    margin-bottom: var(--s-4);
  }
  .metric-row p {
    margin: 0 0 var(--s-1);
  }
  .empty-hint {
    font-size: var(--t-sm);
  }
</style>
```

- [ ] **Step 3: Typecheck before touching the e2e suite**

Run: `npm run check > /tmp/check.log 2>&1; echo $status; tail -30 /tmp/check.log`
Expected: exit 0. If `BarChart`'s prop names differ from those used here, read `src/lib/components/BarChart.svelte` and match them — do not change `BarChart`.

- [ ] **Step 4: Rewrite the e2e walkthrough**

Replace `e2e/progress-walkthrough.spec.ts`:

```ts
// e2e/progress-walkthrough.spec.ts
/**
 * The hub's own durable proof. goblet-squat is prescribed in both session A ([8,12]) and
 * session D ([12,15]) of the fixture, and the redesign splits what that means: it is ONE
 * mover row, because whether squats are moving is not a per-session question, and up to
 * TWO readiness rows, because a range belongs to an occurrence. A regression in either
 * direction — a movers list that keys on (session, exercise), or a readiness list that
 * collapses to the slug — shows up here.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import {
  assertNoHorizontalOverflow,
  dismissPreSessionPrompt,
  finishSession,
  logSetThroughRest,
  openExercise,
} from "./helpers";
import type { Page } from "@playwright/test";

async function logGobletSquat(page: Page, sessionKey: string, sets: number): Promise<void> {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/${sessionKey}`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  const pills = page.locator(".checkoff-pills .pill");
  const pillCount = await pills.count();
  for (let i = 0; i < pillCount; i++) await pills.nth(i).click();

  await expect(openExercise(page).locator(".exercise-name")).toHaveText("Goblet squat");
  for (let i = 0; i < sets; i++) await logSetThroughRest(page);
  await finishSession(page);
}

test("the hub answers what changed, and groups movements the way each section needs", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await logGobletSquat(page, "A", 3);
  await logGobletSquat(page, "D", 2);

  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress?window=all`);

  // Counts stay "at least one" rather than exact: this suite shares one seeded database
  // across three parallel viewport projects (history-walkthrough.spec.ts), so how many
  // times a session has been logged by the time this runs is not deterministic.
  await expect(page.getByRole("heading", { name: "Where you're moving" })).toBeVisible();

  // One mover row for the movement, whichever sessions it was logged in.
  const moverRows = page
    .locator(".mover-list li")
    .filter({ hasText: "Goblet squat" });
  await expect(moverRows).toHaveCount(1);

  // The row's sparkline must actually be populated — Sparkline renders its <svg
  // aria-label> in the empty branch too, so the container proves nothing.
  await expect(
    page.locator('svg[aria-label="Goblet squat progress trend chart"] .dot').first(),
  ).toBeVisible();

  // The consistency strip is a real chart with real bars, not an empty well.
  await expect(page.locator('svg[aria-label="sessions per week bar chart"] rect').first()).toBeVisible();

  await assertNoHorizontalOverflow(page);
});

test("a mover row links to a session the movement is actually prescribed in", async ({
  page,
}) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress?window=all`);
  const link = page.locator(".mover-list li a").first();
  await link.click();
  // The detail route 404s on an unprescribed (session, exercise) pair, so arriving at a
  // rendered heading is the assertion.
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.getByText("not prescribed in this session")).toHaveCount(0);
});

test("the window pills navigate and mark the current span", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress`);
  // 12w is the default and is current without any query string.
  await expect(page.locator('.window-pills a[data-window="12w"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.locator('.window-pills a[data-window="all"]').click();
  await expect(page).toHaveURL(/window=all/);
  await expect(page.locator('.window-pills a[data-window="all"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
  await assertNoHorizontalOverflow(page);
});
```

- [ ] **Step 5: Run the e2e spec at one viewport**

Run: `npx playwright test --project=iphone e2e/progress-walkthrough.spec.ts`
Expected: PASS, 3 tests. If a locator misses, read `test-results/<test>/error-context.md` — the accessibility snapshot names a component that threw at runtime, which the Playwright timeout message never does.

- [ ] **Step 6: Look at it**

Create `e2e/tmp-progress-shot.spec.ts`:

```ts
import { test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";

test("screenshot the hub", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress?window=all`);
  await page.screenshot({ path: "test-results/progress-hub.png", fullPage: true });
});
```

Run: `npx playwright test --project=small-android e2e/tmp-progress-shot.spec.ts`
Then read `test-results/progress-hub.png` with the Read tool and check it against §5 of the spec: pills, headline, ready, movers, consistency, metrics, in that order, with nothing overflowing at 360px. Delete the throwaway spec:

```bash
rm e2e/tmp-progress-shot.spec.ts
```

- [ ] **Step 7: Verify and commit**

```bash
npx prettier --write "src/routes/plan/[slug]/progress/+page.server.ts" "src/routes/plan/[slug]/progress/+page.svelte" e2e/progress-walkthrough.spec.ts
npm run verify > /tmp/verify.log 2>&1; echo $status; tail -20 /tmp/verify.log
git add "src/routes/plan/[slug]/progress" e2e/progress-walkthrough.spec.ts
git commit -m "feat(progress): rebuild the hub around what changed

The screen led with session duration and a completion rate that cannot move —
the runner writes only completed or stopped, so the rate is always exactly 100%
or 0% — and spent roughly 650 CSS px per session card to say it. The one
actionable number GAIN computes sat two levels down as muted body text.

Six sections now: window pills with their own sample size, the three
what-changed numbers, the readiness list promoted to the top, movers ordered by
recency of improvement, one consistency strip in place of four duration charts,
and metric trends inlined rather than hidden behind two taps.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: The detail route, and deleting the other three

**Files:**
- Modify: `src/routes/plan/[slug]/progress/exercises/[session]/[exercise]/+page.server.ts`
- Modify: `src/routes/plan/[slug]/progress/exercises/[session]/[exercise]/+page.svelte`
- Delete: `src/routes/plan/[slug]/progress/exercises/+page.server.ts`, `+page.svelte`
- Delete: `src/routes/plan/[slug]/progress/metrics/` (the whole directory)
- Modify: `e2e/revision-walkthrough.spec.ts:89,135,150`

**Interfaces:**
- Consumes: `progressWindowOptions`/`resolveProgressWindow` (Task 1), `WindowPills` (Task 9).
- Produces: nothing new.

- [ ] **Step 1: Swap the detail route's window source**

In `.../[exercise]/+page.server.ts`, replace the export-window block. Delete the `exportWindowOptions`/`resolveExportWindow` import and the `context` object, and replace the option resolution with:

```ts
import { progressWindowOptions, resolveProgressWindow } from "$lib/progress/progress-window";

  // ...
  const now = new Date();
  const window = resolveProgressWindow(url.searchParams.get("window"), now);
  const windowedSeries = buildExerciseSeries(
    filterLogsToWindow(logs, window),
    params.session,
    params.exercise,
  );
```

and in the returned object:

```ts
    windowOptions: progressWindowOptions(now).map((o) => ({ id: o.id, label: o.label })),
    selectedWindow: window.id,
```

Remove `version.block_length_weeks` and `version.imported_at` from the load if nothing else uses them.

- [ ] **Step 2: Swap the detail route's picker and back link**

In `.../[exercise]/+page.svelte`, delete the `<label class="window-picker">` block and its styles, delete the now-unused `goto`/`resolve`/`page` imports, and render the pills instead:

```svelte
  import WindowPills from "$lib/components/WindowPills.svelte";
  // ...
  function windowHref(id: string): string {
    return `/plan/${data.planSlug}/progress/exercises/${data.sessionKey}/${data.exerciseSlug}?window=${id}`;
  }
```

```svelte
<PageHeader
  title={data.exerciseName}
  subtitle={data.sessionName}
  backHref={`/plan/${data.planSlug}/progress`}
  backLabel="Back to progress"
/>

<WindowPills
  options={data.windowOptions}
  selected={data.selectedWindow}
  hrefFor={windowHref}
/>
```

Add `sessionKey`, `exerciseSlug` and `planSlug` to the load's return value if they are not already there.

- [ ] **Step 3: Delete the three dead routes**

```bash
git rm "src/routes/plan/[slug]/progress/exercises/+page.server.ts" "src/routes/plan/[slug]/progress/exercises/+page.svelte"
git rm -r "src/routes/plan/[slug]/progress/metrics"
```

- [ ] **Step 4: Fix the revision walkthrough's window ids**

In `e2e/revision-walkthrough.spec.ts`, change `?window=full` to `?window=all` at lines 89 and 135. Line 150's URL has no query string and needs no change — confirm by reading it.

Run: `grep -n "window=" e2e/revision-walkthrough.spec.ts`
Expected: no remaining `window=full`, `window=since_version` or `window=recent_blocks`.

- [ ] **Step 5: Confirm nothing still links to a deleted route**

Run: `grep -rn "progress/exercises\"\|progress/metrics" src/ e2e/`
Expected: no hits (the surviving detail route's paths all include a session segment).

- [ ] **Step 6: Run the affected e2e projects**

Run: `npx playwright test --project=iphone e2e/progress-walkthrough.spec.ts e2e/revision-walkthrough.spec.ts e2e/touch-targets.spec.ts e2e/theme-coverage.spec.ts`
Expected: PASS. `touch-targets` is the one that proves the pills clear 44px; `theme-coverage` proves the new markup has no hardcoded colour.

- [ ] **Step 7: Verify and commit**

```bash
npx prettier --write "src/routes/plan/[slug]/progress/exercises/[session]/[exercise]/+page.server.ts" "src/routes/plan/[slug]/progress/exercises/[session]/[exercise]/+page.svelte" e2e/revision-walkthrough.spec.ts
npm run verify > /tmp/verify.log 2>&1; echo $status; tail -20 /tmp/verify.log
git add -A "src/routes/plan/[slug]/progress" e2e/revision-walkthrough.spec.ts
git commit -m "refactor(progress): collapse four progress routes to two

The exercises list was pure indirection — its only content was a readiness
string, which now sits on the hub — and both metric routes existed to put a
window picker above one sparkline. The per-exercise detail route stays a route
rather than becoming an in-page expansion: it draws three charts, doubled for a
per-side movement, and inlining twenty of those is the dashboard sprawl
ARCHITECTURE forbids.

The detail route now shares the hub's pills, so the two surviving screens agree
on what a window is. Its window ids change with them, which is why the revision
walkthrough's ?window=full URLs become ?window=all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Fold the durable half back in, delete the tracking docs

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§10, §14 if the accepted-gap row's wording no longer fits)
- Modify: `docs/UI.md` (the keyboard-cost note and the native-`<select>` note)
- Modify: `CLAUDE.md` (the area table's Progress row; the e2e paragraph's route references)
- Delete: `docs/superpowers/specs/2026-09-05-progress-redesign-design.md`
- Delete: `docs/superpowers/plans/2026-09-05-progress-redesign.md`

CLAUDE.md's own rule: a tracking doc is deleted in the same commit that lands the durable half, with no strikethrough, no "done" section and no archive directory. `git log` recovers anything that mattered.

- [ ] **Step 1: Rewrite ARCHITECTURE §10**

Replace the "Per exercise" and "Per session type" bullets. The section currently promises per-session-type duration and completion rate, which this work removes. New content:

```markdown
## 10. Progress & history

- **The hub answers "what changed".** New bests, movements ready for a load increase, and
  movements improved — then the readiness list, the movers list, one consistency strip and
  the metric trends, on one screen. Duration and completion rate are gone: the runner
  writes only `completed` or `stopped`, so a completion rate is always exactly 100% or 0%,
  and nobody trains to move a session's duration.
- **Improvement is scored on one scale per movement**, so bodyweight and timed work are
  not second-class: an estimated 1RM for loaded reps (Epley, reps capped at 12), weight ×
  seconds for a loaded hold, best reps, best seconds. The kind is decided once per series.
  **That estimate is in-app only and must never enter the export** — the bundle's progress
  summary is arithmetic the reviewing AI trusts and does not check, and an estimate from a
  formula the plan never declared has no business in it.
- **A new best is a running-max breakthrough** against full history, never against the
  window, and the first logged session is a baseline rather than a breakthrough.
- **Per exercise:** load × reps over time, estimated volume, double-progression state
  ("12/11/11 — one session from a load increase"), and difficulty distribution.
- **Metric trends:** any numeric plan-declared metric is chartable, so symptom and energy
  tracking come free from the metric definitions rather than from hardcoding. A `scale`
  metric plots against its declared bounds rather than auto-scaling.
- **History:** reverse-chronological workout list, each drilling into full set detail
  and the plan version it ran under.
- Charts stay simple and read well on a phone. No dashboard sprawl.
```

- [ ] **Step 2: Fix UI's two stale references**

Both notes name "the three progress window pickers", which no longer exist.

In the keyboard-cost note, replace the paragraph with:

```markdown
**One accepted keyboard cost, now closed rather than accepted.** The progress window
pickers used to navigate on a `<select>`'s `change`, so arrow-keying a closed `<select>` on
a desktop keyboard fired one navigation per keypress. They are links now (`WindowPills`),
which has no such behaviour.
```

In the native-`<select>` note, remove "the three progress window pickers" from the list and add a sentence:

```markdown
The progress screens are the deliberate exception, and the reason is the same rule read the
other way: `WindowPills` renders a small fixed set of toggle-like states, not one of many
values picked by name, so it gets the pill pattern the rest of the app uses for exactly
that. A native picker sheet buys nothing for four options.
```

- [ ] **Step 3: Update CLAUDE.md**

In the area table, replace the Progress row:

```markdown
| Progress, charts & history | `src/lib/progress/`, `src/lib/db/history.ts` — the hub composes `progress-window`, `personal-best`, `movers`, `consistency` and `headline`; the estimated 1RM in `personal-best.ts` is in-app only and must never reach the export |
```

In the e2e paragraph, the list of walkthroughs is unchanged in name — `progress-` still exists. Confirm no sentence claims four progress routes:

Run: `grep -n "progress" CLAUDE.md`
Expected: nothing describing a per-exercise list route or metric routes.

- [ ] **Step 4: Delete the tracking docs**

```bash
git rm docs/superpowers/specs/2026-09-05-progress-redesign-design.md docs/superpowers/plans/2026-09-05-progress-redesign.md
```

- [ ] **Step 5: Full verify and the whole e2e suite**

```bash
npm run verify > /tmp/verify.log 2>&1; echo $status; tail -30 /tmp/verify.log
npx playwright test > /tmp/e2e.log 2>&1; echo $status; tail -40 /tmp/e2e.log
```

Expected: both exit 0. The `offline` project builds a real production server, so this run takes noticeably longer than the other three. If a port is held by a killed run, `ss -ltnp | grep -E '4319|4320'` names the pid.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs(progress): fold the redesign's durable half into the standing docs

ARCHITECTURE section 10 described a per-session-type duration and completion
rate that no longer exist, and gains the two rules a future change would
otherwise re-derive: the score that makes bodyweight work comparable, and that
its estimated 1RM must never reach the export. UI's two references to the
progress window pickers named a control that is now a link, and the
native-select note gains the reason the pills are the exception to it.

The spec and the plan are deleted rather than archived, per this repo's own
rule: git log is the record of how something got built, and the standing
documents are the record of what is true now.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: §3.1→1, §3.2→4, §3.3→5, §3.4→6, §3.5→7, §4→10 and 11, §5→9 and 10, §6 honesty rules→spread across 5, 7, 8 and 10 (empty window and `ArchivedNote` in 10; denominator in 7; single-session in 5; `scale` bounds in 2 and 8), §7 accepted gaps→carried forward, unchanged, §8→each task's own test steps, §9→12. The chart-geometry change the spec adds late (§5, "one shared-component change") is Task 2.

**Type consistency.** `ProgressWindow` (Task 1) is consumed by Tasks 10 and 11 as `{ id, label, start? }` and passed to `filterLogsToWindow` unchanged. `BestSet`/`ScoreKind` (Task 4) are consumed by Tasks 5 and 7 and rendered through `formatScore` in Task 10. `Mover` (Task 5) is consumed by Task 7's `improved` and flattened for the client in Task 10. `Consistency.weeks` (Task 6) feeds Task 10's `weekBars`. `HubMetricRow.domain` (Task 8) feeds `Sparkline`'s `yDomain` (Task 2). `buildHeadline` takes four parameters in both its definition (Task 7) and its call site (Task 10).

**One deviation from the spec, recorded here rather than silently:** `buildHeadline` takes a fourth `windowStart` parameter that the spec's signature block omits. New-best counting needs the window boundary while `breakthroughs` must see full history, and passing the boundary is cheaper than passing the same logs twice.

**Two facts were verified while writing this plan rather than left to the implementer:** the fixture parser is `parsePlanDocument` from `src/lib/parse/parser` (not `parse/plan-document`), and a `scale` metric's bounds really are `min`/`max` — required by the schema for `number` too, which is why Task 8 guards on the type rather than on the fields being present.

**One tooling note for whoever executes this:** a `grep` shell function from the session snapshot shadows the real binary in this environment and silently reports no matches. Use `command grep` for anything load-bearing — it is how the literal NUL that this plan's own control-character bullet originally contained was found.
