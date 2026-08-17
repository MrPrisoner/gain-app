/**
 * Full detail for one workout (design spec §8): every set rendered with
 * `renderExerciseSets`, reused verbatim from the export so a workout reads identically
 * here and in a bundle; every deviation; every metric value; the plan version as plain
 * text, per spec §2 decision 6 — no drill-in, since browsing an old version's document
 * is a separate, unbuilt ROADMAP loose end.
 */

import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import { logsForPlan } from "$lib/db/logs";
import { versionsByWorkout } from "$lib/db/history";
import { deriveExerciseName } from "$lib/contract/schema";
import { renderExerciseSets } from "$lib/export/summary";
import type { SetLog } from "$lib/logs/types";

export const load: PageServerLoad = ({ params, locals }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan || plan.archived_at) throw error(404, "No such plan");

  const logs = logsForPlan(userDb, plan.id);
  const workout = logs.workouts.find((w) => w.id === params.workoutId);
  if (!workout) throw error(404, "No such workout");

  const version = versionsByWorkout(userDb, plan.id).get(workout.id);

  // Catalogue names, not derived ones: `deriveExerciseName("db-floor-press")` is "Db
  // floor press" where the plan — and the runner the user logged this in — says
  // "Dumbbell floor press". Derivation stays as the fallback for a slug the current
  // version no longer declares, which is exactly what the contract itself specifies.
  const current = getCurrentVersion(userDb, plan.id);
  const contract = current ? contractOfVersion(current) : undefined;
  const exerciseNames = new Map(
    contract?.exercises.map((e) => [e.id, e.name ?? deriveExerciseName(e.id)]) ?? [],
  );
  const sessionName = contract?.sessions.find((s) => s.key === workout.session_key)?.name;

  const setsByExercise = new Map<string, SetLog[]>();
  for (const set of logs.set_logs) {
    if (set.workout_id !== workout.id) continue;
    const list = setsByExercise.get(set.exercise_slug) ?? [];
    list.push(set);
    setsByExercise.set(set.exercise_slug, list);
  }
  const exercises = [...setsByExercise.entries()].map(([slug, sets]) => ({
    slug,
    name: exerciseNames.get(slug) ?? deriveExerciseName(slug),
    rendered: renderExerciseSets(sets),
  }));

  // Metric labels, keyed on `(scope, key)` per the invariant: a plan may legally
  // declare the same key at two scopes (the fixture's `symptoms_during`, at both set
  // and session scope), so the bare key is never a safe lookup on its own.
  const metricLabels = new Map<string, string>();
  for (const scope of ["set", "exercise", "session"] as const) {
    for (const def of contract?.metrics?.[scope] ?? []) {
      metricLabels.set(`${scope}:${def.key}`, def.label);
    }
  }

  const setLogById = new Map(logs.set_logs.map((s) => [s.id, s]));
  const metrics = logs.metric_values
    .filter((v) =>
      v.ref.scope === "set"
        ? setLogById.get(v.ref.set_log_id)?.workout_id === workout.id
        : v.ref.workout_id === workout.id,
    )
    .map((v) => ({
      id: v.id,
      scope: v.ref.scope,
      key: v.key,
      label: metricLabels.get(`${v.ref.scope}:${v.key}`) ?? v.key,
      exerciseSlug: v.ref.scope === "exercise" ? v.ref.exercise_slug : undefined,
      exerciseName:
        v.ref.scope === "exercise"
          ? (exerciseNames.get(v.ref.exercise_slug) ?? deriveExerciseName(v.ref.exercise_slug))
          : undefined,
      value: v.value_num !== undefined ? String(v.value_num) : (v.value_text ?? "–"),
    }));

  const deviations = logs.deviations
    .filter((d) => d.workout_id === workout.id)
    .map((d) => ({
      exerciseSlug: d.exercise_slug,
      kind: d.kind,
      reasonCode: d.reason_code,
      note: d.note,
      substituteSlug: d.substitute_exercise_slug,
    }));

  return {
    planSlug: plan.slug,
    workout: {
      sessionKey: workout.session_key,
      sessionName,
      startedAt: workout.started_at,
      status: workout.status,
      note: workout.note,
    },
    version,
    exercises,
    metrics,
    deviations,
  };
};
