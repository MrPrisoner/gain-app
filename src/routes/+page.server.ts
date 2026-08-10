/**
 * The front door (ARCHITECTURE §7): first run for an empty account, plan
 * overview once one is imported, and the paste box both share.
 *
 * The three actions are deliberately stateless. The first-run answers are
 * never stored — they fill a template and are discarded (§7). The import
 * flow re-parses the pasted document at each step rather than holding it
 * server-side between requests.
 */

import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { bootstrapPromptTemplate, contractMd } from "$lib/server/assets";
import { countPrescriptions, parsePlanDocument } from "$lib/parse/parser";
import { contractOfVersion, getCurrentVersion, listPlans } from "$lib/db/read";
import { prepareImportReview } from "$lib/db/review";
import { importPlan } from "$lib/db/import-plan";
import { renderBootstrapPrompt, type BootstrapAnswers } from "$lib/templates/render";

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
    return [
      {
        slug: plan.slug,
        name: plan.name,
        version_no: current.version_no,
        imported_at: current.imported_at.slice(0, 10),
        sessions: contract.sessions
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((session) => ({ key: session.key, name: session.name })),
        counts: {
          sessions: contract.sessions.length,
          exercises: contract.exercises.length,
          prescriptions: countPrescriptions(contract),
        },
      },
    ];
  });

  return { view: "plan" as const, plans: overviews, displayName: user.displayName };
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

  /**
   * Parse the pasted document and show what an import would write. Nothing
   * is written here — every failure returns the copy-pasteable report for
   * the AI, with the pasted text kept in place (UI-DECISIONS §11).
   */
  import: async ({ request, locals }) => {
    if (!locals.user) throw redirect(303, "/login");
    const source = formText(await request.formData(), "source_md");

    if (!source.trim()) {
      return fail(400, { importError: "Paste a plan document first.", source });
    }

    const parsed = parsePlanDocument(source);
    if (!parsed.ok) {
      return fail(400, {
        importFailure: { kind: parsed.kind, report: parsed.report },
        source,
      });
    }

    const userDb = getUserDbFor(locals.user.id);
    return { review: prepareImportReview(userDb, parsed), source };
  },

  /** Re-parse and commit. All-or-nothing, exactly as reviewed. */
  confirmImport: async ({ request, locals }) => {
    if (!locals.user) throw redirect(303, "/login");
    const source = formText(await request.formData(), "source_md");

    const parsed = parsePlanDocument(source);
    if (!parsed.ok) {
      return fail(400, {
        importFailure: { kind: parsed.kind, report: parsed.report },
        source,
      });
    }

    const userDb = getUserDbFor(locals.user.id);
    const result = importPlan(userDb, { parsed, now: new Date() });
    if (!result.ok) {
      return fail(409, { importError: result.message, source });
    }

    throw redirect(303, "/");
  },
};

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
