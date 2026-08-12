/**
 * The export route (ARCHITECTURE §11): pick a window, generate one pasteable document.
 *
 * The loop's return crossing. `generateExport` has existed since phase 1 — this route is
 * what makes it reachable, so keep it thin: everything but SvelteKit's shapes lives in
 * `./bundle-for-plan`.
 */

import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { logsForPlan } from "$lib/db/logs";
import { getPlanBySlug } from "$lib/db/read";
import { filterLogsToWindow } from "$lib/export/bundle";
import { exportWindowOptions } from "$lib/export/windows";
import { buildExportBundle, windowContextFor } from "./bundle-for-plan";

export const load: PageServerLoad = ({ params, locals }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan || plan.archived_at) throw error(404, "No such plan");

  const now = new Date();
  const context = windowContextFor(userDb, plan, now);
  if (!context) throw error(409, "That plan has no current version to export");

  // The counts make it visible when two windows cover the same span — on a plan that
  // has never been revised they all do — instead of leaving the user to guess.
  const logs = logsForPlan(userDb, plan.id);
  const options = exportWindowOptions(context).map((option) => ({
    id: option.id,
    label: option.label,
    workouts: filterLogsToWindow(logs, option).workouts.length,
  }));

  return {
    planSlug: plan.slug,
    planName: plan.name,
    versionNo: context.versionNo,
    options,
    totalWorkouts: logs.workouts.length,
  };
};

export const actions: Actions = {
  /**
   * Generate the bundle and hand it back for copying. Nothing here throws: an unknown
   * window, a missing version and a missing source document are all `fail`s carrying a
   * message the user can act on.
   */
  generate: async ({ request, params, locals }) => {
    if (!locals.user) throw redirect(303, "/login");

    const form = await request.formData();
    const raw = form.get("window");
    const windowId = typeof raw === "string" ? raw : "";

    const userDb = getUserDbFor(locals.user.id);
    const plan = getPlanBySlug(userDb, params.slug);
    if (!plan || plan.archived_at) {
      return fail(404, { actionError: "That plan no longer exists." });
    }

    const result = buildExportBundle(userDb, plan, windowId, new Date());
    if (!result.ok) {
      return fail(result.status, { actionError: result.message });
    }

    return {
      bundle: result.bundle,
      filename: result.filename,
      windowLabel: result.windowLabel,
    };
  },
};
