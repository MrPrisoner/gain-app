/**
 * Home-screen reads: what `src/lib/home/*` needs beyond what
 * `src/lib/db/read.ts` and `src/lib/db/logs.ts` already provide. Read-only, scoped to
 * one user's own database — physical isolation means there is no cross-user row to
 * leak here in the first place (ARCHITECTURE decision 4).
 */

import type { GainContract, MetricDef } from "../contract/schema";
import type { NextMorningCandidate } from "../home/next-morning";
import type { UserDb } from "./user-db";

export type HomeWorkoutRef = {
  sessionKey: string;
  startedAt: string;
  completedAt: string | undefined;
};

/**
 * The plan's finished workouts, most-recent-first, for `suggestNextSession`
 * (`src/lib/home/next-session.ts`).
 *
 * **Finished is filtered here, not only there.** `suggestNextSession` applies the same
 * predicate itself and must keep doing so — it is pure, and its contract cannot depend on
 * a caller having filtered first. But a `LIMIT` applied before that filter makes the
 * effective depth of the rotation's history vary with how often the user abandons a
 * session: twenty-five abandoned rows would push every finished one out of range and
 * leave the whole screen claiming no session had ever been done. Filtering in the `WHERE`
 * makes the limit mean twenty-five *usable* rows, which is what the number was chosen as.
 *
 * The unfinished half is not dropped, just answered elsewhere: `openWorkoutsForPlan`
 * below is the reader for it, and Home renders both.
 */
export function recentWorkoutsForPlan(
  userDb: UserDb,
  planId: string,
  limit = 25,
): HomeWorkoutRef[] {
  const rows = userDb.db
    .prepare(
      `SELECT w.session_key AS sessionKey, w.started_at AS startedAt,
              w.completed_at AS completedAt
       FROM workout w
       JOIN plan_version pv ON pv.id = w.plan_version_id
       WHERE pv.plan_id = ?
         AND w.completed_at IS NOT NULL
       ORDER BY w.started_at DESC
       LIMIT ?`,
    )
    .all(planId, limit) as {
    sessionKey: string;
    startedAt: string;
    completedAt: string | null;
  }[];

  return rows.map((row) => ({
    sessionKey: row.sessionKey,
    startedAt: row.startedAt,
    // SQLite returns null for missing completed_at; map to undefined so the
    // isFinished check (completedAt !== undefined) works correctly. If we
    // returned null, a workout would look finished to the predicate.
    completedAt: row.completedAt ?? undefined,
  }));
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

/** One workout the user started and never finished. Addressed by `client_id`, because
 * every action Home offers on it (resume, discard) travels through the offline sync
 * layer, which names workouts by client id and never by server id. */
export type OpenWorkoutRef = {
  workoutClientId: string;
  sessionKey: string;
  startedAt: string;
  setCount: number;
};

/**
 * Every workout of this plan the user started and never finished, newest first.
 *
 * "Unfinished" is `completed_at IS NULL` — ARCHITECTURE §5's rule that in-progress is the
 * absence of a completion rather than a fourth status. For every row written since lazy
 * start there is no false-positive case to filter out: `$lib/sync/deferred-start.ts`
 * means a session merely opened persists nothing, so such a row existing at all is proof
 * the user wrote something.
 *
 * Older rows are not quite that clean, and the difference is visible rather than
 * harmful. Migration 3 (`delete-peeked-workouts`, `$lib/db/schema.ts`) swept the
 * pre-lazy-start peek rows, but only those already past its seven-day floor when it ran
 * for that user — a peek row younger than that survived, and will surface here as a
 * genuinely empty session reading "0 sets logged". That is a card the user can discard,
 * not a wrong number anywhere, so it is left to them rather than filtered out: a
 * `set_log`-count filter here would also hide a live session whose only write so far was
 * a pre-session metric, which is the case the correlated subquery below exists to keep.
 *
 * `client_id IS NOT NULL` excludes rows nothing can act on. Every row the sync layer
 * writes carries one; a row without one could only come from a direct insert, and
 * offering Resume or Discard on something neither can address would be a dead button.
 *
 * The set count is a correlated subquery rather than a join, so a workout whose only
 * write was a pre-session metric still comes back — with `0` — instead of being dropped
 * by an inner join or duplicated by an outer one.
 */
export function openWorkoutsForPlan(userDb: UserDb, planId: string): OpenWorkoutRef[] {
  return userDb.db
    .prepare(
      `SELECT w.client_id AS workoutClientId,
              w.session_key AS sessionKey,
              w.started_at  AS startedAt,
              (SELECT COUNT(*) FROM set_log s WHERE s.workout_id = w.id) AS setCount
       FROM workout w
       JOIN plan_version pv ON pv.id = w.plan_version_id
       WHERE pv.plan_id = ?
         AND w.completed_at IS NULL
         AND w.client_id IS NOT NULL
       ORDER BY w.started_at DESC`,
    )
    .all(planId) as OpenWorkoutRef[];
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
