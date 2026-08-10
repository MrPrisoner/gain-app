/**
 * The session runner's data and actions (phase 4, ARCHITECTURE §9). Loads the resolved
 * session plus pre-fill data for every exercise in it; every write goes through
 * `$lib/db/workout`, which is idempotent on the client-generated `client_id` the
 * runner's Svelte components mint via `ulidx` — the server never mints one, because
 * phase 5 replays these ids (ARCHITECTURE §9).
 */

import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import {
  contractOfVersion,
  getCurrentVersion,
  getExerciseDefIdBySlug,
  getPlanBySlug,
  type PlanVersionRow,
} from "$lib/db/read";
import { recentSetLogsForExercise } from "$lib/db/recent-sets";
import { workoutHistoryFor } from "$lib/db/workout-history";
import { finishWorkout, logDeviation, logMetric, logSet, startWorkout } from "$lib/db/workout";
import type { UserDb } from "$lib/db/user-db";
import { pickPrefill } from "$lib/session/prefill";
import { hydrateSession, type SessionHydration } from "$lib/session/resume";
import { resolveLoad, resolveSession, sessionMetrics } from "$lib/session/session-view";
import type { DeviationKind } from "$lib/logs/types";

export const load: PageServerLoad = ({ params, locals }) => {
  if (!locals.user) throw redirect(303, "/login");

  const userDb = getUserDbFor(locals.user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan) throw error(404, "No such plan");

  const version = getCurrentVersion(userDb, plan.id);
  if (!version) throw error(404, "This plan has no imported version");

  const contract = contractOfVersion(version);
  const session = resolveSession(contract, params.key);
  if (!session) throw error(404, "No such session in the current plan version");

  const prefillByExercise: Record<
    string,
    {
      left?: ReturnType<typeof pickPrefill>;
      right?: ReturnType<typeof pickPrefill>;
      none?: ReturnType<typeof pickPrefill>;
    }
  > = {};

  /**
   * Pre-fill is needed for every movement the runner can end up logging — which is not
   * just the prescribed ones. Any declared substitute can be swapped in mid-session
   * (`resolveSubstitute`), and CONTRACT is explicit that a substitute accumulates real
   * history under its own slug ("history needs a stable slug exactly as much as a
   * prescribed movement does"), so its last performance has to be here too or the strip
   * silently loses its pre-fill the moment you swap.
   */
  const prefillSlugs = new Map<string, { perSide: boolean; defaultKg: number | undefined }>();
  for (const block of session.blocks) {
    if (block.tracking === "checkoff") continue;
    for (const exercise of block.exercises) {
      prefillSlugs.set(exercise.slug, {
        perSide: exercise.perSide,
        defaultKg: exercise.load?.defaultKg,
      });
      for (const substituteSlug of exercise.substitutes) {
        const def = contract.exercises.find((e) => e.id === substituteSlug);
        if (!def || prefillSlugs.has(substituteSlug)) continue;
        prefillSlugs.set(substituteSlug, {
          perSide: def.per_side === true,
          defaultKg: resolveLoad(contract, def.load)?.default_kg,
        });
      }
    }
  }

  for (const [slug, { perSide, defaultKg }] of prefillSlugs) {
    const defId = getExerciseDefIdBySlug(userDb, plan.id, slug);
    if (!defId) continue;
    const rows = recentSetLogsForExercise(userDb, defId);
    prefillByExercise[slug] = perSide
      ? {
          left: pickPrefill(rows, "left", defaultKg),
          right: pickPrefill(rows, "right", defaultKg),
        }
      : { none: pickPrefill(rows, undefined, defaultKg) };
  }

  return {
    planSlug: plan.slug,
    session,
    prefillByExercise,
    // The whole catalogue and load table, so a swap can be resolved client-side
    // (`resolveSubstitute`) without a round trip. A substitute is declared in the
    // catalogue but need not be prescribed by any session, so `session` alone cannot
    // answer what `dead-bug` or `front-plank` *is*.
    catalogue: contract.exercises,
    loads: contract.loads,
    startMetrics: sessionMetrics(contract, "start"),
    endMetrics: sessionMetrics(contract, "end"),
    // UI-DECISIONS §8: `next_morning` metrics are declared but deliberately not asked in
    // the wrap-up sheet — the runner uses this only to render the honest "we'll ask
    // tomorrow" note, never to prompt for them here.
    nextMorningMetrics: sessionMetrics(contract, "next_morning"),
  };
};

export const actions: Actions = {
  start: async ({ request, params, locals }) => {
    if (!locals.user) throw redirect(303, "/login");
    const form = await request.formData();

    try {
      const clientId = requireText(form, "client_id");

      const userDb = getUserDbFor(locals.user.id);
      const plan = getPlanBySlug(userDb, params.slug);
      if (!plan) return fail(404, { actionError: "No such plan." });
      const version = getCurrentVersion(userDb, plan.id);
      if (!version) return fail(404, { actionError: "This plan has no imported version." });

      const workout = startWorkout(userDb, {
        planVersionId: version.id,
        sessionKey: params.key,
        clientId,
        now: new Date(),
      });

      /**
       * Resume (ARCHITECTURE §9). The page holds the workout's `client_id` in `sessionStorage` and
       * posts it here on mount, which is already how a reload lands back on the same
       * workout row rather than starting a second one. `load` runs before that POST and
       * cannot see the id, so the read-back rides along on this same response: one round
       * trip, one idempotent lookup, and the same lookup phase 5 will replay through.
       *
       * A fresh start has nothing to read back, so it does none of this work.
       */
      const hydration = workout.resumed
        ? hydrateResumedWorkout(userDb, version, params.key, workout.id)
        : undefined;

      return { workoutId: workout.id, hydration };
    } catch (err) {
      return fail(400, { actionError: err instanceof Error ? err.message : "Invalid request." });
    }
  },

  logSet: async ({ request, params, locals }) => {
    if (!locals.user) throw redirect(303, "/login");
    const form = await request.formData();
    const userDb = getUserDbFor(locals.user.id);
    const plan = getPlanBySlug(userDb, params.slug);
    if (!plan) return fail(404, { actionError: "No such plan." });

    try {
      const slug = requireText(form, "exercise_slug");
      const exerciseDefId = getExerciseDefIdBySlug(userDb, plan.id, slug);
      if (!exerciseDefId) return fail(400, { actionError: `Unknown exercise \`${slug}\`.` });

      const side = optionalText(form, "side");
      if (side !== undefined && side !== "left" && side !== "right") {
        return fail(400, { actionError: "Invalid side." });
      }

      const difficulty = optionalText(form, "difficulty");
      if (
        difficulty !== undefined &&
        difficulty !== "easy" &&
        difficulty !== "medium" &&
        difficulty !== "hard"
      ) {
        return fail(400, { actionError: "Invalid difficulty." });
      }

      const result = logSet(userDb, {
        workoutId: requireText(form, "workout_id"),
        exerciseDefId,
        setNo: Number(requireText(form, "set_no")),
        side,
        reps: optionalNumber(form, "reps"),
        weightKg: optionalNumber(form, "weight_kg"),
        durationS: optionalNumber(form, "duration_s"),
        difficulty,
        clientId: requireText(form, "client_id"),
      });
      return { setLogId: result.id };
    } catch (err) {
      return fail(400, { actionError: err instanceof Error ? err.message : "Invalid request." });
    }
  },

  logMetric: async ({ request, params, locals }) => {
    if (!locals.user) throw redirect(303, "/login");
    const form = await request.formData();
    const userDb = getUserDbFor(locals.user.id);

    try {
      const scope = requireText(form, "scope");
      if (scope !== "set" && scope !== "exercise" && scope !== "session") {
        return fail(400, { actionError: "Invalid metric scope." });
      }

      let exerciseDefId: string | undefined;
      const exerciseSlug = optionalText(form, "exercise_slug");
      if (exerciseSlug !== undefined) {
        const plan = getPlanBySlug(userDb, params.slug);
        exerciseDefId = plan ? getExerciseDefIdBySlug(userDb, plan.id, exerciseSlug) : undefined;
      }

      const result = logMetric(userDb, {
        scope,
        setLogId: optionalText(form, "set_log_id"),
        workoutId: optionalText(form, "workout_id"),
        exerciseDefId,
        metricKey: requireText(form, "metric_key"),
        valueNum: optionalNumber(form, "value_num"),
        valueText: optionalText(form, "value_text"),
        clientId: requireText(form, "client_id"),
      });
      return { metricValueId: result.id };
    } catch (err) {
      return fail(400, {
        actionError: err instanceof Error ? err.message : "Invalid metric value.",
      });
    }
  },

  logDeviation: async ({ request, params, locals }) => {
    if (!locals.user) throw redirect(303, "/login");
    const form = await request.formData();
    const userDb = getUserDbFor(locals.user.id);
    const plan = getPlanBySlug(userDb, params.slug);
    if (!plan) return fail(404, { actionError: "No such plan." });

    try {
      const slug = requireText(form, "exercise_slug");
      const exerciseDefId = getExerciseDefIdBySlug(userDb, plan.id, slug);
      if (!exerciseDefId) return fail(400, { actionError: `Unknown exercise \`${slug}\`.` });

      const kind = requireText(form, "kind");
      if (!DEVIATION_KINDS.includes(kind as DeviationKind)) {
        return fail(400, { actionError: `Invalid deviation kind \`${kind}\`.` });
      }

      const result = logDeviation(userDb, {
        workoutId: requireText(form, "workout_id"),
        exerciseDefId,
        kind: kind as DeviationKind,
        reasonCode: optionalText(form, "reason_code"),
        note: optionalText(form, "note"),
        substituteExerciseSlug: optionalText(form, "substitute_exercise_slug"),
        clientId: requireText(form, "client_id"),
      });
      return { deviationId: result.id };
    } catch (err) {
      return fail(400, { actionError: err instanceof Error ? err.message : "Invalid request." });
    }
  },

  finish: async ({ request, locals }) => {
    if (!locals.user) throw redirect(303, "/login");
    const form = await request.formData();
    const userDb = getUserDbFor(locals.user.id);

    try {
      const status = requireText(form, "status");
      if (status !== "completed" && status !== "partial" && status !== "stopped") {
        return fail(400, { actionError: "Invalid workout status." });
      }

      finishWorkout(userDb, {
        workoutId: requireText(form, "workout_id"),
        status,
        note: optionalText(form, "note"),
        now: new Date(),
      });
      return { finished: true };
    } catch (err) {
      return fail(400, { actionError: err instanceof Error ? err.message : "Invalid request." });
    }
  },
};

/**
 * The reconstruction is pure and lives in `$lib/session/resume`; this is only the I/O
 * around it — resolve the same session `load` resolves, read the workout's own rows back,
 * hand both to the pure layer. `undefined` when the session key no longer resolves against
 * the current plan version, which means the runner is showing something the plan no longer
 * describes; there is nothing honest to hydrate into it.
 */
function hydrateResumedWorkout(
  userDb: UserDb,
  version: PlanVersionRow,
  sessionKey: string,
  workoutId: string,
): SessionHydration | undefined {
  const session = resolveSession(contractOfVersion(version), sessionKey);
  if (!session) return undefined;
  return hydrateSession(session, workoutHistoryFor(userDb, workoutId));
}

/** The schema's CHECK constraint on `deviation.kind` (`schema.ts`) — kept in sync by hand
 * with the `DeviationKind` union it validates against. */
const DEVIATION_KINDS: DeviationKind[] = [
  "skip",
  "substitute",
  "add_set",
  "drop_set",
  "stop_red_flag",
];

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Throws a plain `Error` on a missing/malformed field. Every call site is inside an
 * action's own `try`/`catch`, which converts that throw into `fail(400, { actionError })`
 * before it can reach SvelteKit — nothing in `actions` is allowed to throw except
 * `redirect` (ARCHITECTURE §9; AGENTS.md, "What the phase-4 review changed").
 */
function requireText(form: FormData, name: string): string {
  const value = formText(form, name).trim();
  if (!value) throw new Error(`missing required form field \`${name}\``);
  return value;
}

function optionalText(form: FormData, name: string): string | undefined {
  const value = formText(form, name).trim();
  return value === "" ? undefined : value;
}

function optionalNumber(form: FormData, name: string): number | undefined {
  const value = optionalText(form, name);
  if (value === undefined) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}
