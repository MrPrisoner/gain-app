/**
 * One version's verbatim document (ARCHITECTURE §11).
 *
 * `source_md` is replayed byte-for-byte here exactly as the export replays it — GAIN
 * never paraphrases, summarises or regenerates a plan document, and this screen is the
 * plainest possible statement of that: what was imported is what comes back out.
 *
 * `readSourceMd` is a bare `readFileSync` on a path stored in the row, so a document
 * that has gone missing from disk — a restored backup that skipped the file tree, a
 * half-copied volume — must render an explanation rather than a 500. The row is still
 * good; only the file is gone, and saying so is more useful than an error page.
 */

import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { getPlanBySlug, listVersions, readSourceMd } from "$lib/db/read";

export const load: PageServerLoad = ({ params, locals }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan) throw error(404, "No such plan");

  // `/versions/2x` and `/versions/-1` are not versions; `Number` alone would take the
  // first and hand the second straight to the query.
  const versionNo = /^\d+$/.test(params.n) ? Number(params.n) : NaN;
  const version = listVersions(userDb, plan.id).find((v) => v.version_no === versionNo);
  if (!version) throw error(404, "No such version of this plan");

  let source: string | undefined;
  try {
    source = readSourceMd(userDb, version);
  } catch {
    source = undefined;
  }

  return {
    planSlug: plan.slug,
    planName: plan.name,
    versionNo: version.version_no,
    importedAt: version.imported_at.slice(0, 10),
    isCurrent: version.is_current === 1,
    source,
    /** Shown only when the document is missing, so the user can go looking for it. */
    sourcePath: version.source_path,
    filename: `${plan.slug}-v${version.version_no}.md`,
  };
};
