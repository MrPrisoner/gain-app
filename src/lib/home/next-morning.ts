/**
 * The next-morning metric prompt. A `next_morning` metric is
 * worthless collected three days later, so this is a strict one-day window rather
 * than a generous one — "previous calendar day", computed against the caller's clock.
 *
 * The server (`src/lib/db/home.ts`, `nextMorningCandidates`) returns candidates within
 * a generous real-time window; this function, called client-side with the browser's
 * own `Date.now()`, narrows to exactly "yesterday" in the viewer's own timezone. The
 * split matters because the container's timezone is not the user's.
 */

import type { MetricDef } from "../contract/schema";

export type NextMorningCandidate = {
  workoutClientId: string;
  planSlug: string;
  sessionKey: string;
  /** ISO timestamp — the workout's `completed_at`. */
  finishedAt: string;
  /** This workout's plan version's session-scope metrics with `prompt_when: "next_morning"`. */
  metrics: MetricDef[];
  /** Metric keys already answered (scope `session`) for this workout. */
  answeredKeys: string[];
};

function localDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dueNextMorningPrompts(
  candidates: readonly NextMorningCandidate[],
  nowMs: number,
  dismissedWorkoutClientIds: readonly string[],
): NextMorningCandidate[] {
  const yesterday = localDateKey(nowMs - 24 * 60 * 60 * 1000);
  const dismissed = new Set(dismissedWorkoutClientIds);
  const due: NextMorningCandidate[] = [];

  for (const c of candidates) {
    if (dismissed.has(c.workoutClientId)) continue;
    if (localDateKey(Date.parse(c.finishedAt)) !== yesterday) continue;

    const unanswered = c.metrics.filter((m) => !c.answeredKeys.includes(m.key));
    if (unanswered.length === 0) continue;

    due.push({ ...c, metrics: unanswered });
  }

  return due;
}
