/**
 * The import screen — every crossing back from an AI lands here.
 *
 * Paste box, parse-error report and diff review are one route because
 * UI §11 requires a failed import to keep the pasted text in place with
 * the copy-the-error action beside it, so the textarea has to live wherever errors
 * render. And ARCHITECTURE §8 insists the first import is not a special case in
 * the pipeline; routing revisions to their own screen would have made it one.
 *
 * Nothing is stashed between the two actions. The document and the rename
 * dispositions ride hidden fields, and `commit` re-parses and re-derives the diff,
 * so a document edited between review and commit gets its mappings rejected
 * rather than silently applied to something else.
 */

import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { parsePlanDocument } from "$lib/parse/parser";
import { prepareImportReview } from "$lib/db/review";
import { importPlan, type ExerciseRename } from "$lib/db/import-plan";
import { presentDiff } from "$lib/diff/present";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import type { UserDb } from "$lib/db/user-db";
import type { GainContract } from "$lib/contract/schema";

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) throw redirect(303, "/login");
  return {};
};

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** The stored current contract for a plan slug, or undefined if it cannot be read. */
function currentContract(userDb: UserDb, planSlug: string): GainContract | undefined {
  const plan = getPlanBySlug(userDb, planSlug);
  const current = plan ? getCurrentVersion(userDb, plan.id) : undefined;
  return current ? contractOfVersion(current) : undefined;
}

/**
 * Archiving is reversible and read-only (`$lib/db/archive.ts`), and a revision is the
 * one inbound write it refuses: committing a new version to a plan the user has put
 * away would resurrect it silently and, worse, run the rename machinery against a plan
 * they are no longer looking at. Says so rather than 404ing — the recovery is one tap
 * on Home, and a bare "no such plan" would read as data loss for a plan that is right
 * there.
 */
function archivedRefusal(userDb: UserDb, planSlug: string): string | undefined {
  const plan = getPlanBySlug(userDb, planSlug);
  if (!plan?.archived_at) return undefined;
  return `${plan.name} is archived. Unarchive it on the home screen before importing a revision.`;
}

export const actions: Actions = {
  check: async ({ request, locals }) => {
    if (!locals.user) throw redirect(303, "/login");
    const source = formText(await request.formData(), "source_md");

    if (!source.trim()) {
      return fail(400, { importError: "Paste a plan document first.", source });
    }

    const parsed = parsePlanDocument(source);
    if (!parsed.ok) {
      return fail(400, { importFailure: { kind: parsed.kind, report: parsed.report }, source });
    }

    const userDb = getUserDbFor(locals.user.id);
    const review = prepareImportReview(userDb, parsed);

    if (review.kind === "first_import") {
      return { firstImport: review, source };
    }

    const archived = archivedRefusal(userDb, review.plan_slug);
    if (archived) return fail(409, { importError: archived, source });

    const before = currentContract(userDb, review.plan_slug);
    if (!before) {
      return fail(500, { importError: "The stored plan could not be read.", source });
    }

    return { revision: presentDiff(review.diff, before, parsed.contract), source };
  },

  commit: async ({ request, locals }) => {
    if (!locals.user) throw redirect(303, "/login");
    const form = await request.formData();
    const source = formText(form, "source_md");

    const parsed = parsePlanDocument(source);
    if (!parsed.ok) {
      return fail(400, { importFailure: { kind: parsed.kind, report: parsed.report }, source });
    }

    const userDb = getUserDbFor(locals.user.id);
    const review = prepareImportReview(userDb, parsed);

    const renames: ExerciseRename[] = [];
    if (review.kind === "revision") {
      const archived = archivedRefusal(userDb, review.plan_slug);
      if (archived) return fail(409, { importError: archived, source });

      const before = currentContract(userDb, review.plan_slug);
      if (!before) {
        return fail(500, { importError: "The stored plan could not be read.", source });
      }
      const view = presentDiff(review.diff, before, parsed.contract);

      if (view.blocking.length > 0) {
        return fail(400, { importError: view.blocking.join(" "), source });
      }

      for (const disposition of view.dispositions) {
        const choice = formText(form, `disposition:${disposition.slug}`);
        if (choice === "") {
          return fail(400, {
            importError: `Say what happened to ${disposition.name} before committing.`,
            source,
          });
        }
        if (choice === "removed") continue;
        if (!choice.startsWith("rename:")) {
          return fail(400, { importError: `Unrecognised choice for ${disposition.name}.`, source });
        }
        renames.push({ from: disposition.slug, to: choice.slice("rename:".length) });
      }
    }

    const result = importPlan(userDb, { parsed, now: new Date(), renames });
    if (!result.ok) {
      // `version_not_newer` is a genuine conflict; `invalid_rename` is a bad request —
      // the client sent a mapping that no longer validates against the freshly
      // re-parsed document. Collapsing both to 409 mislabels the second case.
      const status = result.kind === "version_not_newer" ? 409 : 400;
      return fail(status, { importError: result.message, source });
    }

    throw redirect(303, "/");
  },
};
