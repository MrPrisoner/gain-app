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
import {
  resolveSession,
  type ResolvedExercise,
  type ResolvedSession,
} from "../session/session-view";

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

function setsForSide(point: ExerciseSeriesPoint, side: "left" | "right" | undefined): SetLog[] {
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
