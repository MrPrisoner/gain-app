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
import { buildExerciseSeries, buildPrescribedSeries, exerciseOccurrences } from "./exercise-series";
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
    // not merely everything since the window opened. Prescribed sessions only, matching
    // `buildMovers` exactly — otherwise this count could name a movement whose row the
    // movers list does not show.
    const series = buildPrescribedSeries(contract, fullLogs, slug);
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
