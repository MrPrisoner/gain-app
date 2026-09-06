/**
 * The Progress screen, whole. Four routes collapsed to two: the exercises list was pure
 * indirection over a readiness string, and both metric routes existed to put a window
 * picker above a single sparkline.
 *
 * Thin by construction — every number here comes from a unit-tested module under
 * `$lib/progress/`. The one thing this file decides is what the screen shows first.
 */

import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import { logsForPlan } from "$lib/db/logs";
import { filterLogsToWindow } from "$lib/export/bundle";
import { progressWindowOptions, resolveProgressWindow } from "$lib/progress/progress-window";
import { formatReadiness, readyOccurrences } from "$lib/progress/double-progression";
import { buildMovers } from "$lib/progress/movers";
import { buildConsistency } from "$lib/progress/consistency";
import { buildHeadline } from "$lib/progress/headline";
import { hubMetricRows } from "$lib/progress/metric-series";
import { formatScore } from "$lib/progress/personal-best";

export const load: PageServerLoad = ({ params, locals, url }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan) throw error(404, "No such plan");

  const version = getCurrentVersion(userDb, plan.id);
  if (!version) throw error(409, "That plan has no current version");
  const contract = contractOfVersion(version);

  const now = new Date();
  const window = resolveProgressWindow(url.searchParams.get("window"), now);
  const logs = logsForPlan(userDb, plan.id);
  const windowed = filterLogsToWindow(logs, window);

  const movers = buildMovers(contract, windowed, logs).map((mover) => ({
    exerciseSlug: mover.exerciseSlug,
    exerciseName: mover.exerciseName,
    linkSessionKey: mover.linkSessionKey,
    linkSessionName: mover.linkSessionName,
    from: formatScore(mover.first),
    to: formatScore(mover.latest),
    deltaPct: mover.deltaPct,
    latestIsBreakthrough: mover.latestIsBreakthrough,
    points: mover.points,
    sessionCount: mover.sessionCount,
  }));

  // Readiness reads full unwindowed history: it is a statement about the next session,
  // not about a span. The predicate itself lives in `double-progression.ts` because
  // `buildHeadline` counts exactly these rows — two copies of it would let the count above
  // the list disagree with the list.
  const ready = readyOccurrences(contract, logs).map(({ occurrence, state }) => ({
    exerciseSlug: occurrence.exerciseSlug,
    exerciseName: occurrence.exerciseName,
    sessionKey: occurrence.sessionKey,
    sessionName: occurrence.sessionName,
    summary: formatReadiness(state, "No range to progress through"),
  }));

  return {
    planSlug: plan.slug,
    planName: plan.name,
    planArchived: !!plan.archived_at,
    windowOptions: progressWindowOptions(now).map((o) => ({ id: o.id, label: o.label })),
    selectedWindow: window.id,
    headline: buildHeadline(contract, windowed, logs, window.start),
    ready,
    movers,
    consistency: buildConsistency(contract, windowed, logs, now),
    metrics: hubMetricRows(contract, windowed),
  };
};
