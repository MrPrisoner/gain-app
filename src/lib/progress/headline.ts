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
 *
 * **Two of the three numbers are counted off the very lists the screen renders**, which
 * are passed in rather than recomputed here. Recomputing them was both wasteful — the
 * route built each list and this module built it again, resolving the whole contract a
 * second time — and weaker: "the count and the list are built from the same function" is
 * a convention that a later edit can break silently, while counting the list itself
 * cannot disagree with it at all.
 */

import type { GainContract } from "../contract/schema";
import type { Logs } from "../logs/types";
import type { ReadyOccurrence } from "./double-progression";
import { exerciseOccurrences, seriesInSessions, type ExerciseOccurrence } from "./exercise-series";
import { breakthroughs } from "./personal-best";
import type { Mover } from "./movers";

export type Headline = {
  /** Distinct exercises with a breakthrough inside the window — never per side. */
  newBests: number;
  readyToIncrease: number;
  improved: { count: number; comparable: number };
};

export function buildHeadline(
  contract: GainContract,
  fullLogs: Logs,
  windowStart: string | undefined,
  movers: readonly Mover[],
  ready: readonly ReadyOccurrence[],
): Headline {
  const bySlug = new Map<string, ExerciseOccurrence[]>();
  for (const occurrence of exerciseOccurrences(contract)) {
    const list = bySlug.get(occurrence.exerciseSlug) ?? [];
    list.push(occurrence);
    bySlug.set(occurrence.exerciseSlug, list);
  }

  const bestSlugs = new Set<string>();
  for (const [slug, occurrences] of bySlug) {
    // Full history, then filtered by date: a personal best must beat everything before it,
    // not merely everything since the window opened. Prescribed sessions only, matching
    // `buildMovers` exactly — otherwise this count could name a movement whose row the
    // movers list does not show.
    const first = occurrences[0]!;
    const series = seriesInSessions(fullLogs, slug, new Set(occurrences.map((o) => o.sessionKey)));
    const found = breakthroughs(series, slug, first.resolved.type, first.resolved.perSide);
    const inWindow = found.filter(
      (b) => windowStart === undefined || b.at.startedAt >= windowStart,
    );
    if (inWindow.length > 0) bestSlugs.add(slug);
  }

  const comparable = movers.filter((m) => m.deltaPct !== undefined);

  return {
    newBests: bestSlugs.size,
    readyToIncrease: ready.length,
    improved: {
      count: comparable.filter((m) => (m.deltaPct ?? 0) > 0).length,
      comparable: comparable.length,
    },
  };
}
