/**
 * Pre-fill logic (UI-DECISIONS §2): the reps/load stepper starts from the last
 * performance of the same exercise (and, for a per-side exercise, the same side), so
 * the common case is one tap. Pure — takes rows already fetched by
 * `../db/recent-sets.ts`, most-recent-first.
 *
 * UI-DECISIONS §3: weight specifically has a second-tier fallback — last matching
 * performance, else the load configuration's `default_kg`, else blank — so a user's
 * *first* session isn't blank on every weight field. Reps and duration have no such
 * contract-declared default, so they fall straight to blank when there's no matching
 * row. `defaultKg` is optional and supplied by the caller (the route resolves it via
 * `resolveLoad`/`ResolvedExercise.load`); omitting it preserves this function's
 * original undefined-when-nothing-matches behavior.
 */

export type RecentSetRow = {
  startedAt: string;
  setNo: number;
  side: "left" | "right" | null;
  reps: number | null;
  weightKg: number | null;
  durationS: number | null;
  difficulty: "easy" | "medium" | "hard" | null;
};

export type PrefillResult = {
  reps: number | undefined;
  weightKg: number | undefined;
  durationS: number | undefined;
};

/**
 * Rows must already be ordered most-recent-first (see `recentSetLogsForExercise`).
 * `defaultKg`, when supplied, is the matched load configuration's `default_kg`
 * (CONTRACT `loads`) — it fills `weightKg` when there's no matching row, or when the
 * matching row logged no weight, and is otherwise ignored.
 */
export function pickPrefill(
  rows: readonly RecentSetRow[],
  side: "left" | "right" | undefined,
  defaultKg?: number,
): PrefillResult | undefined {
  const match = rows.find((row) => (side === undefined ? row.side === null : row.side === side));
  if (!match) {
    if (defaultKg === undefined) return undefined;
    return { reps: undefined, weightKg: defaultKg, durationS: undefined };
  }

  return {
    reps: match.reps ?? undefined,
    weightKg: match.weightKg ?? defaultKg ?? undefined,
    durationS: match.durationS ?? undefined,
  };
}

/**
 * The log strip's last-performance line (UI-DECISIONS §2) — "Last time 11 at 12 kg".
 * It renders the same data the steppers pre-fill from, so the number the user is about
 * to commit and the number it came from are never in disagreement.
 *
 * `pickPrefill` cannot distinguish a matched row's weight from the `default_kg`
 * fallback it substitutes when nothing matched, but it *can* be inferred: a fallback
 * result carries a weight and nothing else, since `default_kg` is the only
 * contract-declared default there is (UI-DECISIONS §3). That case is named honestly as
 * a starting suggestion rather than dressed up as history.
 */
export function formatLastPerformance(
  prefill: { reps?: number; weightKg?: number; durationS?: number } | undefined,
  type: "reps" | "time",
): string {
  if (type === "time") {
    return prefill?.durationS === undefined
      ? "No history yet"
      : `Last time ${prefill.durationS} sec`;
  }
  if (prefill?.reps === undefined) {
    return prefill?.weightKg === undefined
      ? "No history yet"
      : `No history — starting at ${prefill.weightKg} kg`;
  }
  return prefill.weightKg === undefined
    ? `Last time ${prefill.reps}`
    : `Last time ${prefill.reps} at ${prefill.weightKg} kg`;
}
