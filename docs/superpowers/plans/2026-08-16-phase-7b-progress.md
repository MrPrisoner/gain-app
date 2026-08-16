# Phase 7b — Progress, charts & history: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship ROADMAP phase 7's five remaining items — double-progression state as one
shared pure module, per-exercise progress, per-session-type stats, metric trends, and
workout history — closing phase 7 entirely.

**Architecture:** Pure logic in `src/lib/progress/` (no I/O, unit-tested against
hand-calculated expectations, the same shape as `src/lib/session/` and
`src/lib/export/`), one new DB read module (`src/lib/db/history.ts`), thin SvelteKit
routes under `src/routes/plan/[slug]/progress/` and `src/routes/plan/[slug]/history/`,
and a refactor of `src/lib/export/summary.ts` onto the new shared module so the export
and the app charts can never quietly disagree about a workout's history.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), TypeScript, `better-sqlite3`, Vitest,
Playwright. Charts are hand-rolled inline SVG — no new dependency.

**Spec:** [`docs/superpowers/specs/2026-08-16-phase-7b-progress-design.md`](../specs/2026-08-16-phase-7b-progress-design.md)
— read it before starting; this plan argues from it and does not repeat its reasoning.

## Global Constraints

- **Keying is `(session_key, exercise_slug)`, never a bare exercise slug.** The same
  movement can carry a different rep range in different sessions (goblet-squat: `[8,12]`
  in session A, `[12,15]` in session D). Every function that groups set history by
  exercise takes a `sessionKey` alongside the slug.
- **`set_log` carries no `block_key`.** History cannot be resolved finer than
  `(session_key, exercise_slug)` — two full-tracking blocks of the *same* session
  prescribing the same exercise collapse to one occurrence. This is a known, accepted
  limit (see `src/lib/session/resume.ts`'s own comment on the same gap), not something
  this phase fixes.
- **Double-progression readiness reads the prescription and the log, nothing else** —
  the rep/duration range, and how many sets the prescription asks for. Never a metric
  value (`rir`, `symptoms_during`, …): metric keys are plan-specific free text with no
  structural meaning, and ARCHITECTURE explicitly restricts GAIN to acting automatically
  on `scheduling.sequence` alone.
- **One exception to "full unwindowed history" for readiness: `src/lib/export/summary.ts`
  computes it from the same windowed series as that row's other columns**, so one export
  row never disagrees with itself about what "latest" means. Every other consumer
  (the live per-exercise page) uses full history.
- **Charts use one accent hue only** (`--accent`, `--accent-soft`, `--dim`, `--muted`,
  `--line`). No categorical palette. Per-side exercises render as two small charts
  (Left / Right), never one two-series chart. Difficulty's three bars are a sequential
  accent tint (`color-mix(in srgb, var(--accent) N%, var(--surface))`), never
  green/amber/red — those are reserved for the symptom framework (CLAUDE.md).
- **Charts are touch-first**: no hover-only tooltips. Every chart directly labels its
  most current point; tapping any other point/bar reveals its value in a readout below
  the chart, via a real `role="button"` + `onclick`/`onkeydown` pair — never a
  hover-only handler.
- **Windowing reuses `src/lib/export/windows.ts` and `src/lib/export/bundle.ts`'s
  `filterLogsToWindow`** — no second definition of "windowed" anywhere in this phase.
  Note one deliberate divergence from that module's own doc comment: it says an
  unresolvable window id is the caller's cue to `fail(400)` rather than substitute a
  default, because a mislabelled *export bundle* misleads the reviewing AI. A chart
  screen reached by a hand-edited query string carries no such label into the loop, so
  these routes fall back to `options[0]` instead of erroring. Say so in a comment at each
  fallback rather than leaving it looking like an oversight.
- **A movement that carries no load still needs a first chart.** Most of the fixture's
  exercises are bodyweight (`dead-bug`, `mcgill-curl-up`, `side-plank-knees`, the whole
  warm-up), and several are timed rather than counted. Plotting `weight_kg ?? 0` for those
  draws a flat line at zero with nothing to read, which is why `topSetChartPoints` (Task 1)
  decides per series whether load or effort is the quantity worth plotting.
- **Nothing here is precached, and that is the decision** (spec §13). Progress and History
  are server-rendered read screens that fall through to `/offline` without a connection;
  `src/service-worker.ts` is not touched by this phase. Offline is a hard requirement for
  *logging*, which cannot wait and cannot be redone — reading a chart can.
- **Only `set` and `session` scope metrics are chartable in practice today.** `exercise`
  scope is declared in the fixture (`rir`) and supported by the sync ops, but nothing in
  the runner writes one yet, so `numericMetricSeries` returns nothing for it and the list
  filters the row out. Do not special-case it — but be aware that when exercise-scope
  values do start arriving, one workout yields several values at one `started_at`, and
  the line chart will need a decision (mean per workout, or one series per exercise) that
  is deliberately out of this phase's scope.
- **Reads go through `logsForPlan`** (`src/lib/db/logs.ts`), exactly as
  `buildProgressSummary` already does. No new bulk read module for sets, workouts,
  metric values or deviations — `src/lib/db/history.ts` adds exactly the one thing
  `logsForPlan` doesn't carry (which plan version a workout ran under).
- **Layout is verified in a browser at 360px** (phase-4 review's rule) —
  `assertNoHorizontalOverflow` from `e2e/helpers.ts` in every e2e spec this phase adds.
- **After every code change**: `npx prettier --write <file>`, then before ending a task,
  `npm run typecheck` and `npm run check` must show no *new* errors introduced by that
  task (pre-existing warnings listed in `todo.md` are not this phase's problem).

## File Structure

```
src/lib/progress/
  exercise-series.ts          buildExerciseSeries, exerciseOccurrences, topSetPoints,
                               topSetChartPoints, volumePoints, difficultyDistribution
  double-progression.ts       doubleProgressionState, formatDoubleProgressionState,
                               formatReadiness
  session-stats.ts            sessionTypeStats
  metric-series.ts            numericMetricDefs, numericMetricSeries
  chart-geometry.ts           layoutLineChart, layoutBarChart

src/lib/components/
  Sparkline.svelte            generic single-series line chart
  BarChart.svelte             generic single-series bar chart

src/lib/db/
  history.ts                  versionsByWorkout
src/lib/export/
  summary.ts                  MODIFIED — per-exercise section refactored

tests/progress/                one file per module above — this repo's tests live under
  exercise-series.test.ts      tests/, mirroring src/lib/, never beside the source
  double-progression.test.ts
  session-stats.test.ts
  metric-series.test.ts
  chart-geometry.test.ts
tests/db/
  history.test.ts
tests/
  summary.test.ts             MODIFIED

src/routes/
  +page.svelte                 MODIFIED — Progress/History links on the plan card

src/routes/plan/[slug]/progress/
  +page.server.ts +page.svelte             session-type cards, links out
  exercises/+page.server.ts +page.svelte   list
  exercises/[session]/[exercise]/+page.server.ts +page.svelte   detail: readiness + 3 charts
  metrics/+page.server.ts +page.svelte     list
  metrics/[scope]/[key]/+page.server.ts +page.svelte   detail: 1 chart

src/routes/plan/[slug]/history/
  +page.server.ts +page.svelte             paginated reverse-chronological list
  [workoutId]/+page.server.ts +page.svelte detail

e2e/
  progress-walkthrough.spec.ts
  history-walkthrough.spec.ts
```

**Note on test file location**: this repo's Vitest tests all live under `tests/`,
mirroring `src/lib/`'s structure one level in (`tests/session/*` for `src/lib/session/*`,
`tests/db/*` for `src/lib/db/*`). Every "Test:" path below follows that convention —
`src/lib/progress/exercise-series.ts` is tested by `tests/progress/exercise-series.test.ts`,
not a co-located file.

---

# Part 1 — Pure progress modules

No I/O, no SvelteKit, no Svelte. Everything in this part is plain TypeScript,
unit-tested against hand data, and importable standalone. Do these five tasks in order;
each is independent of routes and UI, so this part alone is safe to land without
touching a single route.

## Task 1: `exercise-series.ts` — the shared per-exercise building block

**Files:**
- Create: `src/lib/progress/exercise-series.ts`
- Test: `tests/progress/exercise-series.test.ts`

**Interfaces:**
- Consumes: `Logs`, `SetLog`, `Workout` from `src/lib/logs/types.ts`; `GainContract`
  from `src/lib/contract/schema.ts`; `resolveSession`, `ResolvedExercise`,
  `ResolvedSession` from `src/lib/session/session-view.ts`.
- Produces (consumed by Tasks 2, 6, 11, 12):
  - `type ExerciseSeriesPoint = { workoutId: string; startedAt: string; sets: SetLog[] }`
  - `function buildExerciseSeries(logs: Logs, sessionKey: string, exerciseSlug: string): ExerciseSeriesPoint[]`
  - `type ExerciseOccurrence = { sessionKey: string; sessionName: string; exerciseSlug: string; exerciseName: string; resolved: ResolvedExercise }`
  - `function exerciseOccurrences(contract: GainContract): ExerciseOccurrence[]`
  - `type LoadRepsPoint = { startedAt: string; weightKg: number | undefined; reps: number | undefined; durationS: number | undefined }`
  - `function topSetPoints(series: readonly ExerciseSeriesPoint[], side: "left" | "right" | undefined): LoadRepsPoint[]`
  - `type EffortChartSeries = { plots: "load" | "effort"; unit: "kg" | "reps" | "s"; points: { startedAt: string; value: number; label: string | undefined }[] }`
  - `function topSetChartPoints(series: readonly ExerciseSeriesPoint[], side: "left" | "right" | undefined, type: "reps" | "time"): EffortChartSeries`
  - `type VolumePoint = { startedAt: string; volumeKg: number }`
  - `function volumePoints(series: readonly ExerciseSeriesPoint[], side: "left" | "right" | undefined): VolumePoint[]`
  - `function difficultyDistribution(series: readonly ExerciseSeriesPoint[], side: "left" | "right" | undefined): { easy: number; medium: number; hard: number }`

- [x] **Step 1: Write the failing tests**

```typescript
// tests/progress/exercise-series.test.ts
import { describe, expect, it } from "vitest";
import type { GainContract } from "../../src/lib/contract/schema";
import { EMPTY_LOGS, type Logs } from "../../src/lib/logs/types";
import {
  buildExerciseSeries,
  difficultyDistribution,
  exerciseOccurrences,
  topSetChartPoints,
  topSetPoints,
  volumePoints,
} from "../../src/lib/progress/exercise-series";

// Goblet squat prescribed in two sessions with two different rep ranges — the exact
// scenario that rules out keying on a bare exercise_slug (spec §2, decision 2).
const contract = {
  schema_version: 1,
  plan: { slug: "p", name: "P", version: 1, based_on_version: null },
  loads: [],
  exercises: [{ id: "goblet-squat" }, { id: "side-plank" }],
  sessions: [
    {
      key: "A",
      name: "Session A",
      order: 1,
      blocks: [
        {
          key: "main",
          name: "Main",
          exercises: [{ id: "goblet-squat", sets: 3, reps: [8, 12] }],
        },
      ],
    },
    {
      key: "D",
      name: "Session D",
      order: 2,
      blocks: [
        {
          key: "warmup",
          name: "Warm-up",
          tracking: "checkoff",
          exercises: [{ id: "goblet-squat", reps: 8 }],
        },
        {
          key: "main",
          name: "Main",
          exercises: [{ id: "goblet-squat", sets: 2, reps: [12, 15] }],
        },
      ],
    },
  ],
} as unknown as GainContract;

const logs: Logs = {
  ...EMPTY_LOGS,
  workouts: [
    { id: "w1", session_key: "A", started_at: "2026-08-01T07:00:00Z", status: "completed" },
    { id: "w2", session_key: "A", started_at: "2026-08-08T07:00:00Z", status: "completed" },
    { id: "w3", session_key: "D", started_at: "2026-08-03T07:00:00Z", status: "completed" },
  ],
  set_logs: [
    { id: "s1", workout_id: "w1", exercise_slug: "goblet-squat", set_no: 1, reps: 8, weight_kg: 6 },
    { id: "s2", workout_id: "w1", exercise_slug: "goblet-squat", set_no: 2, reps: 8, weight_kg: 6 },
    { id: "s3", workout_id: "w2", exercise_slug: "goblet-squat", set_no: 1, reps: 12, weight_kg: 6, difficulty: "medium" },
    { id: "s4", workout_id: "w2", exercise_slug: "goblet-squat", set_no: 2, reps: 12, weight_kg: 6, difficulty: "hard" },
    // Session D's own history — must not appear in session A's series.
    { id: "s5", workout_id: "w3", exercise_slug: "goblet-squat", set_no: 1, reps: 12, weight_kg: 8 },
  ],
};

describe("buildExerciseSeries", () => {
  it("groups by (session_key, exercise_slug), chronologically", () => {
    const series = buildExerciseSeries(logs, "A", "goblet-squat");
    expect(series.map((p) => p.workoutId)).toEqual(["w1", "w2"]);
    expect(series[0].sets).toHaveLength(2);
  });

  it("excludes another session's history for the same exercise", () => {
    const series = buildExerciseSeries(logs, "A", "goblet-squat");
    expect(series.some((p) => p.workoutId === "w3")).toBe(false);
  });

  it("returns an empty array for an exercise never logged in that session", () => {
    expect(buildExerciseSeries(logs, "A", "side-plank")).toEqual([]);
  });
});

describe("exerciseOccurrences", () => {
  it("lists one occurrence per (session, exercise) pair, catalogue order then session order", () => {
    const occurrences = exerciseOccurrences(contract);
    expect(occurrences.map((o) => `${o.exerciseSlug}:${o.sessionKey}`)).toEqual([
      "goblet-squat:A",
      "goblet-squat:D",
    ]);
  });

  it("skips a checkoff-tracked occurrence in favour of a full-tracking one in the same session", () => {
    // goblet-squat appears in D's warmup (checkoff) AND D's main (full) — main wins.
    const occurrence = exerciseOccurrences(contract).find((o) => o.sessionKey === "D");
    expect(occurrence?.resolved.reps).toEqual([12, 15]);
  });

  it("omits an exercise never prescribed anywhere", () => {
    const occurrences = exerciseOccurrences(contract);
    expect(occurrences.some((o) => o.exerciseSlug === "side-plank")).toBe(false);
  });
});

describe("topSetPoints", () => {
  it("picks the heaviest set per workout and its reps", () => {
    const series = buildExerciseSeries(logs, "A", "goblet-squat");
    expect(topSetPoints(series, undefined)).toEqual([
      { startedAt: "2026-08-01T07:00:00Z", weightKg: 6, reps: 8, durationS: undefined },
      { startedAt: "2026-08-08T07:00:00Z", weightKg: 6, reps: 12, durationS: undefined },
    ]);
  });
});

describe("topSetChartPoints", () => {
  it("plots the load and labels the reps when the movement carries a load", () => {
    const series = buildExerciseSeries(logs, "A", "goblet-squat");
    expect(topSetChartPoints(series, undefined, "reps")).toEqual({
      plots: "load",
      unit: "kg",
      points: [
        { startedAt: "2026-08-01T07:00:00Z", value: 6, label: "8" },
        { startedAt: "2026-08-08T07:00:00Z", value: 6, label: "12" },
      ],
    });
  });

  it("plots the reps themselves for a bodyweight movement — a flat zero-load line says nothing", () => {
    const bodyweight: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        { id: "w1", session_key: "A", started_at: "2026-08-01T07:00:00Z", status: "completed" },
      ],
      set_logs: [
        { id: "s1", workout_id: "w1", exercise_slug: "dead-bug", set_no: 1, reps: 14 },
        { id: "s2", workout_id: "w1", exercise_slug: "dead-bug", set_no: 2, reps: 16 },
      ],
    };
    const series = buildExerciseSeries(bodyweight, "A", "dead-bug");
    expect(topSetChartPoints(series, undefined, "reps")).toEqual({
      plots: "effort",
      unit: "reps",
      points: [{ startedAt: "2026-08-01T07:00:00Z", value: 16, label: undefined }],
    });
  });

  it("plots seconds for a timed bodyweight movement", () => {
    const timed: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        { id: "w1", session_key: "A", started_at: "2026-08-01T07:00:00Z", status: "completed" },
      ],
      set_logs: [
        { id: "s1", workout_id: "w1", exercise_slug: "side-plank", set_no: 1, duration_s: 30 },
      ],
    };
    const series = buildExerciseSeries(timed, "A", "side-plank");
    expect(topSetChartPoints(series, undefined, "time")).toEqual({
      plots: "effort",
      unit: "s",
      points: [{ startedAt: "2026-08-01T07:00:00Z", value: 30, label: undefined }],
    });
  });
});

describe("volumePoints", () => {
  it("sums weight_kg x reps across every set in a workout", () => {
    const series = buildExerciseSeries(logs, "A", "goblet-squat");
    // w1: 8*6 + 8*6 = 96. w2: 12*6 + 12*6 = 144.
    expect(volumePoints(series, undefined)).toEqual([
      { startedAt: "2026-08-01T07:00:00Z", volumeKg: 96 },
      { startedAt: "2026-08-08T07:00:00Z", volumeKg: 144 },
    ]);
  });
});

describe("difficultyDistribution", () => {
  it("counts difficulty across every set in the series", () => {
    const series = buildExerciseSeries(logs, "A", "goblet-squat");
    expect(difficultyDistribution(series, undefined)).toEqual({ easy: 0, medium: 1, hard: 1 });
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run tests/progress/exercise-series.test.ts`
Expected: FAIL — `src/lib/progress/exercise-series.ts` does not exist yet.

- [x] **Step 3: Implement**

```typescript
// src/lib/progress/exercise-series.ts
/**
 * The one place every per-exercise progress concern is built from — `exercise-series.ts`
 * groups logged sets by `(session_key, exercise_slug)`, not a bare exercise slug: the
 * same movement can carry a different rep range in different sessions (goblet-squat is
 * `[8,12]` in session A and `[12,15]` in session D of the fixture), so a bare-slug
 * grouping would compare a set against the wrong range. Volume and difficulty
 * distribution are reductions over `ExerciseSeriesPoint[]`, not separate reads.
 *
 * `set_log` carries no `block_key` (see `../session/resume.ts`'s own note on the same
 * gap), so this is the finest grain history can be resolved to — a movement prescribed
 * in two full-tracking blocks of the SAME session collapses to its first occurrence.
 */

import type { GainContract } from "../contract/schema";
import type { Logs, SetLog } from "../logs/types";
import { resolveSession, type ResolvedExercise, type ResolvedSession } from "../session/session-view";

export type ExerciseSeriesPoint = {
  workoutId: string;
  startedAt: string;
  sets: SetLog[];
};

/** One point per workout the exercise was logged in, chronological. `renderExerciseSets`
 * (export/summary.ts) accepts `.sets` directly — no adapter needed. */
export function buildExerciseSeries(
  logs: Logs,
  sessionKey: string,
  exerciseSlug: string,
): ExerciseSeriesPoint[] {
  const workoutById = new Map(logs.workouts.map((w) => [w.id, w]));
  const sessionWorkoutIds = new Set(
    logs.workouts.filter((w) => w.session_key === sessionKey).map((w) => w.id),
  );

  const byWorkout = new Map<string, SetLog[]>();
  for (const set of logs.set_logs) {
    if (set.exercise_slug !== exerciseSlug) continue;
    if (!sessionWorkoutIds.has(set.workout_id)) continue;
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

export type ExerciseOccurrence = {
  sessionKey: string;
  sessionName: string;
  exerciseSlug: string;
  exerciseName: string;
  resolved: ResolvedExercise;
};

function firstFullTrackingOccurrence(
  session: ResolvedSession,
  exerciseSlug: string,
): ResolvedExercise | undefined {
  for (const block of session.blocks) {
    if (block.tracking === "checkoff") continue;
    const found = block.exercises.find((e) => e.slug === exerciseSlug);
    if (found) return found;
  }
  return undefined;
}

/**
 * Every `(session, exercise)` pair with at least one full-tracking prescription, in
 * catalogue order then session order — catalogue order first so every session a given
 * exercise appears in stays adjacent in a rendered list, rather than scattering the same
 * movement across the page.
 */
export function exerciseOccurrences(contract: GainContract): ExerciseOccurrence[] {
  const resolvedBySession = new Map(
    contract.sessions.map((s) => [s.key, resolveSession(contract, s.key)]),
  );

  const occurrences: ExerciseOccurrence[] = [];
  for (const def of contract.exercises) {
    for (const session of contract.sessions) {
      const resolved = resolvedBySession.get(session.key);
      if (!resolved) continue;
      const found = firstFullTrackingOccurrence(resolved, def.id);
      if (!found) continue;
      occurrences.push({
        sessionKey: session.key,
        sessionName: session.name,
        exerciseSlug: def.id,
        exerciseName: found.name,
        resolved: found,
      });
    }
  }
  return occurrences;
}

function setsForSide(
  point: ExerciseSeriesPoint,
  side: "left" | "right" | undefined,
): SetLog[] {
  return point.sets.filter((s) => (s.side ?? undefined) === side);
}

export type LoadRepsPoint = {
  startedAt: string;
  weightKg: number | undefined;
  reps: number | undefined;
  durationS: number | undefined;
};

/** The heaviest set logged that workout, and the effort done at that weight — the single
 * chart in spec §5 that plots both quantities without a second (dual) axis. */
export function topSetPoints(
  series: readonly ExerciseSeriesPoint[],
  side: "left" | "right" | undefined,
): LoadRepsPoint[] {
  const points: LoadRepsPoint[] = [];
  for (const point of series) {
    const sets = setsForSide(point, side);
    if (sets.length === 0) continue;
    const top = sets.reduce((best, s) =>
      (s.weight_kg ?? -Infinity) > (best.weight_kg ?? -Infinity) ? s : best,
    );
    points.push({
      startedAt: point.startedAt,
      weightKg: top.weight_kg,
      reps: top.reps,
      durationS: top.duration_s,
    });
  }
  return points;
}

export type EffortChartSeries = {
  plots: "load" | "effort";
  unit: "kg" | "reps" | "s";
  points: { startedAt: string; value: number; label: string | undefined }[];
};

/**
 * What the detail page's first chart actually plots (spec §5).
 *
 * When the movement carries a load, that load is the value and the effort done at it is
 * the point's direct label — the single-axis "load × reps" chart, no second axis. When it
 * carries none, plotting `weight_kg ?? 0` would draw a flat line at zero with nothing to
 * read, and most of this fixture is bodyweight (`dead-bug`, `mcgill-curl-up`,
 * `side-plank-knees`, every warm-up movement). So the effort itself becomes the value —
 * best set of the workout, reps or seconds according to the prescription's own type — and
 * carries no label, because the value already is the label.
 */
export function topSetChartPoints(
  series: readonly ExerciseSeriesPoint[],
  side: "left" | "right" | undefined,
  type: "reps" | "time",
): EffortChartSeries {
  const tops = topSetPoints(series, side);
  const plotsLoad = tops.some((p) => p.weightKg !== undefined);
  const effortOf = (set: { reps?: number; duration_s?: number }): number | undefined =>
    type === "time" ? set.duration_s : set.reps;

  if (plotsLoad) {
    return {
      plots: "load",
      unit: "kg",
      points: tops.map((p) => {
        const effort = type === "time" ? p.durationS : p.reps;
        return {
          startedAt: p.startedAt,
          value: p.weightKg ?? 0,
          label: effort === undefined ? undefined : String(effort),
        };
      }),
    };
  }

  // No load anywhere in the series: the best effort of each workout is the series.
  const points: EffortChartSeries["points"] = [];
  for (const point of series) {
    const efforts = setsForSide(point, side)
      .map(effortOf)
      .filter((v): v is number => v !== undefined);
    if (efforts.length === 0) continue;
    points.push({ startedAt: point.startedAt, value: Math.max(...efforts), label: undefined });
  }

  return { plots: "effort", unit: type === "time" ? "s" : "reps", points };
}

export type VolumePoint = { startedAt: string; volumeKg: number };

export function volumePoints(
  series: readonly ExerciseSeriesPoint[],
  side: "left" | "right" | undefined,
): VolumePoint[] {
  const points: VolumePoint[] = [];
  for (const point of series) {
    const sets = setsForSide(point, side);
    if (sets.length === 0) continue;
    const volumeKg = sets.reduce((sum, s) => sum + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);
    points.push({ startedAt: point.startedAt, volumeKg });
  }
  return points;
}

export function difficultyDistribution(
  series: readonly ExerciseSeriesPoint[],
  side: "left" | "right" | undefined,
): { easy: number; medium: number; hard: number } {
  const counts = { easy: 0, medium: 0, hard: 0 };
  for (const point of series) {
    for (const set of setsForSide(point, side)) {
      if (set.difficulty) counts[set.difficulty] += 1;
    }
  }
  return counts;
}
```

- [x] **Step 4: Run to verify pass**

Run: `npx vitest run tests/progress/exercise-series.test.ts`
Expected: PASS, all 12 tests.

- [x] **Step 5: Format, typecheck, commit**

```bash
npx prettier --write src/lib/progress/exercise-series.ts tests/progress/exercise-series.test.ts
npm run typecheck
git add src/lib/progress/exercise-series.ts tests/progress/exercise-series.test.ts
git commit -m "feat(progress): add buildExerciseSeries and its reductions

The shared per-exercise building block phase 7b's charts and the export
summary both consume — keyed on (session_key, exercise_slug), since the
same movement can carry a different rep range in different sessions.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `double-progression.ts` — readiness state

**Files:**
- Create: `src/lib/progress/double-progression.ts`
- Test: `tests/progress/double-progression.test.ts`

**Interfaces:**
- Consumes: `ExerciseSeriesPoint` from Task 1; `IntOrRange` from `src/lib/contract/schema.ts`.
- Produces (consumed by Tasks 6, 11, 12):
  - `type DoubleProgressionState = { status: "no_data" } | { status: "in_progress"; latest: number[] } | { status: "ready"; latest: number[] }`
  - `type DoubleProgressionBySide = { none?: DoubleProgressionState; left?: DoubleProgressionState; right?: DoubleProgressionState }`
  - `function doubleProgressionState(series: readonly ExerciseSeriesPoint[], target: IntOrRange | undefined, prescribedSets: IntOrRange, type: "reps" | "time", perSide: boolean): DoubleProgressionBySide | undefined`
    — `prescribedSets` is `ResolvedExercise.sets`. Without it, one set at the top of the
    range out of a prescribed three reads "ready for a load increase", and after Task 6
    that verdict ships in the export, where CLAUDE.md's invariant says the AI will trust
    it and not check.
  - `function formatDoubleProgressionState(state: DoubleProgressionState): string`
  - `function formatReadiness(state: DoubleProgressionBySide | undefined, noRange: string): string`
    — the one-line rendering of a whole `DoubleProgressionBySide`, shared by
    `summary.ts` (Task 6) and the exercises list (Task 11) so the export table and the
    app cannot describe the same state in two different sentences.

- [x] **Step 1: Write the failing tests**

```typescript
// tests/progress/double-progression.test.ts
import { describe, expect, it } from "vitest";
import type { ExerciseSeriesPoint } from "../../src/lib/progress/exercise-series";
import {
  doubleProgressionState,
  formatDoubleProgressionState,
  formatReadiness,
} from "../../src/lib/progress/double-progression";

const point = (startedAt: string, sets: ExerciseSeriesPoint["sets"]): ExerciseSeriesPoint => ({
  workoutId: startedAt,
  startedAt,
  sets,
});

const setOf = (set_no: number, reps: number, side?: "left" | "right") => ({
  id: `${set_no}-${side ?? "n"}`,
  workout_id: "w",
  exercise_slug: "goblet-squat",
  set_no,
  reps,
  side,
});

describe("doubleProgressionState", () => {
  it("reports no state for a scalar target — nothing to progress through", () => {
    expect(doubleProgressionState([], 10, 1, "reps", false)).toBeUndefined();
    expect(doubleProgressionState([], [10, 10], 1, "reps", false)).toBeUndefined();
  });

  it("reports no_data with no history", () => {
    const state = doubleProgressionState([], [8, 12], 3, "reps", false);
    expect(state?.none).toEqual({ status: "no_data" });
  });

  it("is ready when every prescribed set in the latest workout meets the range's top", () => {
    const series = [point("2026-08-01", [setOf(1, 12), setOf(2, 12)])];
    const state = doubleProgressionState(series, [8, 12], 2, "reps", false);
    expect(state?.none).toEqual({ status: "ready", latest: [12, 12] });
  });

  it("is in_progress when fewer sets were logged than prescribed, however good they were", () => {
    // One set at the top of the range out of a prescribed three is not a session at the
    // top of the range — and this verdict reaches the reviewing AI through summary.ts.
    const series = [point("2026-08-01", [setOf(1, 12)])];
    const state = doubleProgressionState(series, [8, 12], 3, "reps", false);
    expect(state?.none).toEqual({ status: "in_progress", latest: [12] });
  });

  it("takes a ranged prescription's LOWER bound as the requirement", () => {
    // The fixture's session-D goblet squat is `sets: [2, 3]` — two sets is work the plan
    // itself sanctions, so two at the top of the range is ready. Requiring three would
    // leave a user who reliably does two reading "in progress" forever.
    const series = [point("2026-08-01", [setOf(1, 15), setOf(2, 15)])];
    const state = doubleProgressionState(series, [12, 15], [2, 3], "reps", false);
    expect(state?.none).toEqual({ status: "ready", latest: [15, 15] });
  });

  it("is in_progress when the ROADMAP's own example (12/11/11) falls short of the top", () => {
    const series = [
      point("2026-08-01", [setOf(1, 12), setOf(2, 11), setOf(3, 11)]),
    ];
    const state = doubleProgressionState(series, [8, 12], 3, "reps", false);
    expect(state?.none).toEqual({ status: "in_progress", latest: [12, 11, 11] });
  });

  it("reads only the most recent workout, not history before it", () => {
    const series = [
      point("2026-08-01", [setOf(1, 8)]),
      point("2026-08-08", [setOf(1, 12)]),
    ];
    const state = doubleProgressionState(series, [8, 12], 1, "reps", false);
    expect(state?.none).toEqual({ status: "ready", latest: [12] });
  });

  it("evaluates each side independently for a per_side exercise", () => {
    const series = [
      point("2026-08-01", [setOf(1, 12, "left"), setOf(1, 9, "right")]),
    ];
    const state = doubleProgressionState(series, [8, 12], 1, "reps", true);
    expect(state?.left).toEqual({ status: "ready", latest: [12] });
    expect(state?.right).toEqual({ status: "in_progress", latest: [9] });
  });

  it("reads duration for a type: time exercise", () => {
    const series = [point("2026-08-01", [{ ...setOf(1, 0), reps: undefined, duration_s: 40 }])];
    const state = doubleProgressionState(series, [20, 40], 1, "time", false);
    expect(state?.none).toEqual({ status: "ready", latest: [40] });
  });
});

describe("formatDoubleProgressionState", () => {
  it("formats no history", () => {
    expect(formatDoubleProgressionState({ status: "no_data" })).toBe("No history yet");
  });

  it("formats an in-progress state with its raw numbers", () => {
    expect(formatDoubleProgressionState({ status: "in_progress", latest: [12, 11, 11] })).toBe(
      "12/11/11 — in progress",
    );
  });

  it("formats a ready state", () => {
    expect(formatDoubleProgressionState({ status: "ready", latest: [12, 12] })).toBe(
      "12/12 — ready for a load increase",
    );
  });
});

describe("formatReadiness", () => {
  it("returns the caller's no-range text when there is no state at all", () => {
    expect(formatReadiness(undefined, "–")).toBe("–");
  });

  it("renders a single-sided state as one sentence", () => {
    expect(formatReadiness({ none: { status: "ready", latest: [12] } }, "–")).toBe(
      "12 — ready for a load increase",
    );
  });

  it("renders both sides of a per_side state", () => {
    expect(
      formatReadiness(
        { left: { status: "ready", latest: [12] }, right: { status: "in_progress", latest: [9] } },
        "–",
      ),
    ).toBe("L: 12 — ready for a load increase · R: 9 — in progress");
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run tests/progress/double-progression.test.ts`
Expected: FAIL — module does not exist.

- [x] **Step 3: Implement**

```typescript
// src/lib/progress/double-progression.ts
/**
 * "12/11/11 — one session from a load increase" (ROADMAP phase 7). Purely mechanical:
 * ready means the most recent workout carried at least as many sets as the prescription
 * asks for, and every one of them met or exceeded the range's top. Never weighs a metric
 * value (rir, symptoms_during, …) — ARCHITECTURE restricts GAIN to acting automatically
 * on `scheduling.sequence` alone, and a plan's other metric keys are free text with no
 * structural meaning the app can lean on.
 *
 * The set count is load-bearing rather than pedantry: `summary.ts` puts this verdict in
 * the export, where CLAUDE.md's invariant says the reviewing AI trusts it and does not
 * check it, so one strong set out of three prescribed must not read as a session that
 * earned more load.
 */

import type { IntOrRange } from "../contract/schema";
import type { ExerciseSeriesPoint } from "./exercise-series";

export type DoubleProgressionState =
  | { status: "no_data" }
  | { status: "in_progress"; latest: number[] }
  | { status: "ready"; latest: number[] };

export type DoubleProgressionBySide = {
  none?: DoubleProgressionState;
  left?: DoubleProgressionState;
  right?: DoubleProgressionState;
};

function isTrueRange(target: IntOrRange | undefined): target is [number, number] {
  return Array.isArray(target) && target[0] !== target[1];
}

function upperBound(target: [number, number]): number {
  return target[1];
}

/**
 * How many sets have to be at the top of the range before "ready" — the **lower** bound
 * of a ranged prescription. `sets: [2, 3]` (the fixture's session-D goblet squat) means
 * the plan itself sanctions two, so two at the top of the range has earned the load;
 * requiring three would leave a user who reliably does two reading "in progress" forever,
 * which is a silent wrong answer in the opposite direction.
 */
function requiredSetCount(prescribedSets: IntOrRange): number {
  return Array.isArray(prescribedSets) ? Math.min(...prescribedSets) : prescribedSets;
}

function valueOf(set: { reps?: number; duration_s?: number }, type: "reps" | "time"): number | undefined {
  return type === "time" ? set.duration_s : set.reps;
}

function stateForSide(
  series: readonly ExerciseSeriesPoint[],
  side: "left" | "right" | undefined,
  target: [number, number],
  required: number,
  type: "reps" | "time",
): DoubleProgressionState {
  const top = upperBound(target);
  for (let i = series.length - 1; i >= 0; i--) {
    const sets = series[i].sets.filter((s) => (s.side ?? undefined) === side);
    if (sets.length === 0) continue;
    const values = sets.map((s) => valueOf(s, type)).filter((v): v is number => v !== undefined);
    if (values.length === 0) continue;
    // An added set counts in the user's favour (>=, not ===); a missing one does not.
    const ready =
      values.length === sets.length && values.length >= required && values.every((v) => v >= top);
    return { status: ready ? "ready" : "in_progress", latest: values };
  }
  return { status: "no_data" };
}

/** `undefined` when the resolved target isn't a genuine range — a scalar prescription
 * (e.g. `reps: 16`) has nothing to progress through. */
export function doubleProgressionState(
  series: readonly ExerciseSeriesPoint[],
  target: IntOrRange | undefined,
  prescribedSets: IntOrRange,
  type: "reps" | "time",
  perSide: boolean,
): DoubleProgressionBySide | undefined {
  if (!isTrueRange(target)) return undefined;
  const required = requiredSetCount(prescribedSets);
  return perSide
    ? {
        left: stateForSide(series, "left", target, required, type),
        right: stateForSide(series, "right", target, required, type),
      }
    : { none: stateForSide(series, undefined, target, required, type) };
}

export function formatDoubleProgressionState(state: DoubleProgressionState): string {
  if (state.status === "no_data") return "No history yet";
  const values = state.latest.join("/");
  return state.status === "ready" ? `${values} — ready for a load increase` : `${values} — in progress`;
}

/**
 * One line for a whole `DoubleProgressionBySide`. Shared by the export table and the
 * app's exercises list so the same state is never described two different ways in two
 * places the user compares side by side. `noRange` is what a scalar prescription renders
 * as — a dash in a Markdown table, a sentence in a list row.
 */
export function formatReadiness(
  state: DoubleProgressionBySide | undefined,
  noRange: string,
): string {
  if (state === undefined) return noRange;
  if (state.none) return formatDoubleProgressionState(state.none);
  const left = formatDoubleProgressionState(state.left ?? { status: "no_data" });
  const right = formatDoubleProgressionState(state.right ?? { status: "no_data" });
  return `L: ${left} · R: ${right}`;
}
```

- [x] **Step 4: Run to verify pass**

Run: `npx vitest run tests/progress/double-progression.test.ts`
Expected: PASS, all 15 tests.

- [x] **Step 5: Format, typecheck, commit**

```bash
npx prettier --write src/lib/progress/double-progression.ts tests/progress/double-progression.test.ts
npm run typecheck
git add src/lib/progress/double-progression.ts tests/progress/double-progression.test.ts
git commit -m "feat(progress): add doubleProgressionState

Range-vs-reps/duration only, evaluated per side for a per_side exercise,
reading only the most recent workout. Ready also requires the workout to
have carried the prescribed number of sets — one strong set out of three
is not a session that earned more load, and this verdict reaches the
reviewing AI through the export. Deliberately blind to metric values —
see the module comment for why.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `session-stats.ts` — per-session-type stats

**Files:**
- Create: `src/lib/progress/session-stats.ts`
- Test: `tests/progress/session-stats.test.ts`

**Interfaces:**
- Consumes: `Logs` from `src/lib/logs/types.ts`.
- Produces (consumed by Task 10):
  - `type SessionTypeStats = { sessionKey: string; completionRate: number | undefined; finishedCount: number; deviationCount: number; duration: { workoutId: string; startedAt: string; minutes: number }[] }`
  - `function sessionTypeStats(logs: Logs, sessionKey: string): SessionTypeStats`

- [x] **Step 1: Write the failing tests**

```typescript
// tests/progress/session-stats.test.ts
import { describe, expect, it } from "vitest";
import { EMPTY_LOGS, type Logs } from "../../src/lib/logs/types";
import { sessionTypeStats } from "../../src/lib/progress/session-stats";

const logs: Logs = {
  ...EMPTY_LOGS,
  workouts: [
    {
      id: "w1",
      session_key: "A",
      started_at: "2026-08-01T07:00:00Z",
      completed_at: "2026-08-01T07:40:00Z",
      status: "completed",
    },
    {
      id: "w2",
      session_key: "A",
      started_at: "2026-08-08T07:00:00Z",
      completed_at: "2026-08-08T07:35:00Z",
      status: "partial",
    },
    // Still in progress — no completed_at — must not count toward the rate.
    { id: "w3", session_key: "A", started_at: "2026-08-15T07:00:00Z", status: "partial" },
    { id: "w4", session_key: "B", started_at: "2026-08-02T07:00:00Z", status: "completed" },
  ],
  deviations: [
    { id: "d1", workout_id: "w1", exercise_slug: "goblet-squat", kind: "skip" },
    { id: "d2", workout_id: "w2", exercise_slug: "goblet-squat", kind: "drop_set" },
    { id: "d3", workout_id: "w4", exercise_slug: "goblet-squat", kind: "skip" },
  ],
};

describe("sessionTypeStats", () => {
  it("computes completion rate over finished workouts only", () => {
    const stats = sessionTypeStats(logs, "A");
    expect(stats.finishedCount).toBe(2);
    expect(stats.completionRate).toBeCloseTo(0.5);
  });

  it("counts deviations scoped to that session's workouts", () => {
    expect(sessionTypeStats(logs, "A").deviationCount).toBe(2);
  });

  it("computes duration in minutes from completed_at - started_at, finished workouts only", () => {
    const stats = sessionTypeStats(logs, "A");
    expect(stats.duration).toEqual([
      { workoutId: "w1", startedAt: "2026-08-01T07:00:00Z", minutes: 40 },
      { workoutId: "w2", startedAt: "2026-08-08T07:00:00Z", minutes: 35 },
    ]);
  });

  it("reports undefined completion rate with no finished workouts", () => {
    const stats = sessionTypeStats(logs, "C");
    expect(stats.completionRate).toBeUndefined();
    expect(stats.finishedCount).toBe(0);
  });

  it("scopes entirely to the given session key", () => {
    const stats = sessionTypeStats(logs, "B");
    expect(stats.finishedCount).toBe(1);
    expect(stats.deviationCount).toBe(1);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run tests/progress/session-stats.test.ts`
Expected: FAIL — module does not exist.

- [x] **Step 3: Implement**

```typescript
// src/lib/progress/session-stats.ts
/**
 * Per-session-type stats (spec §6): completion rate, deviation count, duration —
 * all scoped to one `session_key` and shown inline on the progress hub (a handful of
 * cards, not the "wall of charts" per-exercise progress deliberately avoids by
 * drilling down instead).
 */

import type { Logs } from "../logs/types";

export type SessionTypeStats = {
  sessionKey: string;
  /** `undefined` when there are no finished workouts to compute a rate from. */
  completionRate: number | undefined;
  finishedCount: number;
  deviationCount: number;
  duration: { workoutId: string; startedAt: string; minutes: number }[];
};

export function sessionTypeStats(logs: Logs, sessionKey: string): SessionTypeStats {
  const workouts = logs.workouts.filter((w) => w.session_key === sessionKey);
  // completed_at set means the workout was finished (through any final status) — a
  // workout still open (completed_at undefined) is not yet resolved either way.
  const finished = workouts.filter((w) => w.completed_at !== undefined);
  const completed = finished.filter((w) => w.status === "completed");

  const workoutIds = new Set(workouts.map((w) => w.id));
  const deviationCount = logs.deviations.filter((d) => workoutIds.has(d.workout_id)).length;

  const duration = finished
    .map((w) => ({
      workoutId: w.id,
      startedAt: w.started_at,
      minutes: (new Date(w.completed_at as string).getTime() - new Date(w.started_at).getTime()) / 60000,
    }))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  return {
    sessionKey,
    completionRate: finished.length === 0 ? undefined : completed.length / finished.length,
    finishedCount: finished.length,
    deviationCount,
    duration,
  };
}
```

- [x] **Step 4: Run to verify pass**

Run: `npx vitest run tests/progress/session-stats.test.ts`
Expected: PASS, all 5 tests.

- [x] **Step 5: Format, typecheck, commit**

```bash
npx prettier --write src/lib/progress/session-stats.ts tests/progress/session-stats.test.ts
npm run typecheck
git add src/lib/progress/session-stats.ts tests/progress/session-stats.test.ts
git commit -m "feat(progress): add sessionTypeStats

Completion rate, deviation count and duration per session_key, excluding
still-in-progress workouts from the completion rate's denominator.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `metric-series.ts` — generic numeric metric trends

**Files:**
- Create: `src/lib/progress/metric-series.ts`
- Test: `tests/progress/metric-series.test.ts`

**Interfaces:**
- Consumes: `Logs`, `MetricValue` from `src/lib/logs/types.ts`; `GainContract`,
  `MetricDef`, `MetricScope` from `src/lib/contract/schema.ts`.
- Produces (consumed by Tasks 13, 14):
  - `function numericMetricDefs(contract: GainContract): { scope: MetricScope; def: MetricDef }[]`
  - `type MetricSeriesPoint = { workoutId: string; startedAt: string; value: number }`
  - `function numericMetricSeries(logs: Logs, scope: MetricScope, key: string): MetricSeriesPoint[]`

- [x] **Step 1: Write the failing tests**

```typescript
// tests/progress/metric-series.test.ts
import { describe, expect, it } from "vitest";
import type { GainContract } from "../../src/lib/contract/schema";
import { EMPTY_LOGS, type Logs } from "../../src/lib/logs/types";
import { numericMetricDefs, numericMetricSeries } from "../../src/lib/progress/metric-series";

const contract = {
  metrics: {
    set: [{ key: "rpe", label: "Set RPE", type: "scale", min: 1, max: 10 }],
    session: [
      { key: "rpe", label: "Session RPE", type: "scale", min: 1, max: 10 },
      { key: "symptoms_during", label: "Symptoms", type: "text" },
    ],
  },
} as unknown as GainContract;

const logs: Logs = {
  ...EMPTY_LOGS,
  workouts: [
    { id: "w1", session_key: "A", started_at: "2026-08-01T07:00:00Z", status: "completed" },
    { id: "w2", session_key: "A", started_at: "2026-08-08T07:00:00Z", status: "completed" },
  ],
  set_logs: [{ id: "s1", workout_id: "w1", exercise_slug: "goblet-squat", set_no: 1 }],
  metric_values: [
    // Same key, different scope — must stay two series.
    { id: "m1", key: "rpe", ref: { scope: "set", set_log_id: "s1" }, value_num: 5 },
    { id: "m2", key: "rpe", ref: { scope: "session", workout_id: "w1" }, value_num: 9 },
    { id: "m3", key: "rpe", ref: { scope: "session", workout_id: "w2" }, value_num: 7 },
  ],
};

describe("numericMetricDefs", () => {
  it("returns only number/scale metrics, in scope order", () => {
    expect(numericMetricDefs(contract).map((m) => `${m.scope}:${m.def.key}`)).toEqual([
      "set:rpe",
      "session:rpe",
    ]);
  });
});

describe("numericMetricSeries", () => {
  it("keys on (scope, key) — a set-scope rpe value never appears in the session-scope series", () => {
    const series = numericMetricSeries(logs, "session", "rpe");
    expect(series).toEqual([
      { workoutId: "w1", startedAt: "2026-08-01T07:00:00Z", value: 9 },
      { workoutId: "w2", startedAt: "2026-08-08T07:00:00Z", value: 7 },
    ]);
  });

  it("resolves a set-scope value's workout through its set_log", () => {
    const series = numericMetricSeries(logs, "set", "rpe");
    expect(series).toEqual([{ workoutId: "w1", startedAt: "2026-08-01T07:00:00Z", value: 5 }]);
  });

  it("returns an empty array for a key with no values", () => {
    expect(numericMetricSeries(logs, "session", "not-declared")).toEqual([]);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run tests/progress/metric-series.test.ts`
Expected: FAIL — module does not exist.

- [x] **Step 3: Implement**

```typescript
// src/lib/progress/metric-series.ts
/**
 * Any numeric plan-declared metric is chartable (ROADMAP phase 7), keyed on
 * `(scope, key)` — never the bare key, since a plan may legally declare the same key at
 * two scopes (the fixture's `symptoms_during`, at both set and session scope). One
 * function serves every metric regardless of which plan declared it: no per-metric-name
 * branching, matching the discipline `buildProgressSummary` already holds.
 */

import type { GainContract, MetricDef, MetricScope } from "../contract/schema";
import type { Logs } from "../logs/types";

const SCOPE_ORDER: MetricScope[] = ["set", "exercise", "session"];

/** `number`/`scale` are CONTRACT's numeric metric types — `enum`/`text`/`bool` are
 * excluded, matching ROADMAP's "any *numeric* plan-declared metric is chartable". */
export function numericMetricDefs(contract: GainContract): { scope: MetricScope; def: MetricDef }[] {
  const declared: { scope: MetricScope; def: MetricDef }[] = [];
  for (const scope of SCOPE_ORDER) {
    for (const def of contract.metrics?.[scope] ?? []) {
      if (def.type === "number" || def.type === "scale") declared.push({ scope, def });
    }
  }
  return declared;
}

export type MetricSeriesPoint = { workoutId: string; startedAt: string; value: number };

export function numericMetricSeries(logs: Logs, scope: MetricScope, key: string): MetricSeriesPoint[] {
  const workoutById = new Map(logs.workouts.map((w) => [w.id, w]));
  const setLogById = new Map(logs.set_logs.map((s) => [s.id, s]));

  const points: MetricSeriesPoint[] = [];
  for (const value of logs.metric_values) {
    if (value.key !== key || value.ref.scope !== scope || value.value_num === undefined) continue;

    const workoutId =
      value.ref.scope === "set" ? setLogById.get(value.ref.set_log_id)?.workout_id : value.ref.workout_id;
    const workout = workoutId ? workoutById.get(workoutId) : undefined;
    if (!workout) continue;

    points.push({ workoutId: workout.id, startedAt: workout.started_at, value: value.value_num });
  }

  return points.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
```

- [x] **Step 4: Run to verify pass**

Run: `npx vitest run tests/progress/metric-series.test.ts`
Expected: PASS, all 4 tests.

- [x] **Step 5: Format, typecheck, commit**

```bash
npx prettier --write src/lib/progress/metric-series.ts tests/progress/metric-series.test.ts
npm run typecheck
git add src/lib/progress/metric-series.ts tests/progress/metric-series.test.ts
git commit -m "feat(progress): add numericMetricDefs and numericMetricSeries

One generic (scope, key) trend function for every plan-declared numeric
metric — no per-metric-name branching anywhere in this module.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `chart-geometry.ts` — pure SVG layout math

**Files:**
- Create: `src/lib/progress/chart-geometry.ts`
- Test: `tests/progress/chart-geometry.test.ts`

**Interfaces:**
- Consumes: nothing beyond plain numbers.
- Produces (consumed by Tasks 8, 9):
  - `type ChartPoint = { x: number; y: number; label?: string }`
  - `type PlottedPoint = { cx: number; cy: number; label: string | undefined; value: number }`
  - `function layoutLineChart(points: readonly ChartPoint[], width: number, height: number, padding: number): { plotted: PlottedPoint[]; path: string }`
  - `type BarDatum = { value: number; label?: string }`
  - `type PlottedBar = { x: number; y: number; barWidth: number; barHeight: number; label: string | undefined; value: number }`
  - `function layoutBarChart(data: readonly BarDatum[], width: number, height: number, padding: number, gap: number): PlottedBar[]`

- [x] **Step 1: Write the failing tests**

```typescript
// tests/progress/chart-geometry.test.ts
import { describe, expect, it } from "vitest";
import { layoutBarChart, layoutLineChart } from "../../src/lib/progress/chart-geometry";

describe("layoutLineChart", () => {
  it("maps two points to the plot's corners", () => {
    const { plotted, path } = layoutLineChart(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      300,
      100,
      10,
    );
    expect(plotted[0]).toMatchObject({ cx: 10, cy: 90 });
    expect(plotted[1]).toMatchObject({ cx: 290, cy: 10 });
    expect(path).toBe("M 10.0 90.0 L 290.0 10.0");
  });

  it("centers a single point horizontally rather than dividing by a zero span", () => {
    const { plotted } = layoutLineChart([{ x: 5, y: 5 }], 300, 100, 10);
    expect(plotted[0].cx).toBe(150);
  });

  it("returns no plotted points and an empty path for no data", () => {
    expect(layoutLineChart([], 300, 100, 10)).toEqual({ plotted: [], path: "" });
  });

  it("carries the label through to the plotted point", () => {
    const { plotted } = layoutLineChart([{ x: 0, y: 0, label: "12" }], 300, 100, 10);
    expect(plotted[0].label).toBe("12");
  });
});

describe("layoutBarChart", () => {
  it("sizes each bar relative to the tallest value", () => {
    const bars = layoutBarChart([{ value: 10 }, { value: 20 }, { value: 5 }], 100, 50, 5, 2);
    expect(bars[0]).toMatchObject({ x: 5, y: 25, barHeight: 20 });
    expect(bars[1]).toMatchObject({ y: 5, barHeight: 40 });
    expect(bars[2]).toMatchObject({ y: 35, barHeight: 10 });
    expect(bars[0].barWidth).toBeCloseTo((90 - 4) / 3, 4);
  });

  it("returns an empty array for no data", () => {
    expect(layoutBarChart([], 100, 50, 5, 2)).toEqual([]);
  });

  it("treats an all-zero dataset as a flat baseline rather than dividing by zero", () => {
    const bars = layoutBarChart([{ value: 0 }, { value: 0 }], 100, 50, 5, 2);
    expect(bars[0].barHeight).toBe(0);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run tests/progress/chart-geometry.test.ts`
Expected: FAIL — module does not exist.

- [x] **Step 3: Implement**

```typescript
// src/lib/progress/chart-geometry.ts
/**
 * Pure SVG layout math for the hand-rolled charts (spec §9 — one accent hue, no charting
 * dependency). Kept separate from any `.svelte` file so it is unit-testable with exact,
 * hand-calculated pixel expectations rather than a DOM snapshot.
 */

export type ChartPoint = { x: number; y: number; label?: string };
export type PlottedPoint = { cx: number; cy: number; label: string | undefined; value: number };

export function layoutLineChart(
  points: readonly ChartPoint[],
  width: number,
  height: number,
  padding: number,
): { plotted: PlottedPoint[]; path: string } {
  if (points.length === 0) return { plotted: [], path: "" };

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;

  const plotted = points.map((p) => {
    const cx =
      points.length === 1 ? width / 2 : padding + ((p.x - xMin) / xSpan) * (width - 2 * padding);
    const cy = height - padding - ((p.y - yMin) / ySpan) * (height - 2 * padding);
    return { cx, cy, label: p.label, value: p.y };
  });

  const path = plotted
    .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.cx.toFixed(1)} ${pt.cy.toFixed(1)}`)
    .join(" ");

  return { plotted, path };
}

export type BarDatum = { value: number; label?: string };
export type PlottedBar = {
  x: number;
  y: number;
  barWidth: number;
  barHeight: number;
  label: string | undefined;
  value: number;
};

export function layoutBarChart(
  data: readonly BarDatum[],
  width: number,
  height: number,
  padding: number,
  gap: number,
): PlottedBar[] {
  if (data.length === 0) return [];

  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  const plotWidth = width - 2 * padding;
  const plotHeight = height - 2 * padding;
  const barWidth = (plotWidth - gap * (data.length - 1)) / data.length;

  return data.map((d, i) => {
    const barHeight = (d.value / max) * plotHeight;
    return {
      x: padding + i * (barWidth + gap),
      y: height - padding - barHeight,
      barWidth,
      barHeight,
      label: d.label,
      value: d.value,
    };
  });
}
```

- [x] **Step 4: Run to verify pass**

Run: `npx vitest run tests/progress/chart-geometry.test.ts`
Expected: PASS, all 7 tests.

- [x] **Step 5: Format, typecheck, commit**

```bash
npx prettier --write src/lib/progress/chart-geometry.ts tests/progress/chart-geometry.test.ts
npm run typecheck
git add src/lib/progress/chart-geometry.ts tests/progress/chart-geometry.test.ts
git commit -m "feat(progress): add pure line/bar chart layout math

DOM-free SVG geometry so the two Svelte chart components (next part) are
thin renderers over hand-calculated, unit-tested coordinates.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

**Part 1 done when:** `npx vitest run tests/progress/` passes (43 tests across 5 files),
`npm run typecheck` is clean. Nothing outside `src/lib/progress/` has changed. Safe
stopping point — no routes, no UI, nothing user-visible yet.

---

# Part 2 — Export refactor + History read path

Builds on Part 1. Refactors the one existing consumer (`summary.ts`) onto the new shared
module, and adds the one new DB read `History` needs later. No new routes yet.

## Task 6: Refactor `summary.ts` onto `exercise-series.ts` / `double-progression.ts`

**Files:**
- Modify: `src/lib/export/summary.ts`
- Modify: `tests/summary.test.ts`

**Interfaces:**
- Consumes: `exerciseOccurrences`, `buildExerciseSeries` from `src/lib/progress/exercise-series.ts`
  (Task 1); `doubleProgressionState`, `formatReadiness` from
  `src/lib/progress/double-progression.ts` (Task 2).
- Produces: `buildProgressSummary`'s public signature is unchanged
  (`(contract, logs, windowLabel, now) => string`); only its "Per-exercise progression"
  table's content changes (rows now key on `(session, exercise)`, plus a new Readiness
  column). `renderExerciseSets` is untouched.

- [x] **Step 1: Read the current per-exercise section**

Open `src/lib/export/summary.ts` and locate the block starting
`// -- Per-exercise progression, catalogue order, only exercises with logs.` (currently
around line 129) through the `lines.push("");` that ends it (currently around line 179).
This whole block is replaced in Step 3.

- [x] **Step 2: Write the failing test for the new behaviour**

Add to `tests/summary.test.ts`, inside the existing `describe("buildProgressSummary", ...)`
block (reuse the file's existing `contract`/`logs` fixtures where possible, extending
`contract.sessions` to declare goblet-squat in a second session):

```typescript
  it("splits the same exercise into two rows when it's prescribed in two sessions with different ranges", () => {
    const twoSessionContract = {
      ...contract,
      sessions: [
        ...contract.sessions,
        {
          key: "D",
          name: "Session D",
          order: 2,
          blocks: [
            {
              key: "main",
              name: "Main",
              exercises: [{ id: "goblet-squat", sets: 2, reps: [12, 15] }],
            },
          ],
        },
      ],
    } as unknown as GainContract;

    const twoSessionLogs: Logs = {
      ...logs,
      workouts: [
        ...logs.workouts,
        { id: "w3", session_key: "D", started_at: "2026-08-10T07:00:00Z", status: "completed" },
      ],
      set_logs: [
        ...logs.set_logs,
        { id: "s3", workout_id: "w3", exercise_slug: "goblet-squat", set_no: 1, reps: 12 },
      ],
    };

    const summary = buildProgressSummary(twoSessionContract, twoSessionLogs, "full history", NOW);
    const rows = summary.split("\n").filter((l) => l.startsWith("| Goblet squat"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Session A");
    expect(rows[1]).toContain("Session D");
  });

  it("shows a readiness verdict for a ranged prescription", () => {
    const summary = buildProgressSummary(contract, logs, "full history", NOW);
    const row = summary.split("\n").find((l) => l.startsWith("| Goblet squat"));
    // The fixture's own contract here prescribes a scalar `reps: 10` (see the file-level
    // `contract` above) — no range, so the readiness cell is a dash, not a verdict. This
    // pins that a scalar target renders as "no range" rather than a silently blank cell.
    expect(row).toMatch(/\|\s*–\s*\|$/);
  });
```

- [x] **Step 3: Run to verify the second test's premise, then implement**

Run: `npx vitest run tests/summary.test.ts`
Expected: The "splits the same exercise" test FAILs (current code merges into one row);
the "readiness verdict" test currently fails too, because there is no Readiness column at
all yet.

Replace the block identified in Step 1 with:

```typescript
  // -- Per-exercise progression, catalogue order then session order, only occurrences
  // with logs in this window. Keyed on (session, exercise): the same movement can carry
  // a different rep range in different sessions (goblet-squat: [8,12] in A, [12,15] in
  // D), so a bare exercise_slug would compare a set against the wrong range. Readiness
  // is computed from this SAME windowed series, not full history — a row whose "latest
  // logged" is the newest workout inside the window must not sit beside a readiness
  // verdict drawn from a workout outside it (design spec §4, the one documented
  // exception to double-progression reading full history everywhere else).
  const exerciseRows: string[] = [];
  for (const occurrence of exerciseOccurrences(contract)) {
    const series = buildExerciseSeries(logs, occurrence.sessionKey, occurrence.exerciseSlug);
    if (series.length === 0) continue;

    const first = renderExerciseSets(series[0].sets);
    const latest = renderExerciseSets(series[series.length - 1].sets);
    const lastDifficulty = [...series[series.length - 1].sets]
      .reverse()
      .find((s) => s.difficulty !== undefined)?.difficulty;

    const target =
      occurrence.resolved.type === "time" ? occurrence.resolved.durationSec : occurrence.resolved.reps;
    const readinessText = formatReadiness(
      doubleProgressionState(
        series,
        target,
        occurrence.resolved.sets,
        occurrence.resolved.type,
        occurrence.resolved.perSide,
      ),
      "–",
    );

    exerciseRows.push(
      `| ${cell(occurrence.exerciseName)} (\`${occurrence.exerciseSlug}\`) | ${cell(occurrence.sessionName)} | ${series.length} | ${first} | ${latest} | ${lastDifficulty ?? "–"} | ${cell(readinessText)} |`,
    );
  }

  lines.push("### Per-exercise progression");
  lines.push("");
  if (exerciseRows.length === 0) {
    lines.push("No sets logged in this window.");
  } else {
    lines.push("First and latest refer to the first and latest workout in the window.");
    lines.push("");
    lines.push(
      "| Exercise | Session | Workouts | First logged | Latest logged | Last difficulty | Readiness |",
    );
    lines.push("|---|---|---:|---|---|---|---|");
    lines.push(...exerciseRows);
  }
  lines.push("");
```

Update the imports at the top of `src/lib/export/summary.ts`:

```typescript
import type { GainContract, MetricDef, MetricScope } from "../contract/schema";
import { doubleProgressionState, formatReadiness } from "../progress/double-progression";
import { buildExerciseSeries, exerciseOccurrences } from "../progress/exercise-series";
import type { Logs, MetricValue, SetLog, Workout } from "../logs/types";
import { formatNum } from "./csv";
```

`deriveExerciseName` is no longer used directly by this file (occurrence names come from
`ResolvedExercise.name`, which already applies the same fallback internally) — remove it
from the `import { deriveExerciseName } from "../contract/schema"` line, or delete the
whole line if nothing else in the file uses it (check with a search — `renderExerciseSets`
and the rest of `buildProgressSummary` do not call it).

- [x] **Step 4: Run every existing summary/export/golden test**

```bash
npx vitest run tests/summary.test.ts tests/export.test.ts tests/golden.test.ts tests/server/export-route.test.ts
```

Expected: PASS. If an existing test fails on exact table shape (column count, header
text), update that assertion to the new 7-column header — check first whether it was
actually pinning the old shape or just checking a substring; per the design spec, no test
was found pinning the exact merged format, so this should be additive rather than
destructive.

- [x] **Step 5: Format, typecheck, verify, commit**

```bash
npx prettier --write src/lib/export/summary.ts tests/summary.test.ts
npm run typecheck
npm test
git add src/lib/export/summary.ts tests/summary.test.ts
git commit -m "refactor(export): key per-exercise progression on (session, exercise)

buildProgressSummary now shares exercise-series.ts and
double-progression.ts with the app's charts instead of its own inline
grouping — the exact refactor-not-rebuild ROADMAP asked for. The visible
change: an exercise prescribed in two sessions with different rep ranges
(goblet-squat: [8,12] in A, [12,15] in D) now renders as two rows instead
of one merged row, and every row gains a Readiness column.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: `src/lib/db/history.ts` — the one new read History needs

**Files:**
- Create: `src/lib/db/history.ts`
- Test: `tests/db/history.test.ts`

**Interfaces:**
- Consumes: `UserDb` from `src/lib/db/user-db.ts`.
- Produces (consumed by Tasks 15, 16):
  - `function versionsByWorkout(userDb: UserDb, planId: string): Map<string, { versionNo: number; importedAt: string }>`

- [x] **Step 1: Write the failing test**

Mirrors `tests/db/logs.test.ts`'s setup exactly (same helper functions, same fixture,
same revision-building pattern its own "spans every version of the plan" test uses):

```typescript
// tests/db/history.test.ts
/**
 * `versionsByWorkout` is the one join `logsForPlan` doesn't already do — proven here by
 * revising the plan mid-test and checking a workout logged before the revision still
 * reports its own (older) version, not the plan's current one.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { versionsByWorkout } from "../../src/lib/db/history";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { startWorkout } from "../../src/lib/db/workout";
import { parsePlanDocument } from "../../src/lib/parse/parser";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");
const NOW = new Date("2026-09-08T08:00:00Z");

describe("versionsByWorkout", () => {
  let dataDir: string;
  let userDb: UserDb;
  let planId: string;
  let v1Id: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-history-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: NOW });

    const parsed = parsePlanDocument(fixtureMd);
    if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
    const result = importPlan(userDb, { parsed, now: NOW });
    if (!result.ok) throw new Error(result.message);
    planId = result.plan_id;
    v1Id = result.plan_version_id;
  });

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("maps a workout to the version it ran under, across a revision", () => {
    const { id: firstWorkoutId } = startWorkout(userDb, {
      planVersionId: v1Id,
      sessionKey: "A",
      clientId: "c-w1",
      now: NOW,
    });

    // Build v2 from the fixture's own parsed contract, the same way
    // tests/db/logs.test.ts's "spans every version of the plan" test does — not a
    // string replace, which would as happily match `schema_version: 1`.
    const parsedV1 = parsePlanDocument(fixtureMd);
    if (!parsedV1.ok) throw new Error(`fixture failed to parse: ${parsedV1.kind}`);
    const v2Contract = structuredClone(parsedV1.contract);
    v2Contract.plan.version = 2;
    v2Contract.plan.based_on_version = 1;
    const revised = `${parsedV1.context_md}\`\`\`gain-plan\n${stringify(v2Contract)}\`\`\`\n`;
    const parsedV2 = parsePlanDocument(revised);
    if (!parsedV2.ok) throw new Error(`revision failed to parse: ${parsedV2.kind}`);
    const v2Result = importPlan(userDb, { parsed: parsedV2, now: NOW });
    if (!v2Result.ok) throw new Error(v2Result.message);

    const { id: secondWorkoutId } = startWorkout(userDb, {
      planVersionId: v2Result.plan_version_id,
      sessionKey: "B",
      clientId: "c-w2",
      now: NOW,
    });

    const versions = versionsByWorkout(userDb, planId);
    expect(versions.get(firstWorkoutId)?.versionNo).toBe(1);
    expect(versions.get(secondWorkoutId)?.versionNo).toBe(2);
  });

  it("returns an empty map for a plan with no workouts", () => {
    expect(versionsByWorkout(userDb, planId).size).toBe(0);
  });

  it("returns nothing for an unknown plan id", () => {
    expect(versionsByWorkout(userDb, "not-a-plan").size).toBe(0);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run tests/db/history.test.ts`
Expected: FAIL — module does not exist.

- [x] **Step 3: Implement**

```typescript
// src/lib/db/history.ts
/**
 * The one thing `logsForPlan` doesn't carry: which plan version a workout ran under.
 * `Logs.Workout` (the phase-1 export-shaped type) deliberately has no version number —
 * export replays `source_md` verbatim rather than needing one — so History's "Plan v2,
 * imported 2026-07-01" label is a separate, narrow read rather than a widened phase-1
 * type threaded through every existing consumer.
 */

import type { UserDb } from "./user-db";

type Row = { workout_id: string; version_no: number; imported_at: string };

export function versionsByWorkout(
  userDb: UserDb,
  planId: string,
): Map<string, { versionNo: number; importedAt: string }> {
  const rows = userDb.db
    .prepare(
      `SELECT w.id AS workout_id, pv.version_no AS version_no, pv.imported_at AS imported_at
       FROM workout w
       JOIN plan_version pv ON pv.id = w.plan_version_id
       WHERE pv.plan_id = ?`,
    )
    .all(planId) as Row[];

  return new Map(rows.map((r) => [r.workout_id, { versionNo: r.version_no, importedAt: r.imported_at }]));
}
```

- [x] **Step 4: Run to verify pass**

Run: `npx vitest run tests/db/history.test.ts`
Expected: PASS.

- [x] **Step 5: Format, typecheck, commit**

```bash
npx prettier --write src/lib/db/history.ts tests/db/history.test.ts
npm run typecheck
git add src/lib/db/history.ts tests/db/history.test.ts
git commit -m "feat(db): add versionsByWorkout for the History drill-down

The one join logsForPlan doesn't already do — which plan version a
workout ran under — kept separate rather than widening the phase-1 Logs
type for a feature that reads it exactly once.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

**Part 2 done when:** `npm test` passes in full (every existing suite plus the new
`tests/db/history.test.ts`), `npm run typecheck` and `npm run lint` are clean. The export
bundle now shows split rows and readiness — verify by hand: `npm run dev` with
`GAIN_DEV_USER` set, import the fixture, log a couple of sets, generate an export, and
read Section 2's "Per-exercise progression" table.

---

# Part 3 — Chart components + the Progress hub

Builds on Parts 1–2. First UI in this phase. Delivers `/plan/[slug]/progress` with its
session-type cards — a complete, working screen, even though the Exercises/Metrics links
it offers don't resolve to real pages until Parts 4–5.

## Task 8: `Sparkline.svelte` — the shared line chart

**Files:**
- Create: `src/lib/components/Sparkline.svelte`

**Interfaces:**
- Consumes: `layoutLineChart`, `ChartPoint` from `src/lib/progress/chart-geometry.ts` (Task 5).
- Produces (consumed by Tasks 10, 12, 14): a Svelte component with props
  `{ points: ChartPoint[]; width?: number; height?: number; ariaLabel?: string; formatPointLabel: (point: ChartPoint, index: number, all: ChartPoint[]) => string | undefined; formatReadout: (point: ChartPoint) => string; emptyLabel?: string }`.

- [x] **Step 1: Implement**

```svelte
<!-- src/lib/components/Sparkline.svelte -->
<script lang="ts">
  import { layoutLineChart, type ChartPoint } from "$lib/progress/chart-geometry";

  /**
   * A single-series line chart (spec §9: one accent hue, one axis, touch-first). Callers
   * supply both formatters rather than one raw-value formatter, because different
   * callers plot different quantities through the same shape — the load-x-reps chart
   * labels every point with reps while plotting weight; a metric trend labels only its
   * last point, in the metric's own unit.
   *
   * No hover tooltip: this is a phone app. Each mark is its own tap/focus target (the
   * dot IS the hit target, matching how a bar chart's mark already has to work), and the
   * tapped value renders in a caption below the chart rather than a floating layer a
   * thumb would cover.
   */
  let {
    points,
    width = 320,
    height = 120,
    ariaLabel = "trend chart",
    formatPointLabel,
    formatReadout,
    emptyLabel = "No data yet",
  }: {
    points: ChartPoint[];
    width?: number;
    height?: number;
    /** Every chart on a screen says what it is; two charts labelled alike are one
     * chart as far as a screen reader (and a Playwright locator) is concerned. */
    ariaLabel?: string;
    formatPointLabel: (point: ChartPoint, index: number, all: ChartPoint[]) => string | undefined;
    formatReadout: (point: ChartPoint) => string;
    emptyLabel?: string;
  } = $props();

  const padding = 20;
  const layout = $derived(layoutLineChart(points, width, height, padding));
  let tapped = $state<number | undefined>(undefined);
  /**
   * The window picker re-renders this component in place with a different series, so a
   * held index can outlive the point it named — `points[tapped]` would then be
   * `undefined` and `formatReadout` would throw inside the template. Deriving the
   * readout instead of storing it means a stale index simply shows nothing.
   */
  const readout = $derived(tapped !== undefined && points[tapped] ? formatReadout(points[tapped]) : undefined);
</script>

<figure class="sparkline">
  <!-- `role="group"`, not `role="img"`: an image's children are hidden from assistive
       tech, and every point below is a real focusable control with its own label. -->
  <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={ariaLabel}>
    {#if layout.plotted.length > 0}
      <path d={layout.path} class="line" />
      {#each layout.plotted as point, i (i)}
        {@const pointLabel = formatPointLabel(points[i], i, points)}
        <!-- Two circles: the visible 8px mark (spec §9) and a transparent 24px hit
             target over it, because a thumb is not 8px wide. -->
        <circle cx={point.cx} cy={point.cy} r="4" class="dot" />
        <circle
          cx={point.cx}
          cy={point.cy}
          r="12"
          class="hit"
          role="button"
          tabindex="0"
          aria-label={formatReadout(points[i])}
          onclick={() => (tapped = i)}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              tapped = i;
            }
          }}
        />
        {#if pointLabel !== undefined}
          <text x={point.cx} y={point.cy - 10} text-anchor="middle" class="point-label"
            >{pointLabel}</text
          >
        {/if}
      {/each}
    {:else}
      <text x={width / 2} y={height / 2} text-anchor="middle" class="empty">{emptyLabel}</text>
    {/if}
  </svg>
  {#if readout !== undefined}
    <figcaption class="readout">{readout}</figcaption>
  {/if}
</figure>

<style>
  .sparkline {
    margin: 0;
    width: 100%;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
  }
  .line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .dot {
    fill: var(--accent);
    pointer-events: none;
  }
  .hit {
    fill: transparent;
    cursor: pointer;
  }
  .point-label {
    font-size: 10px;
    fill: var(--muted);
  }
  .empty {
    font-size: 12px;
    fill: var(--dim);
  }
  .readout {
    margin-top: 0.35rem;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text);
    text-align: center;
  }
</style>
```

- [x] **Step 2: Format, typecheck, check**

```bash
npx prettier --write src/lib/components/Sparkline.svelte
npm run typecheck
npm run check
```

Expected: no new errors. (No unit test — this repo has no Svelte component test harness;
`npm run check`/`svelte-check` plus the e2e specs in Part 7 are what verify UI code, the
same split every other route in this codebase uses.)

- [x] **Step 3: Commit**

```bash
git add src/lib/components/Sparkline.svelte
git commit -m "feat(progress): add Sparkline, the shared single-series line chart

One accent hue, direct point labels supplied by the caller, tap-to-reveal
readout instead of a hover tooltip — this is a phone app.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: `BarChart.svelte` — the shared bar chart

**Files:**
- Create: `src/lib/components/BarChart.svelte`

**Interfaces:**
- Consumes: `layoutBarChart`, `BarDatum` from `src/lib/progress/chart-geometry.ts` (Task 5).
- Produces (consumed by Tasks 10, 12): a Svelte component with props
  `{ data: BarDatum[]; width?: number; height?: number; ariaLabel?: string; formatReadout: (datum: BarDatum, index: number) => string; barFill?: (datum: BarDatum, index: number) => string; emptyLabel?: string }`.

- [x] **Step 1: Implement**

```svelte
<!-- src/lib/components/BarChart.svelte -->
<script lang="ts">
  import { layoutBarChart, type BarDatum } from "$lib/progress/chart-geometry";

  /**
   * A single-series bar chart. `barFill` defaults to one flat accent fill (volume,
   * duration); the difficulty distribution passes a 3-step sequential accent tint
   * instead, since easy/medium/hard is an ordinal scale, not an identity (dataviz:
   * sequential is the default for a magnitude/ordinal job) — never green/amber/red,
   * which CLAUDE.md reserves for the symptom framework.
   */
  let {
    data,
    width = 320,
    height = 120,
    ariaLabel = "bar chart",
    formatReadout,
    barFill,
    emptyLabel = "No data yet",
  }: {
    data: BarDatum[];
    width?: number;
    height?: number;
    /** See Sparkline: two charts on one screen must not answer to the same name. */
    ariaLabel?: string;
    formatReadout: (datum: BarDatum, index: number) => string;
    barFill?: (datum: BarDatum, index: number) => string;
    emptyLabel?: string;
  } = $props();

  const padding = 20;
  const gap = 4;
  const layout = $derived(layoutBarChart(data, width, height, padding, gap));
  let tapped = $state<number | undefined>(undefined);
  /** A held index can outlive the datum it named when the window picker swaps the
   * series — same reasoning as Sparkline's. */
  const readout = $derived(
    tapped !== undefined && data[tapped] ? formatReadout(data[tapped], tapped) : undefined,
  );
  const fillOf = (datum: BarDatum, index: number) => (barFill ? barFill(datum, index) : "var(--accent)");
</script>

<figure class="bar-chart">
  <!-- `role="group"`, not `role="img"`: the bars below are real focusable controls. -->
  <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={ariaLabel}>
    {#if layout.length > 0}
      {#each layout as bar, i (i)}
        <rect
          x={bar.x}
          y={bar.y}
          width={bar.barWidth}
          height={Math.max(bar.barHeight, 1)}
          fill={fillOf(data[i], i)}
          role="button"
          tabindex="0"
          aria-label={formatReadout(data[i], i)}
          onclick={() => (tapped = i)}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              tapped = i;
            }
          }}
        />
        {#if bar.label !== undefined}
          <text x={bar.x + bar.barWidth / 2} y={height - 4} text-anchor="middle" class="bar-label"
            >{bar.label}</text
          >
        {/if}
      {/each}
    {:else}
      <text x={width / 2} y={height / 2} text-anchor="middle" class="empty">{emptyLabel}</text>
    {/if}
  </svg>
  {#if readout !== undefined}
    <figcaption class="readout">{readout}</figcaption>
  {/if}
</figure>

<style>
  .bar-chart {
    margin: 0;
    width: 100%;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
  }
  rect {
    cursor: pointer;
  }
  .bar-label {
    font-size: 10px;
    fill: var(--muted);
  }
  .empty {
    font-size: 12px;
    fill: var(--dim);
  }
  .readout {
    margin-top: 0.35rem;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text);
    text-align: center;
  }
</style>
```

- [x] **Step 2: Format, typecheck, check**

```bash
npx prettier --write src/lib/components/BarChart.svelte
npm run typecheck
npm run check
```

- [x] **Step 3: Commit**

```bash
git add src/lib/components/BarChart.svelte
git commit -m "feat(progress): add BarChart, the shared single-series bar chart

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: The Progress hub — `/plan/[slug]/progress`

**Files:**
- Create: `src/routes/plan/[slug]/progress/+page.server.ts`
- Create: `src/routes/plan/[slug]/progress/+page.svelte`

**Interfaces:**
- Consumes: `getUserDbFor` (`$lib/server/app-state`); `contractOfVersion`,
  `getCurrentVersion`, `getPlanBySlug` (`$lib/db/read`); `logsForPlan` (`$lib/db/logs`);
  `filterLogsToWindow` (`$lib/export/bundle`); `exportWindowOptions`,
  `resolveExportWindow` (`$lib/export/windows`); `sessionTypeStats`
  (`$lib/progress/session-stats`, Task 3); `Sparkline` (Task 8).
- Produces: the route `/plan/[slug]/progress`, linked from Task 17's Home plan card.

- [x] **Step 1: Implement the load function**

```typescript
// src/routes/plan/[slug]/progress/+page.server.ts
/**
 * The progress hub (design spec §6, §10): one compact card per declared session — no
 * drill-down, a handful of sessions is not the sprawl per-exercise progress avoids by
 * listing then drilling down instead — plus links out to the exercises and metrics
 * lists (Parts 4–5).
 */

import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import { logsForPlan } from "$lib/db/logs";
import { filterLogsToWindow } from "$lib/export/bundle";
import { exportWindowOptions, resolveExportWindow } from "$lib/export/windows";
import { sessionTypeStats } from "$lib/progress/session-stats";

export const load: PageServerLoad = ({ params, locals, url }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan || plan.archived_at) throw error(404, "No such plan");

  const version = getCurrentVersion(userDb, plan.id);
  if (!version) throw error(409, "That plan has no current version");
  const contract = contractOfVersion(version);

  const context = {
    versionNo: version.version_no,
    importedAt: version.imported_at,
    blockLengthWeeks: version.block_length_weeks,
    now: new Date(),
  };
  // A hand-edited `?window=` falls back to the default rather than erroring. That is
  // deliberately unlike the export route, which must `fail(400)`: the window's label is
  // written into the bundle the reviewing AI reads, so a silent substitution there
  // mislabels the document (`windows.ts`). Nothing on a chart screen leaves the app.
  const options = exportWindowOptions(context);
  const windowId = url.searchParams.get("window") ?? options[0].id;
  const window = resolveExportWindow(windowId, context) ?? options[0];

  const logs = logsForPlan(userDb, plan.id);
  const windowed = filterLogsToWindow(logs, window);

  const sessions = contract.sessions.map((session) => {
    const stats = sessionTypeStats(windowed, session.key);
    return {
      key: session.key,
      name: session.name,
      completionRate: stats.completionRate,
      finishedCount: stats.finishedCount,
      deviationCount: stats.deviationCount,
      duration: stats.duration.map((d) => ({
        x: new Date(d.startedAt).getTime(),
        y: Math.round(d.minutes),
      })),
    };
  });

  return {
    planSlug: plan.slug,
    planName: plan.name,
    windowOptions: options.map((o) => ({ id: o.id, label: o.label })),
    selectedWindow: window.id,
    sessions,
  };
};
```

- [x] **Step 2: Implement the page**

```svelte
<!-- src/routes/plan/[slug]/progress/+page.svelte -->
<script lang="ts">
  import { goto } from "$app/navigation";
  import Sparkline from "$lib/components/Sparkline.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  function formatRate(rate: number | undefined): string {
    return rate === undefined ? "No finished workouts yet" : `${Math.round(rate * 100)}% completed`;
  }
</script>

<h1>{data.planName} — progress</h1>

<label class="window-picker">
  Window
  <select
    value={data.selectedWindow}
    onchange={(e) => goto(`?window=${e.currentTarget.value}`, { invalidateAll: true })}
  >
    {#each data.windowOptions as option (option.id)}
      <option value={option.id}>{option.label}</option>
    {/each}
  </select>
</label>

<div class="session-cards">
  {#each data.sessions as session (session.key)}
    <section class="card">
      <h2>{session.name}</h2>
      <p class="stat">{formatRate(session.completionRate)}</p>
      <p class="stat">{session.deviationCount} deviation{session.deviationCount === 1 ? "" : "s"}</p>
      <h3>Duration</h3>
      <Sparkline
        points={session.duration}
        ariaLabel={`${session.name} duration trend chart`}
        formatPointLabel={(p, i, all) => (i === all.length - 1 ? `${p.y}m` : undefined)}
        formatReadout={(p) => `${p.y} min on ${new Date(p.x).toISOString().slice(0, 10)}`}
      />
    </section>
  {/each}
</div>

<nav class="progress-links">
  <a href={`/plan/${data.planSlug}/progress/exercises`}>Per-exercise progress</a>
  <a href={`/plan/${data.planSlug}/progress/metrics`}>Metric trends</a>
</nav>

<style>
  .window-picker {
    display: block;
    margin: 1rem 0;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .window-picker select {
    display: block;
    margin-top: 0.25rem;
    width: 100%;
    padding: 0.6rem 0.75rem;
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
  }
  .session-cards {
    display: grid;
    gap: 1rem;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: 1.25rem;
  }
  .card h2 {
    margin: 0 0 0.5rem;
    font-size: 1.05rem;
  }
  .stat {
    margin: 0 0 0.25rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .progress-links {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 1.25rem;
  }
  .progress-links a {
    display: inline-flex;
    padding: 0.7rem 1.25rem;
    border-radius: var(--r-sm);
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
    font-weight: 700;
  }
</style>
```

- [x] **Step 3: Manual verification**

```bash
GAIN_DEV_USER=you npm run dev
```

Import the fixture, log a couple of sets of any session, visit
`/plan/<slug>/progress`. Expected: one card per session, a duration sparkline on the
session you logged, "No finished workouts yet" on the others (or a rate, once one is
finished), and the two placeholder links at the bottom (they 404 until Parts 4–5 — that's
expected at this point in the plan).

- [x] **Step 4: Format, typecheck, check, commit**

```bash
npx prettier --write src/routes/plan/\[slug\]/progress/+page.server.ts src/routes/plan/\[slug\]/progress/+page.svelte
npm run typecheck
npm run check
git add src/routes/plan/\[slug\]/progress/
git commit -m "feat(progress): add the progress hub with per-session-type cards

/plan/[slug]/progress — completion rate, deviation count and a duration
sparkline per declared session, windowed by the same picker export
already offers. Links to the exercises and metrics lists land in Parts 4
and 5.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

**Part 3 done when:** `/plan/[slug]/progress` is reachable and renders real data for a
plan with logged workouts. `npm run check` and `npm run typecheck` are clean.

---

# Part 4 — Per-exercise progress

Builds on Parts 1–3. Delivers the list-then-drill-down per-exercise screens.

## Task 11: The exercises list — `/plan/[slug]/progress/exercises`

**Files:**
- Create: `src/routes/plan/[slug]/progress/exercises/+page.server.ts`
- Create: `src/routes/plan/[slug]/progress/exercises/+page.svelte`

**Interfaces:**
- Consumes: `exerciseOccurrences`, `buildExerciseSeries` (`$lib/progress/exercise-series`,
  Task 1); `doubleProgressionState`, `formatReadiness`
  (`$lib/progress/double-progression`, Task 2); the same read helpers Task 10 uses.
- Produces: the route `/plan/[slug]/progress/exercises`, linked to by each row's detail
  page (Task 12).

- [ ] **Step 1: Implement the load function**

```typescript
// src/routes/plan/[slug]/progress/exercises/+page.server.ts
/**
 * The per-exercise list (design spec §5, §2 decision 7): a compact row per
 * (session, exercise) occurrence with logs — no charts here, so this screen stays light
 * even at fixture scale (15-25+ occurrences). Readiness reads full unwindowed history,
 * per the general rule (spec §3) — this list is not export's summary.ts, which is the
 * one documented exception.
 */

import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import { logsForPlan } from "$lib/db/logs";
import { buildExerciseSeries, exerciseOccurrences } from "$lib/progress/exercise-series";
import { doubleProgressionState, formatReadiness } from "$lib/progress/double-progression";

export const load: PageServerLoad = ({ params, locals }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan || plan.archived_at) throw error(404, "No such plan");

  const version = getCurrentVersion(userDb, plan.id);
  if (!version) throw error(409, "That plan has no current version");
  const contract = contractOfVersion(version);

  const logs = logsForPlan(userDb, plan.id);

  const rows = exerciseOccurrences(contract).flatMap((occurrence) => {
    const series = buildExerciseSeries(logs, occurrence.sessionKey, occurrence.exerciseSlug);
    if (series.length === 0) return [];

    const target =
      occurrence.resolved.type === "time" ? occurrence.resolved.durationSec : occurrence.resolved.reps;
    const summary = formatReadiness(
      doubleProgressionState(
        series,
        target,
        occurrence.resolved.sets,
        occurrence.resolved.type,
        occurrence.resolved.perSide,
      ),
      "No range to progress through",
    );

    return [
      {
        sessionKey: occurrence.sessionKey,
        sessionName: occurrence.sessionName,
        exerciseSlug: occurrence.exerciseSlug,
        exerciseName: occurrence.exerciseName,
        summary,
      },
    ];
  });

  return { planSlug: plan.slug, rows };
};
```

- [ ] **Step 2: Implement the page**

```svelte
<!-- src/routes/plan/[slug]/progress/exercises/+page.svelte -->
<script lang="ts">
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
</script>

<h1>Exercise progress</h1>

{#if data.rows.length === 0}
  <p class="muted">Nothing logged yet.</p>
{:else}
  <ul class="occurrence-list">
    {#each data.rows as row (row.sessionKey + ":" + row.exerciseSlug)}
      <li>
        <a href={`/plan/${data.planSlug}/progress/exercises/${row.sessionKey}/${row.exerciseSlug}`}>
          <span class="exercise-name">{row.exerciseName}</span>
          <span class="session-name">{row.sessionName}</span>
          <span class="summary">{row.summary}</span>
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .muted {
    color: var(--muted);
  }
  .occurrence-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }
  .occurrence-list a {
    display: grid;
    gap: 0.15rem;
    padding: 0.85rem 1rem;
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--line-soft);
    color: var(--text);
  }
  .exercise-name {
    font-weight: 700;
  }
  .session-name,
  .summary {
    font-size: 0.85rem;
    color: var(--muted);
  }
</style>
```

- [ ] **Step 3: Format, typecheck, check, commit**

```bash
npx prettier --write src/routes/plan/\[slug\]/progress/exercises/+page.server.ts src/routes/plan/\[slug\]/progress/exercises/+page.svelte
npm run typecheck
npm run check
git add src/routes/plan/\[slug\]/progress/exercises/
git commit -m "feat(progress): add the per-exercise occurrences list

One row per (session, exercise) with logs, readiness summarised inline —
no charts on this screen, keeping it light at fixture scale.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: The exercise detail — `/plan/[slug]/progress/exercises/[session]/[exercise]`

**Files:**
- Create: `src/routes/plan/[slug]/progress/exercises/[session]/[exercise]/+page.server.ts`
- Create: `src/routes/plan/[slug]/progress/exercises/[session]/[exercise]/+page.svelte`

**Interfaces:**
- Consumes: `buildExerciseSeries`, `exerciseOccurrences`, `topSetChartPoints`,
  `volumePoints`, `difficultyDistribution` (`$lib/progress/exercise-series`,
  Task 1); `doubleProgressionState`, `formatDoubleProgressionState`
  (`$lib/progress/double-progression`, Task 2); `isoDate` (`$lib/export/summary`);
  `Sparkline` (Task 8), `BarChart` (Task 9).
- Produces: the route each Task 11 row links to.

- [ ] **Step 1: Implement the load function**

```typescript
// src/routes/plan/[slug]/progress/exercises/[session]/[exercise]/+page.server.ts
/**
 * The per-exercise detail (design spec §5): a readiness headline (full, unwindowed
 * history) plus three windowed charts — load x reps (one chart, reps direct-labeled on
 * every point per spec §9), volume, difficulty distribution. Rendered twice, under
 * "Left"/"Right", for a per_side exercise (spec §2, decision 9).
 */

import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import { logsForPlan } from "$lib/db/logs";
import { filterLogsToWindow } from "$lib/export/bundle";
import { exportWindowOptions, resolveExportWindow } from "$lib/export/windows";
import { isoDate } from "$lib/export/summary";
import {
  buildExerciseSeries,
  difficultyDistribution,
  exerciseOccurrences,
  topSetChartPoints,
  volumePoints,
} from "$lib/progress/exercise-series";
import { doubleProgressionState, formatDoubleProgressionState } from "$lib/progress/double-progression";

export const load: PageServerLoad = ({ params, locals, url }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan || plan.archived_at) throw error(404, "No such plan");

  const version = getCurrentVersion(userDb, plan.id);
  if (!version) throw error(409, "That plan has no current version");
  const contract = contractOfVersion(version);

  // Resolved through `exerciseOccurrences` rather than a second walk of the session's
  // blocks: one definition of "the full-tracking occurrence of this exercise in this
  // session", shared with the list this page is reached from and with summary.ts.
  const occurrence = exerciseOccurrences(contract).find(
    (o) => o.sessionKey === params.session && o.exerciseSlug === params.exercise,
  );
  if (!occurrence) throw error(404, "That exercise is not prescribed in this session");
  const resolved = occurrence.resolved;

  const logs = logsForPlan(userDb, plan.id);
  const fullSeries = buildExerciseSeries(logs, params.session, params.exercise);

  const context = {
    versionNo: version.version_no,
    importedAt: version.imported_at,
    blockLengthWeeks: version.block_length_weeks,
    now: new Date(),
  };
  const options = exportWindowOptions(context);
  const windowId = url.searchParams.get("window") ?? options[0].id;
  const window = resolveExportWindow(windowId, context) ?? options[0];
  const windowedSeries = buildExerciseSeries(
    filterLogsToWindow(logs, window),
    params.session,
    params.exercise,
  );

  const target = resolved.type === "time" ? resolved.durationSec : resolved.reps;
  const readiness = doubleProgressionState(
    fullSeries,
    target,
    resolved.sets,
    resolved.type,
    resolved.perSide,
  );

  const sides: ("left" | "right" | undefined)[] = resolved.perSide ? ["left", "right"] : [undefined];

  const charts = sides.map((side) => {
    // Volume is Σ(weight × reps): meaningless without a load, and there are no reps to
    // multiply on a timed movement (spec §5 skips it for `type: time`).
    const effort = topSetChartPoints(windowedSeries, side, resolved.type);
    const volPoints =
      resolved.type === "reps" && effort.plots === "load" ? volumePoints(windowedSeries, side) : undefined;
    return {
      side,
      readiness:
        readiness === undefined
          ? undefined
          : formatDoubleProgressionState(readiness[side ?? "none"] ?? { status: "no_data" }),
      // "Load × reps" only when there is a load; otherwise the effort itself is the
      // series, and the heading says which (see topSetChartPoints).
      effortHeading:
        effort.plots === "load"
          ? resolved.type === "time"
            ? "Load × time"
            : "Load × reps"
          : resolved.type === "time"
            ? "Time held"
            : "Reps",
      effortUnit: effort.unit,
      effortLabelUnit: resolved.type === "time" ? "s" : "reps",
      loadReps: effort.points.map((p) => ({
        x: new Date(p.startedAt).getTime(),
        y: p.value,
        label: p.label,
      })),
      volume: volPoints?.map((p) => ({ value: p.volumeKg })),
      volumeDates: volPoints?.map((p) => isoDate(new Date(p.startedAt))),
      difficulty: difficultyDistribution(windowedSeries, side),
    };
  });

  return {
    planSlug: plan.slug,
    sessionName: occurrence.sessionName,
    exerciseName: occurrence.exerciseName,
    windowOptions: options.map((o) => ({ id: o.id, label: o.label })),
    selectedWindow: window.id,
    charts,
  };
};
```

- [ ] **Step 2: Implement the page**

```svelte
<!-- src/routes/plan/[slug]/progress/exercises/[session]/[exercise]/+page.svelte -->
<script lang="ts">
  import { goto } from "$app/navigation";
  import Sparkline from "$lib/components/Sparkline.svelte";
  import BarChart from "$lib/components/BarChart.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  function difficultyBars(counts: { easy: number; medium: number; hard: number }) {
    return [
      { value: counts.easy, label: "Easy" },
      { value: counts.medium, label: "Medium" },
      { value: counts.hard, label: "Hard" },
    ];
  }

  const DIFFICULTY_FILLS = [
    "color-mix(in srgb, var(--accent) 35%, var(--surface))",
    "color-mix(in srgb, var(--accent) 65%, var(--surface))",
    "var(--accent)",
  ];
  function difficultyFill(_datum: unknown, index: number) {
    return DIFFICULTY_FILLS[index];
  }
</script>

<h1>{data.exerciseName}</h1>
<p class="muted">{data.sessionName}</p>

<label class="window-picker">
  Window
  <select
    value={data.selectedWindow}
    onchange={(e) => goto(`?window=${e.currentTarget.value}`, { invalidateAll: true })}
  >
    {#each data.windowOptions as option (option.id)}
      <option value={option.id}>{option.label}</option>
    {/each}
  </select>
</label>

{#each data.charts as chart (chart.side ?? "none")}
  <section class="card">
    {#if chart.side}
      <h2>{chart.side === "left" ? "Left" : "Right"}</h2>
    {/if}
    {#if chart.readiness}
      <p class="readiness">{chart.readiness}</p>
    {/if}

    <h3>{chart.effortHeading}</h3>
    <Sparkline
      points={chart.loadReps}
      ariaLabel={`${chart.effortHeading} trend chart`}
      formatPointLabel={(p) => p.label}
      formatReadout={(p) =>
        `${p.y} ${chart.effortUnit} on ${new Date(p.x).toISOString().slice(0, 10)}${
          p.label ? ` × ${p.label} ${chart.effortLabelUnit}` : ""
        }`}
    />

    {#if chart.volume && chart.volumeDates}
      <h3>Volume</h3>
      <BarChart
        data={chart.volume}
        ariaLabel="volume bar chart"
        formatReadout={(d, i) => `${d.value.toFixed(1)} kg on ${chart.volumeDates?.[i]}`}
      />
    {/if}

    <h3>Difficulty</h3>
    <BarChart
      data={difficultyBars(chart.difficulty)}
      ariaLabel="difficulty bar chart"
      formatReadout={(d) => `${d.label}: ${d.value}`}
      barFill={difficultyFill}
    />
  </section>
{/each}

<style>
  .muted {
    color: var(--muted);
    margin: 0 0 1rem;
  }
  .window-picker {
    display: block;
    margin-bottom: 1rem;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .window-picker select {
    display: block;
    margin-top: 0.25rem;
    width: 100%;
    padding: 0.6rem 0.75rem;
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: 1.25rem;
    margin-bottom: 1rem;
  }
  .card h2 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
  }
  .card h3 {
    margin: 1rem 0 0.4rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .readiness {
    font-weight: 700;
    margin: 0;
  }
</style>
```

- [ ] **Step 3: Manual verification**

With the dev server running, log two or three sets of goblet-squat in session A, visit
`/plan/<slug>/progress/exercises`, click into the goblet-squat/A row. Expected: a
readiness line, a load-x-reps chart with a labeled point, a volume chart, a difficulty
chart (likely all zero if difficulty was never logged — the difficulty bars should
still render at zero height rather than error).

Then do the same for a bodyweight movement (session D's Dead bug) and a timed per-side
one (session A's Side plank from knees). Expected: the first chart is headed "Reps" /
"Time held" and plots those values rather than a flat zero-load line, no volume chart at
all, and the per-side movement renders the whole card twice under Left and Right.

- [ ] **Step 4: Format, typecheck, check, commit**

```bash
npx prettier --write "src/routes/plan/[slug]/progress/exercises/[session]/[exercise]/+page.server.ts" "src/routes/plan/[slug]/progress/exercises/[session]/[exercise]/+page.svelte"
npm run typecheck
npm run check
git add "src/routes/plan/[slug]/progress/exercises/[session]/[exercise]/"
git commit -m "feat(progress): add the per-exercise detail page

Readiness headline (full history) plus three windowed charts — load x
reps as one axis with reps direct-labeled per point, volume, difficulty
distribution. Renders twice under Left/Right for a per_side exercise.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

**Part 4 done when:** every row on the exercises list opens a working detail page whose
charts render. Check both shapes by hand: a loaded movement (goblet squat — load plotted,
reps direct-labelled, plus volume and difficulty) and a bodyweight or timed one (dead-bug,
side plank — reps or seconds plotted, no volume chart, difficulty still there).
`npm run typecheck`/`npm run check` clean.

---

# Part 5 — Metric trends

Builds on Parts 1–4 (independent of Part 4's routes at the code level — only the nav
links tie them together). Mirrors Part 4's list-then-detail shape for metrics.

## Task 13: The metrics list — `/plan/[slug]/progress/metrics`

**Files:**
- Create: `src/routes/plan/[slug]/progress/metrics/+page.server.ts`
- Create: `src/routes/plan/[slug]/progress/metrics/+page.svelte`

**Interfaces:**
- Consumes: `numericMetricDefs`, `numericMetricSeries` (`$lib/progress/metric-series`,
  Task 4).
- Produces: the route `/plan/[slug]/progress/metrics`, linked to by each row's detail
  page (Task 14).

- [ ] **Step 1: Implement the load function**

```typescript
// src/routes/plan/[slug]/progress/metrics/+page.server.ts
/**
 * The metric trends list (design spec §7): one row per (scope, key) with logged values.
 * Non-numeric metrics never appear — numericMetricDefs already filters to number/scale.
 */

import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import { logsForPlan } from "$lib/db/logs";
import { numericMetricDefs, numericMetricSeries } from "$lib/progress/metric-series";

export const load: PageServerLoad = ({ params, locals }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan || plan.archived_at) throw error(404, "No such plan");

  const version = getCurrentVersion(userDb, plan.id);
  if (!version) throw error(409, "That plan has no current version");
  const contract = contractOfVersion(version);

  const logs = logsForPlan(userDb, plan.id);

  const metrics = numericMetricDefs(contract)
    .map(({ scope, def }) => {
      const series = numericMetricSeries(logs, scope, def.key);
      return {
        scope,
        key: def.key,
        label: def.label,
        count: series.length,
        latest: series.at(-1)?.value,
      };
    })
    .filter((m) => m.count > 0);

  return { planSlug: plan.slug, metrics };
};
```

- [ ] **Step 2: Implement the page**

```svelte
<!-- src/routes/plan/[slug]/progress/metrics/+page.svelte -->
<script lang="ts">
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
</script>

<h1>Metric trends</h1>

{#if data.metrics.length === 0}
  <p class="muted">No numeric metrics logged yet.</p>
{:else}
  <ul class="metric-list">
    {#each data.metrics as metric (metric.scope + ":" + metric.key)}
      <li>
        <a href={`/plan/${data.planSlug}/progress/metrics/${metric.scope}/${metric.key}`}>
          <span class="metric-label">{metric.label}</span>
          <span class="metric-scope">{metric.scope} scope · latest {metric.latest}</span>
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .muted {
    color: var(--muted);
  }
  .metric-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }
  .metric-list a {
    display: grid;
    gap: 0.15rem;
    padding: 0.85rem 1rem;
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--line-soft);
    color: var(--text);
  }
  .metric-label {
    font-weight: 700;
  }
  .metric-scope {
    font-size: 0.85rem;
    color: var(--muted);
  }
</style>
```

- [ ] **Step 3: Format, typecheck, check, commit**

```bash
npx prettier --write src/routes/plan/\[slug\]/progress/metrics/+page.server.ts src/routes/plan/\[slug\]/progress/metrics/+page.svelte
npm run typecheck
npm run check
git add src/routes/plan/\[slug\]/progress/metrics/
git commit -m "feat(progress): add the metric trends list

One row per (scope, key) with logged numeric values.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 14: The metric detail — `/plan/[slug]/progress/metrics/[scope]/[key]`

**Files:**
- Create: `src/routes/plan/[slug]/progress/metrics/[scope]/[key]/+page.server.ts`
- Create: `src/routes/plan/[slug]/progress/metrics/[scope]/[key]/+page.svelte`

**Interfaces:**
- Consumes: `numericMetricDefs`, `numericMetricSeries` (Task 4); `Sparkline` (Task 8).
- Produces: the route each Task 13 row links to.

- [ ] **Step 1: Implement the load function**

```typescript
// src/routes/plan/[slug]/progress/metrics/[scope]/[key]/+page.server.ts
import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import { logsForPlan } from "$lib/db/logs";
import { filterLogsToWindow } from "$lib/export/bundle";
import { exportWindowOptions, resolveExportWindow } from "$lib/export/windows";
import { numericMetricDefs, numericMetricSeries } from "$lib/progress/metric-series";

const SCOPES = ["set", "exercise", "session"] as const;

export const load: PageServerLoad = ({ params, locals, url }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");
  if (!(SCOPES as readonly string[]).includes(params.scope)) {
    throw error(404, "No such metric scope");
  }
  const scope = params.scope as (typeof SCOPES)[number];

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan || plan.archived_at) throw error(404, "No such plan");

  const version = getCurrentVersion(userDb, plan.id);
  if (!version) throw error(409, "That plan has no current version");
  const contract = contractOfVersion(version);

  const declared = numericMetricDefs(contract).find(
    (m) => m.scope === scope && m.def.key === params.key,
  );
  if (!declared) throw error(404, "No such metric");

  const logs = logsForPlan(userDb, plan.id);

  const context = {
    versionNo: version.version_no,
    importedAt: version.imported_at,
    blockLengthWeeks: version.block_length_weeks,
    now: new Date(),
  };
  const options = exportWindowOptions(context);
  const windowId = url.searchParams.get("window") ?? options[0].id;
  const window = resolveExportWindow(windowId, context) ?? options[0];

  const series = numericMetricSeries(filterLogsToWindow(logs, window), scope, params.key);

  return {
    planSlug: plan.slug,
    label: declared.def.label,
    windowOptions: options.map((o) => ({ id: o.id, label: o.label })),
    selectedWindow: window.id,
    points: series.map((p) => ({ x: new Date(p.startedAt).getTime(), y: p.value })),
  };
};
```

- [ ] **Step 2: Implement the page**

```svelte
<!-- src/routes/plan/[slug]/progress/metrics/[scope]/[key]/+page.svelte -->
<script lang="ts">
  import { goto } from "$app/navigation";
  import Sparkline from "$lib/components/Sparkline.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<h1>{data.label}</h1>

<label class="window-picker">
  Window
  <select
    value={data.selectedWindow}
    onchange={(e) => goto(`?window=${e.currentTarget.value}`, { invalidateAll: true })}
  >
    {#each data.windowOptions as option (option.id)}
      <option value={option.id}>{option.label}</option>
    {/each}
  </select>
</label>

<Sparkline
  points={data.points}
  ariaLabel={`${data.label} trend chart`}
  formatPointLabel={(p, i, all) => (i === all.length - 1 ? String(p.y) : undefined)}
  formatReadout={(p) => `${p.y} on ${new Date(p.x).toISOString().slice(0, 10)}`}
/>

<style>
  .window-picker {
    display: block;
    margin-bottom: 1rem;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .window-picker select {
    display: block;
    margin-top: 0.25rem;
    width: 100%;
    padding: 0.6rem 0.75rem;
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
  }
</style>
```

- [ ] **Step 3: Format, typecheck, check, commit**

```bash
npx prettier --write "src/routes/plan/[slug]/progress/metrics/[scope]/[key]/+page.server.ts" "src/routes/plan/[slug]/progress/metrics/[scope]/[key]/+page.svelte"
npm run typecheck
npm run check
git add "src/routes/plan/[slug]/progress/metrics/[scope]/[key]/"
git commit -m "feat(progress): add the metric trend detail page

One line chart per (scope, key), windowed by the shared picker.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

**Part 5 done when:** every row on the metrics list opens a working chart.
`npm run typecheck`/`npm run check` clean.

---

# Part 6 — History

Builds on Part 2 (`history.ts`) and Part 1. Independent of Parts 3–5 at the code level.

## Task 15: The History list — `/plan/[slug]/history`

**Files:**
- Create: `src/routes/plan/[slug]/history/+page.server.ts`
- Create: `src/routes/plan/[slug]/history/+page.svelte`

**Interfaces:**
- Consumes: `versionsByWorkout` (`$lib/db/history`, Task 7); `logsForPlan`.
- Produces: the route `/plan/[slug]/history`, linked to by each row's detail page
  (Task 16).

- [ ] **Step 1: Implement the load function**

```typescript
// src/routes/plan/[slug]/history/+page.server.ts
/**
 * Reverse-chronological, paginated in memory (design spec §8) — a fixed page size
 * rather than the full history at once, as a safety margin for a very long history
 * rather than a response to a known problem.
 */

import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import { logsForPlan } from "$lib/db/logs";
import { versionsByWorkout } from "$lib/db/history";

const PAGE_SIZE = 20;

export const load: PageServerLoad = ({ params, locals, url }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan || plan.archived_at) throw error(404, "No such plan");

  const logs = logsForPlan(userDb, plan.id);
  const versions = versionsByWorkout(userDb, plan.id);

  // Session *names*, per spec §8 — a bare key ("A") is an identifier, not a label a
  // person recognises. Names come from the plan as it stands now; a workout logged
  // under an older version whose names differ falls back to its key rather than
  // reading a second version's contract per row.
  const current = getCurrentVersion(userDb, plan.id);
  const sessionNames = new Map(
    current ? contractOfVersion(current).sessions.map((s) => [s.key, s.name]) : [],
  );

  const sorted = [...logs.workouts].sort((a, b) => b.started_at.localeCompare(a.started_at));
  const page = Math.max(0, Math.floor(Number(url.searchParams.get("page") ?? "0")) || 0);
  const pageWorkouts = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return {
    planSlug: plan.slug,
    planName: plan.name,
    page,
    hasMore: sorted.length > (page + 1) * PAGE_SIZE,
    workouts: pageWorkouts.map((w) => ({
      id: w.id,
      sessionKey: w.session_key,
      sessionName: sessionNames.get(w.session_key) ?? w.session_key,
      startedAt: w.started_at,
      status: w.status,
      setCount: logs.set_logs.filter((s) => s.workout_id === w.id).length,
      versionNo: versions.get(w.id)?.versionNo,
    })),
  };
};
```

- [ ] **Step 2: Implement the page**

```svelte
<!-- src/routes/plan/[slug]/history/+page.svelte -->
<script lang="ts">
  import { goto } from "$app/navigation";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
</script>

<h1>{data.planName} — history</h1>

{#if data.workouts.length === 0}
  <p class="muted">No workouts logged yet.</p>
{:else}
  <ul class="workout-list">
    {#each data.workouts as workout (workout.id)}
      <li>
        <a href={`/plan/${data.planSlug}/history/${workout.id}`}>
          <span class="date">{new Date(workout.startedAt).toISOString().slice(0, 10)}</span>
          <span class="session">{workout.sessionKey} · {workout.sessionName}</span>
          <span class="detail"
            >{workout.status} · {workout.setCount} sets{workout.versionNo
              ? ` · v${workout.versionNo}`
              : ""}</span
          >
        </a>
      </li>
    {/each}
  </ul>
{/if}

<div class="pager">
  {#if data.page > 0}
    <button type="button" onclick={() => goto(`?page=${data.page - 1}`)}>Newer</button>
  {/if}
  {#if data.hasMore}
    <button type="button" onclick={() => goto(`?page=${data.page + 1}`)}>Older</button>
  {/if}
</div>

<style>
  .muted {
    color: var(--muted);
  }
  .workout-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }
  .workout-list a {
    display: grid;
    gap: 0.15rem;
    padding: 0.85rem 1rem;
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--line-soft);
    color: var(--text);
  }
  .date {
    font-weight: 700;
  }
  .session,
  .detail {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .pager {
    display: flex;
    gap: 0.6rem;
    margin-top: 1rem;
  }
  .pager button {
    padding: 0.6rem 1.1rem;
    border-radius: var(--r-sm);
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
    font-weight: 700;
  }
</style>
```

- [ ] **Step 3: Format, typecheck, check, commit**

```bash
npx prettier --write src/routes/plan/\[slug\]/history/+page.server.ts src/routes/plan/\[slug\]/history/+page.svelte
npm run typecheck
npm run check
git add src/routes/plan/\[slug\]/history/
git commit -m "feat(history): add the reverse-chronological workout list

Paginated in memory, 20 per page, across every version of the plan.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 16: The History detail — `/plan/[slug]/history/[workoutId]`

**Files:**
- Create: `src/routes/plan/[slug]/history/[workoutId]/+page.server.ts`
- Create: `src/routes/plan/[slug]/history/[workoutId]/+page.svelte`

**Interfaces:**
- Consumes: `renderExerciseSets`, `isoDate` (`$lib/export/summary`); `deriveExerciseName`
  (`$lib/contract/schema`); `versionsByWorkout` (Task 7).
- Produces: the route each Task 15 row links to.

- [ ] **Step 1: Implement the load function**

```typescript
// src/routes/plan/[slug]/history/[workoutId]/+page.server.ts
/**
 * Full detail for one workout (design spec §8): every set rendered with
 * `renderExerciseSets`, reused verbatim from the export so a workout reads identically
 * here and in a bundle; every deviation; every metric value; the plan version as plain
 * text, per spec §2 decision 6 — no drill-in, since browsing an old version's document
 * is a separate, unbuilt ROADMAP loose end.
 */

import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import { logsForPlan } from "$lib/db/logs";
import { versionsByWorkout } from "$lib/db/history";
import { deriveExerciseName } from "$lib/contract/schema";
import { renderExerciseSets } from "$lib/export/summary";
import type { SetLog } from "$lib/logs/types";

export const load: PageServerLoad = ({ params, locals }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan || plan.archived_at) throw error(404, "No such plan");

  const logs = logsForPlan(userDb, plan.id);
  const workout = logs.workouts.find((w) => w.id === params.workoutId);
  if (!workout) throw error(404, "No such workout");

  const version = versionsByWorkout(userDb, plan.id).get(workout.id);

  // Catalogue names, not derived ones: `deriveExerciseName("db-floor-press")` is "Db
  // floor press" where the plan — and the runner the user logged this in — says
  // "Dumbbell floor press". Derivation stays as the fallback for a slug the current
  // version no longer declares, which is exactly what the contract itself specifies.
  const current = getCurrentVersion(userDb, plan.id);
  const contract = current ? contractOfVersion(current) : undefined;
  const exerciseNames = new Map(
    contract?.exercises.map((e) => [e.id, e.name ?? deriveExerciseName(e.id)]) ?? [],
  );
  const sessionName = contract?.sessions.find((s) => s.key === workout.session_key)?.name;

  const setsByExercise = new Map<string, SetLog[]>();
  for (const set of logs.set_logs) {
    if (set.workout_id !== workout.id) continue;
    const list = setsByExercise.get(set.exercise_slug) ?? [];
    list.push(set);
    setsByExercise.set(set.exercise_slug, list);
  }
  const exercises = [...setsByExercise.entries()].map(([slug, sets]) => ({
    slug,
    name: exerciseNames.get(slug) ?? deriveExerciseName(slug),
    rendered: renderExerciseSets(sets),
  }));

  const setLogById = new Map(logs.set_logs.map((s) => [s.id, s]));
  const metrics = logs.metric_values
    .filter((v) =>
      v.ref.scope === "set"
        ? setLogById.get(v.ref.set_log_id)?.workout_id === workout.id
        : v.ref.workout_id === workout.id,
    )
    .map((v) => ({
      scope: v.ref.scope,
      key: v.key,
      value: v.value_num !== undefined ? String(v.value_num) : (v.value_text ?? "–"),
    }));

  const deviations = logs.deviations
    .filter((d) => d.workout_id === workout.id)
    .map((d) => ({
      exerciseSlug: d.exercise_slug,
      kind: d.kind,
      reasonCode: d.reason_code,
      note: d.note,
      substituteSlug: d.substitute_exercise_slug,
    }));

  return {
    planSlug: plan.slug,
    workout: {
      sessionKey: workout.session_key,
      sessionName,
      startedAt: workout.started_at,
      status: workout.status,
      note: workout.note,
    },
    version,
    exercises,
    metrics,
    deviations,
  };
};
```

- [ ] **Step 2: Implement the page**

```svelte
<!-- src/routes/plan/[slug]/history/[workoutId]/+page.svelte -->
<script lang="ts">
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
</script>

<h1>Session {data.workout.sessionKey}{data.workout.sessionName ? ` — ${data.workout.sessionName}` : ""}</h1>
<p class="muted">
  {new Date(data.workout.startedAt).toISOString().slice(0, 10)} · {data.workout.status}
  {#if data.version}
    · Plan v{data.version.versionNo}, imported {data.version.importedAt.slice(0, 10)}
  {/if}
</p>
{#if data.workout.note}
  <p class="note">{data.workout.note}</p>
{/if}

<h2>Sets</h2>
{#if data.exercises.length === 0}
  <p class="muted">No sets logged.</p>
{:else}
  <ul class="exercise-list">
    {#each data.exercises as exercise (exercise.slug)}
      <li><strong>{exercise.name}</strong> — {exercise.rendered}</li>
    {/each}
  </ul>
{/if}

{#if data.metrics.length > 0}
  <h2>Metrics</h2>
  <ul class="metric-list">
    {#each data.metrics as metric (metric.scope + ":" + metric.key)}
      <li>{metric.key} ({metric.scope}): {metric.value}</li>
    {/each}
  </ul>
{/if}

{#if data.deviations.length > 0}
  <h2>Deviations</h2>
  <ul class="deviation-list">
    {#each data.deviations as deviation, i (i)}
      <li>
        {deviation.exerciseSlug} — {deviation.kind}
        {#if deviation.substituteSlug}&rarr; {deviation.substituteSlug}{/if}
        {#if deviation.note}: {deviation.note}{/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .muted {
    color: var(--muted);
  }
  .note {
    font-style: italic;
  }
  .exercise-list,
  .metric-list,
  .deviation-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.4rem;
  }
</style>
```

- [ ] **Step 3: Manual verification**

Visit `/plan/<slug>/history`, click into a logged workout. Expected: sets rendered the
same way they'd appear in an export bundle, the plan version stated as text, no crash on
a workout with no deviations or metrics.

- [ ] **Step 4: Format, typecheck, check, commit**

```bash
npx prettier --write "src/routes/plan/[slug]/history/[workoutId]/+page.server.ts" "src/routes/plan/[slug]/history/[workoutId]/+page.svelte"
npm run typecheck
npm run check
git add "src/routes/plan/[slug]/history/[workoutId]/"
git commit -m "feat(history): add the workout detail drill-down

Reuses renderExerciseSets verbatim so a workout reads identically here
and in an exported bundle. Plan version stated as plain text only — no
version-viewer drill-in, per design spec §2 decision 6.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

**Part 6 done when:** History is fully browsable, list to detail.
`npm run typecheck`/`npm run check` clean.

---

# Part 7 — Wiring, e2e proof, documentation close

Builds on every prior part. This is the part that makes the phase actually reachable
from Home, proves it end-to-end, and closes the books.

## Task 17: Home plan-card links

**Files:**
- Modify: `src/routes/+page.svelte`

**Interfaces:**
- Consumes: nothing new — this is markup only.
- Produces: two new links, reachable from every plan card.

- [ ] **Step 1: Add the links**

In `src/routes/+page.svelte`, find the existing Export link (currently around line 267):

```svelte
      <a class="export-link" href={`/plan/${plan.slug}/export`}>
        <IconExternalLink />Export for review
      </a>
```

Wrap it and two new links in one flex container, inside the same
`<section class="card plan-admin">`:

```svelte
      <nav class="plan-links">
        <a class="export-link" href={`/plan/${plan.slug}/export`}>
          <IconExternalLink />Export for review
        </a>
        <a class="export-link" href={`/plan/${plan.slug}/progress`}>
          <IconTrendingUp />Progress
        </a>
        <a class="export-link" href={`/plan/${plan.slug}/history`}>
          <IconHistory />History
        </a>
      </nav>
```

Add the two new icon imports beside the existing ones near the top of the file:

```svelte
  import IconHistory from "~icons/lucide/history";
  import IconTrendingUp from "~icons/lucide/trending-up";
```

(keep the existing import block's alphabetical order if it has one — check the current
list before inserting).

The container is what makes them stack: `.export-link` is `display: inline-flex`, so
three bare siblings flow into one line box and wrap mid-row at 360 px — a
`margin-top` sibling rule would not separate them. Add the container's own rule inside
the existing `<style>` block, near the existing `.export-link` rules:

```css
  .plan-links {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
```

- [ ] **Step 2: Manual verification**

`GAIN_DEV_USER=you npm run dev`, visit `/`, confirm both new links appear under a plan
and navigate correctly.

- [ ] **Step 3: Format, typecheck, check, commit**

```bash
npx prettier --write src/routes/+page.svelte
npm run typecheck
npm run check
git add src/routes/+page.svelte
git commit -m "feat(home): link Progress and History from the plan card

Same pattern as the existing Export link — phase 7b's screens are now
reachable from the app rather than orphan routes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 18: e2e — `progress-walkthrough.spec.ts`

**Files:**
- Create: `e2e/progress-walkthrough.spec.ts`

**Interfaces:**
- Consumes: `E2E_PLAN_SLUG` (`./env`); `assertNoHorizontalOverflow`,
  `dismissPreSessionPrompt`, `logSetThroughRest`, `openExercise` (`./helpers`).

- [ ] **Step 1: Write the spec**

```typescript
// e2e/progress-walkthrough.spec.ts
/**
 * Phase 7b's own durable proof (spec §11): goblet-squat is prescribed in both session A
 * ([8,12]) and session D ([12,15]) of the fixture — logging it in both and finding two
 * separate rows on the exercises list is the one behaviour that would silently regress
 * to a merged row if buildExerciseSeries ever went back to keying on a bare
 * exercise_slug.
 */

import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import {
  assertNoHorizontalOverflow,
  dismissPreSessionPrompt,
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
}

test("goblet squat, prescribed in two sessions, tracks as two separate progress rows", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await logGobletSquat(page, "A", 3);
  await logGobletSquat(page, "D", 2);

  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress/exercises`);
  const rows = page.getByRole("listitem").filter({ hasText: "Goblet squat" });
  await expect(rows).toHaveCount(2);

  await rows.first().getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Goblet squat" })).toBeVisible();
  // Goblet squat carries a load, so the first chart plots it; a bodyweight movement
  // would plot reps instead and be headed differently (topSetChartPoints, Task 1).
  await expect(page.locator('svg[aria-label="Load × reps trend chart"]')).toBeVisible();
  await expect(page.locator('svg[aria-label="volume bar chart"]')).toBeVisible();
  await expect(page.locator('svg[aria-label="difficulty bar chart"]')).toBeVisible();

  await assertNoHorizontalOverflow(page);
});

test("the progress hub shows a session card with a duration chart", async ({ page }) => {
  await logGobletSquat(page, "A", 1);

  await page.goto(`/plan/${E2E_PLAN_SLUG}/progress`);
  await expect(page.getByRole("heading", { name: "Squat, Press & Row" })).toBeVisible();
  await expect(
    page.locator('svg[aria-label="Squat, Press & Row duration trend chart"]'),
  ).toBeVisible();

  await assertNoHorizontalOverflow(page);
});
```

- [ ] **Step 2: Run**

```bash
npx playwright test --project=iphone e2e/progress-walkthrough.spec.ts
```

Expected: PASS (adjust selectors if a prior task's actual markup diverged slightly from
this plan — the load-bearing assertions are the row *count* and the chart `aria-label`s,
not exact class names).

- [ ] **Step 3: Format, verify full suite, commit**

```bash
npx prettier --write e2e/progress-walkthrough.spec.ts
npm run verify
git add e2e/progress-walkthrough.spec.ts
git commit -m "test(e2e): add the progress walkthrough

Proves the (session_key, exercise_slug) keying end-to-end: goblet squat
logged in both session A and D produces two separate rows, not one
merged one.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 19: e2e — `history-walkthrough.spec.ts`

**Files:**
- Create: `e2e/history-walkthrough.spec.ts`

**Interfaces:**
- Consumes: same helpers as Task 18, plus a new `workoutIdOf` beside the existing
  `workoutStatusOf`/`workoutCountFor` direct reads in `e2e/helpers.ts`.

- [ ] **Step 1: Add the `workoutIdOf` helper**

Every spec in this suite runs against **one shared seeded database** — three viewport
projects in parallel, `fullyParallel: true` (`playwright.config.ts`). History lists every
workout of the plan, including ones another project's spec is mid-way through logging, so
`getByRole("listitem").filter({ hasText: "…" }).first()` can land on a *different* test's
workout that has no sets in it yet. Resolve the row this spec created by its own
`client_id` instead, the way `setLogsOf` and `workoutStatusOf` already do:

```typescript
/** This workout's server-side `id`, so a spec can address its own History row directly
 * rather than scanning a list every other spec is also writing into. */
export function workoutIdOf(clientId: string): string | undefined {
  const db = openSeededUserDb(seededDataDir());
  try {
    const row = db.prepare("SELECT id FROM workout WHERE client_id = ?").get(clientId) as
      | { id: string }
      | undefined;
    return row?.id;
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: Write the spec**

```typescript
// e2e/history-walkthrough.spec.ts
import { expect, test } from "@playwright/test";
import { E2E_PLAN_SLUG } from "./env";
import {
  assertNoHorizontalOverflow,
  dismissPreSessionPrompt,
  logSetThroughRest,
  workoutClientId,
  workoutIdOf,
} from "./helpers";

test("a logged workout appears in History and drills into matching set detail", async ({ page }) => {
  await page.goto(`/plan/${E2E_PLAN_SLUG}/session/A`);
  await dismissPreSessionPrompt(page);
  await expect(page.locator(".log-strip")).toBeVisible();

  const pills = page.locator(".checkoff-pills .pill");
  const pillCount = await pills.count();
  for (let i = 0; i < pillCount; i++) await pills.nth(i).click();
  await logSetThroughRest(page);

  const clientId = await workoutClientId(page, "A");
  const workoutId = workoutIdOf(clientId);
  expect(workoutId, "the set log must have synced before History can show it").toBeTruthy();

  await page.goto(`/plan/${E2E_PLAN_SLUG}/history`);
  await expect(page.getByRole("link", { name: /Squat, Press & Row/ }).first()).toBeVisible();

  await page.goto(`/plan/${E2E_PLAN_SLUG}/history/${workoutId}`);
  await expect(page.getByRole("heading", { name: "Squat, Press & Row" })).toBeVisible();
  await expect(page.getByText("Goblet squat")).toBeVisible();
  await expect(page.getByText(/Plan v\d+/)).toBeVisible();

  await assertNoHorizontalOverflow(page);
});
```

- [ ] **Step 3: Run**

```bash
npx playwright test --project=iphone e2e/history-walkthrough.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Format, verify full suite, commit**

```bash
npx prettier --write e2e/history-walkthrough.spec.ts e2e/helpers.ts
npm run verify
npm run test:e2e
git add e2e/history-walkthrough.spec.ts e2e/helpers.ts
git commit -m "test(e2e): add the history walkthrough

Resolves its own workout by client_id rather than scanning the History
list: every spec in the suite shares one seeded database, so the newest
"Session A" row can belong to another project's test.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 20: Documentation close-out

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Tick ROADMAP's phase 7 items**

In `docs/ROADMAP.md`'s Phase 7 section, change each of the five remaining `- [ ]` items
to `- [x]`, appending the commit SHA(s) from Tasks 1–19 the way every other completed
item in that file already does (look at the `[x]` items immediately above — e.g.
`` `src/lib/db/logs.ts` (`9f93e9c`) `` — and match that citation style exactly, using
this branch's real SHAs once they exist, not placeholder text). Change the phase table's
row `| 7 | Progress, history & the Home screen | Not started |` to `| Done |`, and move
"Phase 7 is next" at the top of the file to "Phase 8 is next."

- [ ] **Step 2: Update README's status banner**

Find README's status banner (near the top) and change it from announcing phase 6/7a to
phase 7 complete / phase 8 next, in the same voice the existing banner uses.

- [ ] **Step 3: Update CLAUDE.md's "Current state" paragraph**

Extend the "Current state" paragraph at the top of `CLAUDE.md` with a phase-7 sentence
in the same style as the existing phase 1–6 sentences (each names its key deliverables
and its durable proof — for phase 7 that's `exercise-series.ts`/`double-progression.ts`
as the shared module, the Progress/History routes, and
`e2e/progress-walkthrough.spec.ts`/`e2e/history-walkthrough.spec.ts` as the durable
proof). Change "**Phase 7 (progress, history & the Home screen) is next.**" at the end of
that paragraph to name phase 8 instead.

Add a new "### What the phase-7 review changed" subsection under "Build order" if, over
the course of executing this plan, anything surfaced that's worth carrying forward as a
rule (the way phases 3, 4 and 6 each did) — e.g. if Task 6's summary.ts refactor or
Task 12's per-side chart rendering needed a real correction during implementation. Do not
add this subsection speculatively if nothing of that shape actually happened.

- [ ] **Step 4: Update ARCHITECTURE §12's "Done when" column**

Change phase 7's row in the build-order table to reflect what actually shipped, matching
its "Done when" phrasing style (present tense, states the proof — e.g. "Double-progression
state matches hand-calculated expectations; Home suggests the right next session;
per-exercise, per-session-type and metric-trend charts render from real logs; History
drills into full set detail").

- [ ] **Step 5: Commit**

```bash
npx prettier --write README.md docs/ROADMAP.md
git add docs/ROADMAP.md README.md CLAUDE.md docs/ARCHITECTURE.md
git commit -m "docs: close out phase 7

Ticks ROADMAP's five remaining phase-7 items, moves README's banner and
CLAUDE.md's Current state to phase 8, and updates ARCHITECTURE §12's
Done when column.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

**Part 7 done when, and the whole plan done when:** `npm run verify` passes, `npm run
test:e2e` passes for the four viewport/offline projects touched by this phase's specs,
every ROADMAP phase-7 item is ticked, and phase 7 no longer appears as "next" anywhere in
the four status-bearing files.

## Final verification

```bash
npm run verify
npx playwright install chromium   # first time only
npm run test:e2e
```

Then, by hand with `GAIN_DEV_USER` set: import the fixture, log sets across at least two
different sessions for goblet-squat, and walk `/plan/<slug>/progress`,
`/plan/<slug>/progress/exercises`, a per-exercise detail page, `/plan/<slug>/progress/metrics`,
a metric detail page, and `/plan/<slug>/history` end to end — confirming the two
goblet-squat rows, a readiness verdict, all three per-exercise charts, at least one
metric trend, and a History drill-down that matches what was actually logged.
