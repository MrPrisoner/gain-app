/**
 * The metric trend detail: one windowed line chart per (scope, key)
 * numeric metric, reached from the metric trends list.
 */

import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import { logsForPlan } from "$lib/db/logs";
import { filterLogsToWindow } from "$lib/export/bundle";
import { exportWindowOptions, resolveExportWindow } from "$lib/export/windows";
import { numericMetricDefs, numericMetricSeries } from "$lib/progress/metric-series";

const SCOPES = ["set", "exercise", "session"] as const;

export const load: PageServerLoad = ({ params, locals, url }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");
  if (!(SCOPES as readonly string[]).includes(params.scope)) {
    throw error(404, "No such metric scope");
  }
  const scope = params.scope as (typeof SCOPES)[number];

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan) throw error(404, "No such plan");

  const version = getCurrentVersion(userDb, plan.id);
  if (!version) throw error(409, "That plan has no current version");
  const contract = contractOfVersion(version);

  const declared = numericMetricDefs(contract).find(
    (m) => m.scope === scope && m.def.key === params.key,
  );
  if (!declared) throw error(404, "No such metric");

  const logs = logsForPlan(userDb, plan.id);

  const context = {
    versionNo: version.version_no,
    importedAt: version.imported_at,
    blockLengthWeeks: version.block_length_weeks,
    now: new Date(),
  };
  const options = exportWindowOptions(context);
  // `exportWindowOptions` always returns at least `since_version` and `full`, so
  // `options[0]` is never undefined — the assertion documents that invariant rather
  // than papering over a real gap (matches the hub and exercise-detail load functions).
  const windowId = url.searchParams.get("window") ?? options[0]!.id;
  const window = resolveExportWindow(windowId, context) ?? options[0]!;

  const series = numericMetricSeries(filterLogsToWindow(logs, window), scope, params.key);

  return {
    planSlug: plan.slug,
    label: declared.def.label,
    windowOptions: options.map((o) => ({ id: o.id, label: o.label })),
    selectedWindow: window.id,
    points: series.map((p) => ({ x: new Date(p.startedAt).getTime(), y: p.value })),
  };
};
