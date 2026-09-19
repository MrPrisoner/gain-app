/**
 * The Home screen's suggested next session (ARCHITECTURE §9, "Home").
 *
 * Pure: no clock, no I/O. `recentWorkouts` must already be most-recent-first — the
 * caller (`recentWorkoutsForPlan`, `src/lib/db/home.ts`) orders by `started_at DESC`.
 */

export type SessionOrderRef = { key: string; order: number };
export type RecentWorkoutRef = {
  sessionKey: string;
  startedAt: string;
  /**
   * ISO timestamp, or `undefined` for a workout still open. ARCHITECTURE §5: there is
   * no "in progress" status — in-progress is the absence of `completed_at`.
   */
  completedAt: string | undefined;
};

export type SessionOverrideRef = {
  key: string;
  /** ISO date (YYYY-MM-DD) of the most recent workout on this session, if any. */
  lastDoneDate: string | undefined;
};

export type NextSessionSuggestion = {
  suggestedKey: string;
  /** The very last workout done, on any session — undefined with no history at all. */
  lastSession: { key: string; startedAtDate: string } | undefined;
  /** One entry per declared session, in declaration order. */
  overrides: SessionOverrideRef[];
};

/**
 * A workout that reached an ending, whatever that ending was. A red-flag stop counts:
 * `finishWorkout` stamps `completed_at` on a stop, so the rotation still advances past
 * one, which is the behaviour this module already documented. What does not count is a
 * session abandoned mid-way — it never happened, so nothing may be derived from it.
 *
 * The same predicate is already the definition of "finished" in
 * `$lib/progress/consistency.ts` and `$lib/progress/session-stats.ts`. Home was the one
 * module not using it, which is why one logged set used to advance the suggestion.
 */
function isFinished(workout: RecentWorkoutRef): boolean {
  return workout.completedAt !== undefined;
}

/**
 * The rotation order: `scheduling.sequence` when the plan declares one (or a non-empty
 * one), else declared session order. `sequence` is pre-validated by the contract parser
 * to reference only declared session keys (`checkSessionRefs`, `src/lib/contract/schema.ts`).
 */
function rotationOrder(
  sessions: readonly SessionOrderRef[],
  sequence: readonly string[] | undefined,
): string[] {
  if (sequence !== undefined && sequence.length > 0) return [...sequence];
  return [...sessions].sort((a, b) => a.order - b.order).map((s) => s.key);
}

export function suggestNextSession(
  sessions: readonly SessionOrderRef[],
  sequence: readonly string[] | undefined,
  recentWorkouts: readonly RecentWorkoutRef[],
): NextSessionSuggestion {
  const order = rotationOrder(sessions, sequence);
  const firstKey = order[0] ?? sessions[0]?.key ?? "";

  const finished = recentWorkouts.filter(isFinished);

  // The cursor is the most recent finished workout whose session is actually part of the
  // rotation — a workout on a session the sequence omits (an "extra") must not derail
  // it. An unfinished workout never advances the cursor at any age, since it never
  // happened.
  const cursor = finished.find((w) => order.includes(w.sessionKey));
  const suggestedKey =
    cursor === undefined
      ? firstKey
      : (order[(order.indexOf(cursor.sessionKey) + 1) % order.length] ?? firstKey);

  const overrides: SessionOverrideRef[] = [...sessions]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      key: s.key,
      lastDoneDate: finished.find((w) => w.sessionKey === s.key)?.startedAt.slice(0, 10),
    }));

  const last = finished[0];
  return {
    suggestedKey,
    lastSession:
      last === undefined
        ? undefined
        : { key: last.sessionKey, startedAtDate: last.startedAt.slice(0, 10) },
    overrides,
  };
}
