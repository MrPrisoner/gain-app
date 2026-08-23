/**
 * The per-exercise list (design spec §5, §2 decision 7): a compact row per
 * (session, exercise) occurrence with logs — no charts here, so this screen stays light
 * even at fixture scale (15-25+ occurrences). Readiness reads full unwindowed history,
 * per the general rule (spec §3) — this list is not export's summary.ts, which is the
 * one documented exception.
 */

import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import { logsForPlan } from "$lib/db/logs";
import { buildExerciseSeries, exerciseOccurrences } from "$lib/progress/exercise-series";
import { doubleProgressionState, formatReadiness } from "$lib/progress/double-progression";

export const load: PageServerLoad = ({ params, locals }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan) throw error(404, "No such plan");

  const version = getCurrentVersion(userDb, plan.id);
  if (!version) throw error(409, "That plan has no current version");
  const contract = contractOfVersion(version);

  const logs = logsForPlan(userDb, plan.id);

  const rows = exerciseOccurrences(contract).flatMap((occurrence) => {
    const series = buildExerciseSeries(logs, occurrence.sessionKey, occurrence.exerciseSlug);
    if (series.length === 0) return [];

    const target =
      occurrence.resolved.type === "time"
        ? occurrence.resolved.durationSec
        : occurrence.resolved.reps;
    const summary = formatReadiness(
      doubleProgressionState(
        series,
        target,
        occurrence.resolved.sets,
        occurrence.resolved.type,
        occurrence.resolved.perSide,
      ),
      "No range to progress through",
    );

    return [
      {
        sessionKey: occurrence.sessionKey,
        sessionName: occurrence.sessionName,
        exerciseSlug: occurrence.exerciseSlug,
        exerciseName: occurrence.exerciseName,
        summary,
      },
    ];
  });

  return { planSlug: plan.slug, rows };
};
