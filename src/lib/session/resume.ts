/**
 * Rebuilding a resumed workout's runner state from what it already wrote (phase-4
 * remediation Task 6). Pure: plain rows in (`$lib/db/workout-history`), the same
 * block-keyed shapes the live interactive paths populate out — so every read site in the
 * runner works on a resumed workout without knowing it is one.
 *
 * ## Why this needs matching at all
 *
 * `set_log` and `deviation` record an `exercise_def_id` and nothing about *where in the
 * session* it happened: there is no `block_key` column anywhere in the schema. The runner,
 * meanwhile, keys everything by `${block.key}:${prescribedSlug}` because the same movement
 * can be prescribed in two blocks of one session, and because a substituted slot keeps its
 * prescribed identity while logging against the substitute's slug (see `setLogKey`).
 *
 * So a row has to be walked back onto an occurrence. The rules, in order:
 *
 * 1. **Deviations are replayed in ULID order**, maintaining the substitution map as it
 *    stood at the time — which is exactly what the live session did, one deviation at a
 *    time. That matters because the deviation sheet posts the *performed* slug: a skip
 *    recorded after a swap names the substitute, not the prescription it replaced.
 * 2. **A row matches the occurrence currently performing its slug first**, and only then
 *    an occurrence that prescribes it but has since been substituted away (which is what a
 *    set logged before a swap looks like).
 * 3. **Within a tier, earliest occurrence in session order wins**, preferring one the row
 *    can still land on (an un-skipped slot for a skip, an unfilled slot for a set).
 *
 * Rule 3 is the pragmatic part. Where one performed slug could plausibly belong to two
 * loggable occurrences of the same session, the earlier occurrence takes the row. The
 * fixture has no such collision among loggable blocks — session D's `ab-finisher`
 * prescribes `dead-bug` *and* offers it as `reverse-crunch`'s substitute, but that is one
 * block, and the pre-swap rows still resolve correctly via rule 2 — and closing the gap
 * properly means adding a `block_key` column, which is a `docs/CONTRACT.md` + schema +
 * fixture change and not this task's business. The known imprecision is documented rather
 * than papered over: it can attribute a set to the wrong slot of the same session, never
 * to the wrong workout, and never invents or drops a row.
 *
 * Checkoff blocks are excluded throughout. They write nothing to the database (the pills
 * are client-side only), so they can own no row — and including them would let a warm-up
 * `bird-dog` claim a set really performed in the core block.
 */

import type { DeviationKind } from "../logs/types";
import {
  setLogKey,
  type LoggedSet,
  type ResolvedBlock,
  type ResolvedExercise,
} from "./session-view";

/**
 * Only what the reconstruction actually reads off a `ResolvedSession` — block identity,
 * whether it is a rounds block, whether it logs at all, and the prescribed slugs in
 * order. Narrowed the same way `setSlotsFor` narrows its arguments, so a `ResolvedSession`
 * satisfies it and a test fixture need not invent a plan's worth of fields to state a
 * matching rule.
 */
export type HydratableSession = {
  blocks: readonly (Pick<ResolvedBlock, "key" | "type" | "tracking"> & {
    exercises: readonly Pick<ResolvedExercise, "slug">[];
  })[];
};

/** One `set_log` row of the workout, joined to its exercise's slug. */
export type WorkoutSetRow = {
  id: string;
  exerciseSlug: string;
  setNo: number;
  side: "left" | "right" | null;
  reps: number | null;
  weightKg: number | null;
  durationS: number | null;
  difficulty: "easy" | "medium" | "hard" | null;
};

/** One `deviation` row of the workout, joined to its exercise's slug. */
export type WorkoutDeviationRow = {
  id: string;
  exerciseSlug: string;
  kind: DeviationKind;
  substituteSlug: string | null;
};

/** One `metric_value` row hanging off the workout (never `scope: 'set'` — those reference
 * a `set_log` row instead and carry no `workout_id`). */
export type WorkoutMetricRow = {
  id: string;
  scope: "set" | "exercise" | "session";
  metricKey: string;
  valueNum: number | null;
  valueText: string | null;
};

export type WorkoutHistory = {
  sets: readonly WorkoutSetRow[];
  deviations: readonly WorkoutDeviationRow[];
  metrics: readonly WorkoutMetricRow[];
};

/**
 * The runner's client state, as plain arrays so it can cross the wire in the `?/start`
 * action's response. Each field is the serialisable form of one map the runner already
 * has; the page turns them back into its `SvelteMap`/`SvelteSet` state unchanged.
 */
export type SessionHydration = {
  /** `setLogKey` → what was logged, for `loggedSets`. */
  loggedSets: { key: string; logged: LoggedSet }[];
  /** `${blockKey}:${prescribedSlug}` keys, for `skippedExercises`. */
  skipped: string[];
  /** The prescribed slot and the slug swapped into it — the page resolves the slug
   * through `resolveSubstitute` against the catalogue it already has. */
  substitutes: { blockKey: string; prescribedSlug: string; substituteSlug: string }[];
  /** `${blockKey}:${prescribedSlug}` → signed `add_set`/`drop_set` total. */
  setCountDelta: { key: string; delta: number }[];
  /** Block key → rounds completed, for a `type: rounds` block. */
  completedRounds: { blockKey: string; rounds: number }[];
  /** Session-scope metric key → the value last recorded, for the wrap-up sheet. */
  sessionMetrics: { key: string; value: number | string }[];
};

/** One loggable slot of the session: the identity every runner map is keyed by. */
type Occurrence = {
  key: string;
  blockKey: string;
  prescribedSlug: string;
  isRounds: boolean;
};

/**
 * Every exercise a workout can write a row against, in session order. Checkoff blocks are
 * excluded — see the module comment.
 */
function loggableOccurrences(session: HydratableSession): Occurrence[] {
  return session.blocks
    .filter((block) => block.tracking !== "checkoff")
    .flatMap((block) =>
      block.exercises.map((exercise) => ({
        key: `${block.key}:${exercise.slug}`,
        blockKey: block.key,
        prescribedSlug: exercise.slug,
        isRounds: block.type === "rounds",
      })),
    );
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The occurrence a row naming `slug` belongs to, by rules 2 and 3 of the module comment.
 * `prefer` narrows within the tiers to an occurrence the row can still land on; when
 * nothing preferred matches, the earliest occurrence of the best tier takes it anyway,
 * because dropping a persisted row silently is worse than placing it imperfectly.
 */
function matchOccurrence(
  occurrences: readonly Occurrence[],
  substituteBySlot: ReadonlyMap<string, string>,
  slug: string,
  prefer?: (occurrence: Occurrence) => boolean,
): Occurrence | undefined {
  const performing = occurrences.filter(
    (o) => (substituteBySlot.get(o.key) ?? o.prescribedSlug) === slug,
  );
  const displaced = occurrences.filter(
    (o) => o.prescribedSlug === slug && (substituteBySlot.get(o.key) ?? slug) !== slug,
  );
  const tiers = [performing, displaced];

  if (prefer) {
    for (const tier of tiers) {
      const hit = tier.find(prefer);
      if (hit) return hit;
    }
  }
  for (const tier of tiers) {
    if (tier.length > 0) return tier[0];
  }
  return undefined;
}

/** A persisted row as the ledger holds it — nulls dropped rather than carried through as
 * `null`, so a hydrated `LoggedSet` is indistinguishable from one the strip just wrote. */
function toLoggedSet(row: WorkoutSetRow): LoggedSet {
  const logged: LoggedSet = {};
  if (row.reps !== null) logged.reps = row.reps;
  if (row.weightKg !== null) logged.weightKg = row.weightKg;
  if (row.durationS !== null) logged.durationS = row.durationS;
  if (row.difficulty !== null) logged.difficulty = row.difficulty;
  return logged;
}

/**
 * Rebuild the runner's client state for a resumed workout.
 *
 * `stop_red_flag` deviations are ignored: that path finishes the workout outright, so
 * there is nothing for a resumed runner to re-apply. `addedSets` (UI-DECISIONS §6's
 * optional ranged set) is deliberately not rebuilt either — it is a *this-session* tap
 * count within the declared maximum, and `shownSetsFor`'s `highestLoggedSetNo` floor
 * already guarantees no logged set can be hidden by it resetting to zero.
 */
export function hydrateSession(
  session: HydratableSession,
  history: WorkoutHistory,
): SessionHydration {
  const occurrences = loggableOccurrences(session);

  const substituteBySlot = new Map<string, string>();
  const skipped = new Set<string>();
  const setCountDelta = new Map<string, number>();

  for (const row of [...history.deviations].sort(byId)) {
    if (row.kind === "stop_red_flag") continue;

    const prefer =
      row.kind === "skip"
        ? (o: Occurrence) => !skipped.has(o.key)
        : row.kind === "substitute"
          ? (o: Occurrence) => !substituteBySlot.has(o.key)
          : undefined;

    const occurrence = matchOccurrence(occurrences, substituteBySlot, row.exerciseSlug, prefer);
    if (!occurrence) continue;

    if (row.kind === "skip") {
      skipped.add(occurrence.key);
    } else if (row.kind === "substitute") {
      // Last one wins for a given slot, which is what replaying in ULID order gives.
      if (row.substituteSlug) substituteBySlot.set(occurrence.key, row.substituteSlug);
    } else {
      const delta = row.kind === "add_set" ? 1 : -1;
      setCountDelta.set(occurrence.key, (setCountDelta.get(occurrence.key) ?? 0) + delta);
    }
  }

  const loggedSets = new Map<string, LoggedSet>();

  /**
   * The highest round any row was logged against, per `type: rounds` block — its `set_no`
   * *is* its round, so this is the round that was in progress.
   */
  const highestRound = new Map<string, number>();

  for (const row of [...history.sets].sort(byId)) {
    const side = row.side ?? undefined;
    const slotKeyFor = (o: Occurrence) => setLogKey(o.blockKey, o.prescribedSlug, row.setNo, side);
    const occurrence = matchOccurrence(
      occurrences,
      substituteBySlot,
      row.exerciseSlug,
      (o) => !loggedSets.has(slotKeyFor(o)),
    );
    if (!occurrence) continue;

    loggedSets.set(slotKeyFor(occurrence), toLoggedSet(row));
    if (occurrence.isRounds) {
      highestRound.set(
        occurrence.blockKey,
        Math.max(highestRound.get(occurrence.blockKey) ?? 0, row.setNo),
      );
    }
  }

  const sessionMetrics = new Map<string, number | string>();
  for (const row of [...history.metrics].sort(byId)) {
    if (row.scope !== "session") continue;
    const value = row.valueNum ?? row.valueText;
    if (value === null) continue;
    sessionMetrics.set(row.metricKey, value);
  }

  const byKey = new Map(occurrences.map((o) => [o.key, o]));

  return {
    loggedSets: [...loggedSets].map(([key, logged]) => ({ key, logged })),
    skipped: [...skipped],
    // The page needs the prescription, not the composite key: a block `key` is only
    // `nonEmptyString` in the schema, so one containing a colon cannot be split back apart.
    substitutes: [...substituteBySlot].flatMap(([key, substituteSlug]) => {
      const occurrence = byKey.get(key);
      return occurrence
        ? [
            {
              blockKey: occurrence.blockKey,
              prescribedSlug: occurrence.prescribedSlug,
              substituteSlug,
            },
          ]
        : [];
    }),
    setCountDelta: [...setCountDelta].map(([key, delta]) => ({ key, delta })),
    /**
     * One fewer than the round that was in progress. A round whose every slot was logged
     * still resumes as the current round rather than the next one: the block's "Round N of
     * M done" button is the only thing that has ever advanced a round, no row records it
     * having been pressed, and re-offering a fully logged round shows every set exactly as
     * it was logged rather than hiding it behind a round nobody started.
     */
    completedRounds: [...highestRound]
      .map(([blockKey, round]) => ({ blockKey, rounds: round - 1 }))
      .filter((entry) => entry.rounds > 0),
    sessionMetrics: [...sessionMetrics].map(([key, value]) => ({ key, value })),
  };
}
