/**
 * Reverse-chronological, paginated in memory (design spec §8) — a fixed page size
 * rather than the full history at once, as a safety margin for a very long history
 * rather than a response to a known problem.
 */

import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import { logsForPlan } from "$lib/db/logs";
import { versionsByWorkout } from "$lib/db/history";

const PAGE_SIZE = 20;

export const load: PageServerLoad = ({ params, locals, url }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan || plan.archived_at) throw error(404, "No such plan");

  const logs = logsForPlan(userDb, plan.id);
  const versions = versionsByWorkout(userDb, plan.id);

  // Session *names*, per spec §8 — a bare key ("A") is an identifier, not a label a
  // person recognises. Names come from the plan as it stands now; a workout logged
  // under an older version whose names differ falls back to its key rather than
  // reading a second version's contract per row.
  const current = getCurrentVersion(userDb, plan.id);
  const sessionNames = new Map(
    current ? contractOfVersion(current).sessions.map((s) => [s.key, s.name]) : [],
  );

  const sorted = [...logs.workouts].sort((a, b) => b.started_at.localeCompare(a.started_at));
  const page = Math.max(0, Math.floor(Number(url.searchParams.get("page") ?? "0")) || 0);
  const pageWorkouts = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return {
    planSlug: plan.slug,
    planName: plan.name,
    page,
    hasMore: sorted.length > (page + 1) * PAGE_SIZE,
    workouts: pageWorkouts.map((w) => ({
      id: w.id,
      sessionKey: w.session_key,
      sessionName: sessionNames.get(w.session_key) ?? w.session_key,
      startedAt: w.started_at,
      status: w.status,
      setCount: logs.set_logs.filter((s) => s.workout_id === w.id).length,
      versionNo: versions.get(w.id)?.versionNo,
    })),
  };
};
