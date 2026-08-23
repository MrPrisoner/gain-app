/**
 * The metric trends list (design spec §7): one row per (scope, key) with logged values.
 * Non-numeric metrics never appear — numericMetricDefs already filters to number/scale.
 */

import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { contractOfVersion, getCurrentVersion, getPlanBySlug } from "$lib/db/read";
import { logsForPlan } from "$lib/db/logs";
import { numericMetricDefs, numericMetricSeries } from "$lib/progress/metric-series";

export const load: PageServerLoad = ({ params, locals }) => {
  const user = locals.user;
  if (!user) throw redirect(303, "/login");

  const userDb = getUserDbFor(user.id);
  const plan = getPlanBySlug(userDb, params.slug);
  if (!plan) throw error(404, "No such plan");

  const version = getCurrentVersion(userDb, plan.id);
  if (!version) throw error(409, "That plan has no current version");
  const contract = contractOfVersion(version);

  const logs = logsForPlan(userDb, plan.id);

  const metrics = numericMetricDefs(contract)
    .map(({ scope, def }) => {
      const series = numericMetricSeries(logs, scope, def.key);
      return {
        scope,
        key: def.key,
        label: def.label,
        count: series.length,
        latest: series.at(-1)?.value,
      };
    })
    .filter((m) => m.count > 0);

  return { planSlug: plan.slug, metrics };
};
