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

  const trained = new Set(
    fullLogs.workouts.filter(isFinished).map((w) => weekStartOf(w.started_at)),
  );
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
