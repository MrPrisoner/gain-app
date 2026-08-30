/**
 * Home-screen reads: what `src/lib/home/*` needs beyond what
 * `src/lib/db/read.ts` and `src/lib/db/logs.ts` already provide. Read-only, scoped to
 * one user's own database — physical isolation means there is no cross-user row to
 * leak here in the first place (ARCHITECTURE decision 4).
 */

import type { GainContract, MetricDef } from "../contract/schema";
import type { NextMorningCandidate } from "../home/next-morning";
import type { UserDb } from "./user-db";

export type HomeWorkoutRef = { sessionKey: string; startedAt: string };

/** Most-recent-first, for `suggestNextSession` (`src/lib/home/next-session.ts`). */
export function recentWorkoutsForPlan(
  userDb: UserDb,
  planId: string,
  limit = 10,
): HomeWorkoutRef[] {
  return userDb.db
    .prepare(
      `SELECT w.session_key AS sessionKey, w.started_at AS startedAt
       FROM workout w
       JOIN plan_version pv ON pv.id = w.plan_version_id
       WHERE pv.plan_id = ?
       ORDER BY w.started_at DESC
       LIMIT ?`,
    )
    .all(planId, limit) as HomeWorkoutRef[];
}

export type ActivityKindRef = { kind: string; occurredAt: string };

/** Every activity, not one plan's — `activity` carries no plan reference, mirroring
 * `src/lib/db/logs.ts`'s `activitiesOf`. Most-recent-first, for
 * `suggestActivityKinds` (`src/lib/home/activity-kinds.ts`). */
export function recentActivities(userDb: UserDb, limit = 20): ActivityKindRef[] {
  return userDb.db
    .prepare(
      "SELECT kind, occurred_at AS occurredAt FROM activity ORDER BY occurred_at DESC LIMIT ?",
    )
    .all(limit) as ActivityKindRef[];
}

type NextMorningRow = {
  id: string;
  clientId: string;
  planSlug: string;
  sessionKey: string;
  completedAt: string;
  contractJson: string;
};

/**
 * Workouts finished in the last 72 hours, with their plan version's
 * `prompt_when: "next_morning"` session metrics and which of those are already
 * answered. Generous on purpose: the exact "yesterday" narrowing happens client-side
 * in `dueNextMorningPrompts` (`src/lib/home/next-morning.ts`), against the viewer's own
 * clock rather than the server's timezone.
 *
 * `contract_json` (not the normalized `metric_def` table) is the source here, for the
 * same reason `contractOfVersion` (`src/lib/db/read.ts`) always reads it: a workout is
 * bound to the plan version it ran under (ARCHITECTURE §8), and this reads that
 * version's own contract rather than the plan's current one.
 */
export function nextMorningCandidates(userDb: UserDb, now: Date): NextMorningCandidate[] {
  const since = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();

  const rows = userDb.db
    .prepare(
      `SELECT w.id AS id, w.client_id AS clientId, p.slug AS planSlug, w.session_key AS sessionKey,
              w.completed_at AS completedAt, pv.contract_json AS contractJson
       FROM workout w
       JOIN plan_version pv ON pv.id = w.plan_version_id
       JOIN plan p ON p.id = pv.plan_id
       WHERE w.client_id IS NOT NULL AND w.completed_at IS NOT NULL AND w.completed_at >= ?
       ORDER BY w.completed_at DESC`,
    )
    .all(since) as NextMorningRow[];

  const candidates: NextMorningCandidate[] = [];
  for (const row of rows) {
    const contract = JSON.parse(row.contractJson) as GainContract;
    const metrics: MetricDef[] = (contract.metrics?.session ?? []).filter(
      (m) => m.prompt_when === "next_morning",
    );
    if (metrics.length === 0) continue;

    const answered = userDb.db
      .prepare(
        "SELECT metric_key AS metricKey FROM metric_value WHERE workout_id = ? AND scope = 'session'",
      )
      .all(row.id) as { metricKey: string }[];

    candidates.push({
      workoutClientId: row.clientId,
      planSlug: row.planSlug,
      sessionKey: row.sessionKey,
      finishedAt: row.completedAt,
      metrics,
      answeredKeys: answered.map((a) => a.metricKey),
    });
  }
  return candidates;
}
