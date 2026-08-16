/**
 * Any numeric plan-declared metric is chartable (ROADMAP phase 7), keyed on
 * `(scope, key)` — never the bare key, since a plan may legally declare the same key at
 * two scopes (the fixture's `symptoms_during`, at both set and session scope). One
 * function serves every metric regardless of which plan declared it: no per-metric-name
 * branching, matching the discipline `buildProgressSummary` already holds.
 */

import type { GainContract, MetricDef, MetricScope } from "../contract/schema";
import type { Logs } from "../logs/types";

const SCOPE_ORDER: MetricScope[] = ["set", "exercise", "session"];

/** `number`/`scale` are CONTRACT's numeric metric types — `enum`/`text`/`bool` are
 * excluded, matching ROADMAP's "any *numeric* plan-declared metric is chartable". */
export function numericMetricDefs(
  contract: GainContract,
): { scope: MetricScope; def: MetricDef }[] {
  const declared: { scope: MetricScope; def: MetricDef }[] = [];
  for (const scope of SCOPE_ORDER) {
    for (const def of contract.metrics?.[scope] ?? []) {
      if (def.type === "number" || def.type === "scale") declared.push({ scope, def });
    }
  }
  return declared;
}

export type MetricSeriesPoint = { workoutId: string; startedAt: string; value: number };

export function numericMetricSeries(
  logs: Logs,
  scope: MetricScope,
  key: string,
): MetricSeriesPoint[] {
  const workoutById = new Map(logs.workouts.map((w) => [w.id, w]));
  const setLogById = new Map(logs.set_logs.map((s) => [s.id, s]));

  const points: MetricSeriesPoint[] = [];
  for (const value of logs.metric_values) {
    if (value.key !== key || value.ref.scope !== scope || value.value_num === undefined) continue;

    const workoutId =
      value.ref.scope === "set"
        ? setLogById.get(value.ref.set_log_id)?.workout_id
        : value.ref.workout_id;
    const workout = workoutId ? workoutById.get(workoutId) : undefined;
    if (!workout) continue;

    points.push({
      workoutId: workout.id,
      startedAt: workout.started_at,
      value: value.value_num,
    });
  }

  return points.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
