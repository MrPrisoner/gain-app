/**
 * The progress hub (design spec §6, §10): one compact card per declared session — no
 * drill-down, a handful of sessions is not the sprawl per-exercise progress avoids by
 * listing then drilling down instead — plus links out to the exercises and metrics
 * lists (Parts 4–5).
 */

import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import { logsForPlan } from "$lib/db/logs";
import { filterLogsToWindow } from "$lib/export/bundle";
import { exportWindowOptions, resolveExportWindow } from "$lib/export/windows";
import { sessionTypeStats } from "$lib/progress/session-stats";

export const load: PageServerLoad = ({ params, locals, url }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan) throw error(404, "No such plan");

  const version = getCurrentVersion(userDb, plan.id);
  if (!version) throw error(409, "That plan has no current version");
  const contract = contractOfVersion(version);

  const context = {
    versionNo: version.version_no,
    importedAt: version.imported_at,
    blockLengthWeeks: version.block_length_weeks,
    now: new Date(),
  };
  // A hand-edited `?window=` falls back to the default rather than erroring. That is
  // deliberately unlike the export route, which must `fail(400)`: the window's label is
  // written into the bundle the reviewing AI reads, so a silent substitution there
  // mislabels the document (`windows.ts`). Nothing on a chart screen leaves the app.
  const options = exportWindowOptions(context);
  // `exportWindowOptions` always returns at least `since_version` and `full`, so
  // `options[0]` is never undefined — the assertion documents that invariant rather
  // than papering over a real gap.
  const windowId = url.searchParams.get("window") ?? options[0]!.id;
  const window = resolveExportWindow(windowId, context) ?? options[0]!;

  const logs = logsForPlan(userDb, plan.id);
  const windowed = filterLogsToWindow(logs, window);

  const sessions = contract.sessions.map((session) => {
    const stats = sessionTypeStats(windowed, session.key);
    return {
      key: session.key,
      name: session.name,
      completionRate: stats.completionRate,
      finishedCount: stats.finishedCount,
      deviationCount: stats.deviationCount,
      duration: stats.duration.map((d) => ({
        x: new Date(d.startedAt).getTime(),
        y: Math.round(d.minutes),
      })),
    };
  });

  return {
    planSlug: plan.slug,
    planName: plan.name,
    planArchived: !!plan.archived_at,
    windowOptions: options.map((o) => ({ id: o.id, label: o.label })),
    selectedWindow: window.id,
    sessions,
  };
};
