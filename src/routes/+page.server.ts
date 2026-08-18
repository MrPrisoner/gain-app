/**
 * The front door (ARCHITECTURE §7): first run for an empty account, plan
 * overview once one is imported, and a link into the import flow both share.
 *
 * The bootstrap-prompt action is deliberately stateless — the first-run
 * answers are never stored, they fill a template and are discarded (§7). The
 * import flow itself lives at `/import` (`src/routes/import/+page.server.ts`).
 */

import { redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { bootstrapPromptTemplate, contractMd } from "$lib/server/assets";
import { countPrescriptions } from "$lib/parse/parser";
import { contractOfVersion, getCurrentVersion, listPlans } from "$lib/db/read";
import { deriveExerciseName, type GainContract } from "$lib/contract/schema";
import { renderBootstrapPrompt, type BootstrapAnswers } from "$lib/templates/render";
import { recentActivities, recentWorkoutsForPlan, nextMorningCandidates } from "$lib/db/home";
import { suggestActivityKinds } from "$lib/home/activity-kinds";
import { suggestNextSession } from "$lib/home/next-session";

export const load: PageServerLoad = ({ locals }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plans = listPlans(userDb).filter((plan) => !plan.archived_at);

  if (plans.length === 0) {
    return { view: "first_run" as const, displayName: user.displayName };
  }

  const overviews = plans.flatMap((plan) => {
    const current = getCurrentVersion(userDb, plan.id);
    if (!current) return [];
    const contract = contractOfVersion(current);

    const recentWorkouts = recentWorkoutsForPlan(userDb, plan.id);
    const suggestion = suggestNextSession(
      contract.sessions.map((s) => ({ key: s.key, order: s.order })),
      contract.scheduling?.sequence,
      recentWorkouts,
    );
    const lastDoneByKey = new Map(suggestion.overrides.map((o) => [o.key, o.lastDoneDate]));

    return [
      {
        slug: plan.slug,
        name: plan.name,
        version_no: current.version_no,
        imported_at: current.imported_at.slice(0, 10),
        suggestion,
        schedulingRules: contract.scheduling?.rules,
        dropOrder: contract.scheduling?.drop_order,
        sessions: contract.sessions
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((session) => ({
            key: session.key,
            name: session.name,
            note: session.note,
            lastDoneDate: lastDoneByKey.get(session.key),
            blocks: session.blocks.map((block) => ({
              key: block.key,
              name: block.name,
              exercises: block.exercises.map((rx) => exerciseName(contract, rx.id)),
            })),
          })),
        counts: {
          sessions: contract.sessions.length,
          exercises: contract.exercises.length,
          prescriptions: countPrescriptions(contract),
        },
      },
    ];
  });

  return {
    view: "plan" as const,
    plans: overviews,
    displayName: user.displayName,
    activityKinds: suggestActivityKinds(recentActivities(userDb)),
    nextMorningCandidates: nextMorningCandidates(userDb, new Date()),
  };
};

export const actions: Actions = {
  /**
   * Fill the bootstrap template with the four optional answers plus the
   * user's OIDC display name, and hand the whole prompt back for copying.
   * The answers are not stored (§7); the display name is never stored either
   * — see `checkSession`.
   */
  generatePrompt: async ({ request, locals }) => {
    const form = await request.formData();
    const answers: BootstrapAnswers = {
      equipment: field(form, "equipment"),
      sessions_per_week: field(form, "sessions_per_week"),
      session_minutes: field(form, "session_minutes"),
      goals: field(form, "goals"),
      constraints: field(form, "constraints"),
      display_name: locals.user?.displayName ?? undefined,
    };
    return { prompt: renderBootstrapPrompt(bootstrapPromptTemplate, answers, contractMd) };
  },
};

/** Display name for a prescription's exercise id, resolved via the catalogue. */
function exerciseName(contract: GainContract, exerciseId: string): string {
  const def = contract.exercises.find((e) => e.id === exerciseId);
  return def?.name ?? deriveExerciseName(exerciseId);
}

/**
 * FormData values are `string | File`; a text field is always the string, and
 * anything else is treated as empty rather than stringified.
 */
function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function field(form: FormData, name: string): string | undefined {
  const value = formText(form, name).trim();
  return value === "" ? undefined : value;
}
