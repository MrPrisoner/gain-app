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

/**
 * A score in its own units — the one place a user is shown the comparator itself rather
 * than what they logged, because a chart plots scores and a tapped point has to say what
 * it is standing on.
 *
 * `e1rm` names itself an estimate. It is one: Epley, off a rep count capped at twelve, so
 * it is not reconcilable from the kilograms and reps beside it and must never read as a
 * measurement. A loaded hold's kg-seconds is an index rather than a quantity anyone
 * trains, so it is named too — an unlabelled "360.0" under a tapped point tells the reader
 * nothing at all.
 */
export function formatScoreValue(score: number, kind: ScoreKind): string {
  switch (kind) {
    case "e1rm":
      return `${score.toFixed(1)} kg est. 1RM`;
    case "loaded_hold":
      return `${Math.round(score)} kg·s`;
    case "reps":
      return `${score} reps`;
    case "seconds":
      return `${score}s`;
  }
}
