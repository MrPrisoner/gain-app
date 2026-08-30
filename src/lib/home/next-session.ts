/**
 * The Home screen's suggested next session (ARCHITECTURE §9, "Home").
 *
 * Pure: no clock, no I/O. `recentWorkouts` must already be most-recent-first — the
 * caller (`recentWorkoutsForPlan`, `src/lib/db/home.ts`) orders by `started_at DESC`.
 */

export type SessionOrderRef = { key: string; order: number };
export type RecentWorkoutRef = { sessionKey: string; startedAt: string };

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

  // The cursor is the most recent workout whose session is actually part of the
  // rotation — a workout on a session the sequence omits (an "extra") must not derail
  // it. Any status counts: a red-flag stop was still an attempt, and this function
  // never sees status at all (see the "advances on any status" test above).
  const cursor = recentWorkouts.find((w) => order.includes(w.sessionKey));
  const suggestedKey =
    cursor === undefined
      ? firstKey
      : (order[(order.indexOf(cursor.sessionKey) + 1) % order.length] ?? firstKey);

  const overrides: SessionOverrideRef[] = [...sessions]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      key: s.key,
      lastDoneDate: recentWorkouts.find((w) => w.sessionKey === s.key)?.startedAt.slice(0, 10),
    }));

  const last = recentWorkouts[0];
  return {
    suggestedKey,
    lastSession:
      last === undefined
        ? undefined
        : { key: last.sessionKey, startedAtDate: last.startedAt.slice(0, 10) },
    overrides,
  };
}
