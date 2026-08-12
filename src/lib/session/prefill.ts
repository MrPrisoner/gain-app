/**
 * Pre-fill logic (UI-DECISIONS §2): the reps/load stepper starts from the last
 * performance of the same exercise (and, for a per-side exercise, the same side), so
 * the common case is one tap. Pure — takes rows already fetched by
 * `../db/recent-sets.ts`, most-recent-first.
 *
 * UI-DECISIONS §3: weight has a second-tier fallback — last matching performance, else
 * the load configuration's `default_kg`, else blank — so a user's *first* session isn't
 * blank on every weight field. Reps and duration get the same second tier: the
 * prescription's own `reps`/`duration_sec` target, collapsed to its lower bound when it
 * is a range — an 8–12 prescription starts its first set at 8, a 20–40 sec hold starts
 * at 20, never blank and never higher than the plan actually asked for on set one.
 * `defaultKg`/`repsTarget`/`durationTarget` are optional and supplied by the caller (the
 * route resolves them via `resolveLoad`/`ResolvedExercise.load`/`.reps`/`.durationSec`);
 * omitting them preserves this function's original undefined-when-nothing-matches
 * behavior.
 *
 * `carryForwardFromPreviousSet` is a third, outermost rung the runner layers on top of
 * this module's result: once a set has been logged this session, the next set of the
 * same exercise and side starts from what was actually entered, not from history or a
 * configured default — a set bumped from 6 kg to 8 kg mid-exercise should not reset to
 * 6 kg on the next set.
 */

import type { IntOrRange } from "../contract/schema";

export type RecentSetRow = {
  startedAt: string;
  setNo: number;
  side: "left" | "right" | null;
  reps: number | null;
  weightKg: number | null;
  durationS: number | null;
  difficulty: "easy" | "medium" | "hard" | null;
};

/** Pre-fill for every movement the runner can end up logging, keyed by exercise slug —
 * see `+page.server.ts`'s `load` for why substitutes are included alongside prescribed
 * exercises. */
export type PrefillByExercise = Record<
  string,
  { left?: PrefillResult; right?: PrefillResult; none?: PrefillResult }
>;

export type PrefillResult = {
  reps: number | undefined;
  weightKg: number | undefined;
  durationS: number | undefined;
  /**
   * True when no row matched at all, so `reps`/`weightKg`/`durationS` (if present) are
   * starting suggestions — the reps or duration target's lower bound, `default_kg` —
   * rather than a performance that actually happened. `formatLastPerformance` reads this
   * rather than inferring it from which fields are present, now that more than one field
   * can carry a non-history default at once.
   */
  isFirstTime: boolean;
};

function lowerBound(range: IntOrRange): number {
  return typeof range === "number" ? range : range[0];
}

/**
 * Rows must already be ordered most-recent-first (see `recentSetLogsForExercise`).
 * `defaultKg`, when supplied, is the matched load configuration's `default_kg`
 * (CONTRACT `loads`) — it fills `weightKg` when there's no matching row, or when the
 * matching row logged no weight, and is otherwise ignored. `repsTarget`/`durationTarget`,
 * when supplied, are the prescription's own `reps`/`duration_sec` (CONTRACT) — a type
 * `reps` exercise carries only the former and a type `time` exercise only the latter, so
 * passing both unconditionally is safe; each fills its field's lower bound on the same
 * terms as `defaultKg`.
 */
export function pickPrefill(
  rows: readonly RecentSetRow[],
  side: "left" | "right" | undefined,
  defaultKg?: number,
  repsTarget?: IntOrRange,
  durationTarget?: IntOrRange,
): PrefillResult | undefined {
  const defaultReps = repsTarget === undefined ? undefined : lowerBound(repsTarget);
  const defaultDuration = durationTarget === undefined ? undefined : lowerBound(durationTarget);
  const match = rows.find((row) => (side === undefined ? row.side === null : row.side === side));
  if (!match) {
    if (defaultKg === undefined && defaultReps === undefined && defaultDuration === undefined) {
      return undefined;
    }
    // Known consequence of UI-DECISIONS §3's settled "no `paired` contract field"
    // decision: weight is logged as a total (the strip's dial is labelled "kg total"),
    // but `default_kg` is written per-dumbbell in the fixture's prose — "Approximately
    // 6 kg per dumbbell" — and there is no contract field that says a movement is paired,
    // so nothing here can tell a per-dumbbell default from a total one. A first-time
    // paired lift therefore pre-fills half its true total on its very first set.
    // Deliberately left alone: guessing "paired" from a slug or a load label would be
    // worse than a number the user corrects with two taps of the stepper, and the honest
    // fix is upstream, in what the authoring AI is told about loads.
    return {
      reps: defaultReps,
      weightKg: defaultKg,
      durationS: defaultDuration,
      isFirstTime: true,
    };
  }

  return {
    reps: match.reps ?? defaultReps,
    weightKg: match.weightKg ?? defaultKg,
    durationS: match.durationS ?? defaultDuration,
    isFirstTime: false,
  };
}

/**
 * The runner's outermost pre-fill rung: once a set has been logged this session, the
 * next set of the same exercise and side starts from what was actually entered rather
 * than from `base` (history or a configured default). `previous` is the immediately
 * preceding set's logged values, or `undefined` for a set's own first slot — in which
 * case `base` passes through unchanged.
 *
 * A field the previous set left blank (steppers cleared, or a checkoff-style write)
 * falls through to `base` rather than clearing this set's pre-fill too.
 */
export function carryForwardFromPreviousSet(
  base: { reps?: number; weightKg?: number; durationS?: number },
  previous: { reps?: number; weightKg?: number; durationS?: number } | undefined,
): { reps?: number; weightKg?: number; durationS?: number } {
  if (!previous) return base;
  return {
    reps: previous.reps ?? base.reps,
    weightKg: previous.weightKg ?? base.weightKg,
    durationS: previous.durationS ?? base.durationS,
  };
}

/**
 * The log strip's last-performance line (UI-DECISIONS §2) — "Last time 11 at 12 kg".
 * It renders the same data the steppers pre-fill from, so the number the user is about
 * to commit and the number it came from are never in disagreement.
 *
 * `isFirstTime` (see `PrefillResult`) says outright whether `reps`/`weightKg` are a
 * starting suggestion or a real performance — named honestly either way, rather than
 * dressed up as history it isn't.
 */
export function formatLastPerformance(
  prefill:
    { reps?: number; weightKg?: number; durationS?: number; isFirstTime?: boolean } | undefined,
  type: "reps" | "time",
): string {
  if (type === "time") {
    if (prefill?.durationS === undefined) return "No history yet";
    return prefill.isFirstTime
      ? `No history — starting at ${prefill.durationS} sec`
      : `Last time ${prefill.durationS} sec`;
  }
  if (prefill?.reps === undefined && prefill?.weightKg === undefined) return "No history yet";

  const value =
    prefill.reps === undefined
      ? `${prefill.weightKg} kg`
      : prefill.weightKg === undefined
        ? `${prefill.reps}`
        : `${prefill.reps} at ${prefill.weightKg} kg`;

  return prefill.isFirstTime ? `No history — starting at ${value}` : `Last time ${value}`;
}
