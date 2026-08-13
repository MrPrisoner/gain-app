/**
 * The session runner's data load (phase 4/6, ARCHITECTURE §9). Loads the resolved
 * session plus pre-fill data for every exercise in it.
 *
 * `start` is the only action left. Every other write — sets, metrics, deviations,
 * finishing the workout — now goes through the outbox (`$lib/sync/client.svelte`) as an
 * op, replayed server-side by `$lib/sync/replay` via `POST /api/sync`, never through a
 * form action (phase 6, design spec §3). `start` survives as the fallback hydration path
 * for a device with no local record — a different browser, or cleared storage — reading
 * the workout's rows back the same way it always has if the idempotent lookup resolves an
 * existing row.
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
import { resolveWorkoutIdByClientId } from "$lib/db/workout";
import type { UserDb } from "$lib/db/user-db";
import { pickPrefill, type PrefillByExercise } from "$lib/session/prefill";
import { hydrateSession, type SessionHydration } from "$lib/session/resume";
import { resolveLoad, resolveSession, sessionMetrics } from "$lib/session/session-view";
import type { IntOrRange } from "$lib/contract/schema";

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

  const prefillByExercise: PrefillByExercise = {};

  /**
   * Pre-fill is needed for every movement the runner can end up logging — which is not
   * just the prescribed ones. Any declared substitute can be swapped in mid-session
   * (`resolveSubstitute`), and CONTRACT is explicit that a substitute accumulates real
   * history under its own slug ("history needs a stable slug exactly as much as a
   * prescribed movement does"), so its last performance has to be here too or the strip
   * silently loses its pre-fill the moment you swap.
   */
  const prefillSlugs = new Map<
    string,
    {
      perSide: boolean;
      defaultKg: number | undefined;
      repsTarget: IntOrRange | undefined;
      durationTarget: IntOrRange | undefined;
    }
  >();
  for (const block of session.blocks) {
    if (block.tracking === "checkoff") continue;
    for (const exercise of block.exercises) {
      // Exactly one of `reps`/`durationSec` is defined per occurrence (CONTRACT: type
      // `reps` requires `reps`, type `time` requires `duration_sec`), so passing both
      // through unconditionally only ever supplies the default the exercise's own type
      // uses; `pickPrefill` ignores the other.
      prefillSlugs.set(exercise.slug, {
        perSide: exercise.perSide,
        defaultKg: exercise.load?.defaultKg,
        repsTarget: exercise.reps,
        durationTarget: exercise.durationSec,
      });
      for (const substituteSlug of exercise.substitutes) {
        const def = contract.exercises.find((e) => e.id === substituteSlug);
        if (!def || prefillSlugs.has(substituteSlug)) continue;
        // Reps/duration targets come from the occasion being replaced, same as
        // `resolveSubstitute` (UI-DECISIONS §6): a substitute has no prescription of its
        // own, only the slot it stands in for — and only the target matching its own
        // type, so a reps substitute for a timed original (or vice versa) gets neither.
        const substituteType = def.type ?? "reps";
        prefillSlugs.set(substituteSlug, {
          perSide: def.per_side === true,
          defaultKg: resolveLoad(contract, def.load)?.default_kg,
          repsTarget: substituteType === "reps" ? exercise.reps : undefined,
          durationTarget: substituteType === "time" ? exercise.durationSec : undefined,
        });
      }
    }
  }

  for (const [slug, { perSide, defaultKg, repsTarget, durationTarget }] of prefillSlugs) {
    const defId = getExerciseDefIdBySlug(userDb, plan.id, slug);
    if (!defId) continue;
    const rows = recentSetLogsForExercise(userDb, defId);
    prefillByExercise[slug] = perSide
      ? {
          left: pickPrefill(rows, "left", defaultKg, repsTarget, durationTarget),
          right: pickPrefill(rows, "right", defaultKg, repsTarget, durationTarget),
        }
      : { none: pickPrefill(rows, undefined, defaultKg, repsTarget, durationTarget) };
  }

  return {
    planSlug: plan.slug,
    // The start op carries this: a revision imported while a workout is queued must not
    // rebind that workout to a version it never ran under (design spec §4).
    planVersionId: version.id,
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
  /**
   * Read-only fallback hydration (phase 6, design spec §5). Its only remaining caller is
   * the runner's own `fetchServerHydration`, used when local reconstruction alone might
   * be incomplete — `idb.ts`'s `ack()` deletes a synced op from the outbox the moment the
   * server confirms it, so once anything has synced, the local outbox no longer has the
   * whole picture.
   *
   * Deliberately never creates a workout — that responsibility belongs entirely to the
   * offline `start` op replayed through `/api/sync` now. A version of this action that
   * could still create one would race that path: whichever reached the server first would
   * win, and if this read-only-looking fallback won, the workout would be stamped with
   * this request's server-received time rather than the client's true offline start
   * time — silently reintroducing the clock bug the offline replay path was built to
   * avoid. Resolving by `client_id` first and returning nothing when it is not found
   * keeps this action honestly read-only.
   */
  start: async ({ request, params, locals }) => {
    if (!locals.user) throw redirect(303, "/login");
    const form = await request.formData();

    try {
      const clientId = requireText(form, "client_id");
      const userDb = getUserDbFor(locals.user.id);

      const workoutId = resolveWorkoutIdByClientId(userDb, clientId);
      if (!workoutId) return { workoutId: undefined, hydration: undefined };

      const plan = getPlanBySlug(userDb, params.slug);
      if (!plan) return fail(404, { actionError: "No such plan." });
      const version = getCurrentVersion(userDb, plan.id);
      if (!version) return fail(404, { actionError: "This plan has no imported version." });

      return {
        workoutId,
        hydration: hydrateResumedWorkout(userDb, version, params.key, workoutId),
      };
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

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Throws a plain `Error` on a missing/malformed field. The `start` action's own
 * `try`/`catch` converts that throw into `fail(400, { actionError })` before it can reach
 * SvelteKit — nothing in `actions` is allowed to throw except `redirect` (ARCHITECTURE §9;
 * AGENTS.md, "What the phase-4 review changed").
 */
function requireText(form: FormData, name: string): string {
  const value = formText(form, name).trim();
  if (!value) throw new Error(`missing required form field \`${name}\``);
  return value;
}
