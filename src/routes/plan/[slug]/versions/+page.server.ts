/**
 * Every version of a plan, newest first (ROADMAP, "Loose ends"; ARCHITECTURE §8).
 *
 * Workouts have always been bound to the version they were logged under, so "what did
 * the plan say in week 3" was answerable in the data and unanswerable in the UI. All the
 * reading this needs already existed in `$lib/db/read.ts` — nothing new belongs there,
 * so this route is pure assembly.
 */

import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { getPlanBySlug, listVersions } from "$lib/db/read";

export const load: PageServerLoad = ({ params, locals }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan) throw error(404, "No such plan");

  const versions = listVersions(userDb, plan.id)
    .slice()
    .sort((a, b) => b.version_no - a.version_no);

  return {
    planSlug: plan.slug,
    planName: plan.name,
    versions: versions.map((version) => ({
      versionNo: version.version_no,
      importedAt: version.imported_at.slice(0, 10),
      basedOnVersion: version.based_on_version,
      isCurrent: version.is_current === 1,
      // `plan.changelog` as the AI wrote it — one line per substantive change, required
      // by the contract on every version above 1 and absent on v1 by construction.
      changelog: parseChangelog(version.changelog_json),
    })),
  };
};

/**
 * The column is a serialized `string[]`. It is written by `importPlan` from a validated
 * contract, so a parse failure means the row was corrupted rather than that the AI sent
 * something odd — either way the version still has to list, so this degrades to "no
 * changelog" instead of taking the page down with it.
 */
function parseChangelog(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((line): line is string => typeof line === "string")
      : [];
  } catch {
    return [];
  }
}
