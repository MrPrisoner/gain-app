/**
 * How the operator screen reads a user's aggregates back as a sentence.
 *
 * Pure, with the clock injected, so the phrasing is testable and deterministic — and
 * because the answer is computed in `load` rather than the component: deriving "3 days
 * ago" at render time would disagree between the server-rendered markup and hydration,
 * the same trap `src/routes/+page.svelte` documents around its `nowMs`.
 *
 * The three states below are the ones that matter during alpha, in the order that
 * distinguishes them: an account with no plan is a different problem from a plan nobody
 * has trained, which is different again from someone who trained and stopped. UI-DECISIONS
 * §5 reserves colour for the plan's symptom framework, so this says it in words — which
 * is the better answer anyway, since a coloured dot would need a legend.
 */

import type { UserStats } from "../server/admin-stats";

const DAY_MS = 24 * 60 * 60 * 1000;

export function describeActivity(stats: UserStats, now: Date): string {
  if (!stats.provisioned || stats.plans === 0) return "No plan yet";
  if (stats.lastWorkoutAt === null) return "Plan imported, not trained yet";
  return `Last trained ${relativeDays(stats.lastWorkoutAt, now)}`;
}

/**
 * Calendar-day difference, not elapsed hours: a session at 23:00 and a glance at 08:00
 * the next morning is "yesterday", not "9 hours ago".
 */
function relativeDays(iso: string, now: Date): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "at an unknown time";

  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(new Date(then))) / DAY_MS));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 9) return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;

  const months = Math.max(1, Math.round(days / 30));
  return `${months} ${months === 1 ? "month" : "months"} ago`;
}

function startOfDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * What the operator must type to confirm a reset. The label when there is one; the tail
 * of the ULID when the user has not logged in since `display_label` was added.
 *
 * Typing it is the safety device, not the red button: it is the one step that cannot be
 * completed by muscle memory on the wrong card.
 */
export function confirmationFor(displayLabel: string | null, userId: string): string {
  return displayLabel ?? userId.slice(-6);
}
