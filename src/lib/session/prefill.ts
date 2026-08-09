/**
 * Pre-fill logic (UI-DECISIONS §2): the reps/load stepper starts from the last
 * performance of the same exercise (and, for a per-side exercise, the same side), so
 * the common case is one tap. Pure — takes rows already fetched by
 * `../db/recent-sets.ts`, most-recent-first.
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

/** Rows must already be ordered most-recent-first (see `recentSetLogsForExercise`). */
export function pickPrefill(
  rows: readonly RecentSetRow[],
  side: "left" | "right" | undefined,
): PrefillResult | undefined {
  const match = rows.find((row) => (side === undefined ? row.side === null : row.side === side));
  if (!match) return undefined;

  return {
    reps: match.reps ?? undefined,
    weightKg: match.weightKg ?? undefined,
    durationS: match.durationS ?? undefined,
  };
}
