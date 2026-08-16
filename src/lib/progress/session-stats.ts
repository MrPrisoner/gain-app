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
      minutes:
        (new Date(w.completed_at as string).getTime() - new Date(w.started_at).getTime()) / 60000,
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
