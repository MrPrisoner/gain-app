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
import { exerciseOccurrences, seriesInSessions } from "./exercise-series";
import { bestSetsBySession, scoreKindFor, type BestSet, type ScoreKind } from "./personal-best";

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

export function buildMovers(contract: GainContract, windowedLogs: Logs, fullLogs: Logs): Mover[] {
  const bySlug = new Map<string, ReturnType<typeof exerciseOccurrences>>();
  for (const occurrence of exerciseOccurrences(contract)) {
    const list = bySlug.get(occurrence.exerciseSlug) ?? [];
    list.push(occurrence);
    bySlug.set(occurrence.exerciseSlug, list);
  }

  const sessionOfWorkout = new Map(windowedLogs.workouts.map((w) => [w.id, w.session_key]));

  const movers: Mover[] = [];
  for (const [slug, occurrences] of bySlug) {
    const sessionKeys = new Set(occurrences.map((o) => o.sessionKey));
    const fullSeries = seriesInSessions(fullLogs, slug, sessionKeys);
    if (fullSeries.length === 0) continue;

    // `type` comes from the first occurrence in catalogue order. A movement prescribed as
    // reps in one session and time in another is possible in principle and absent in
    // practice; this is the documented behaviour rather than an unhandled case.
    const first = occurrences[0]!;
    const type = first.resolved.type;

    // Decided over full history, so switching from 12w to 4w can never switch a
    // movement's unit and silently change what the row means.
    const kind = scoreKindFor(fullSeries, type);

    const windowSeries = seriesInSessions(windowedLogs, slug, sessionKeys);
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

    // Computed over the same unfiltered best-per-session series the row's own numbers
    // come from, NOT via `breakthroughs`: that function scores per side, and asking it
    // for the unsided side of a per_side movement returns nothing at all, so every
    // per_side row would have reported false. The headline still uses `breakthroughs`,
    // where per-side scoring is the point.
    const fullBests = bestSetsBySession(fullSeries, kind);
    const latestIndex = fullBests.findIndex((b) => b.workoutId === latestBest.workoutId);
    const latestIsBreakthrough =
      latestIndex > 0 &&
      fullBests
        .slice(0, latestIndex)
        .every((earlier) => earlier.score < fullBests[latestIndex]!.score);

    // The occurrence holding the movement's NEWEST logged set, not the last one the
    // contract happens to declare. A movement prescribed in two sessions and trained
    // almost entirely in the earlier one would otherwise link to the session it has barely
    // been done in — always a valid target, so nothing 404s and nothing fails, but the
    // wrong charts. `windowSeries` is chronological and already restricted to prescribed
    // sessions, so the last point that names an occurrence is that occurrence.
    let link = first;
    for (const point of windowSeries) {
      const key = sessionOfWorkout.get(point.workoutId);
      const occurrence = occurrences.find((o) => o.sessionKey === key);
      if (occurrence) link = occurrence;
    }

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
