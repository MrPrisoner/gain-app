/**
 * Any numeric plan-declared metric is chartable, keyed on
 * `(scope, key)` — never the bare key, since a plan may legally declare the same key at
 * two scopes (the fixture's `symptoms_during`, at both set and session scope). One
 * function serves every metric regardless of which plan declared it: no per-metric-name
 * branching, matching the discipline `buildProgressSummary` already holds.
 */

import type { GainContract, MetricDef, MetricScope } from "../contract/schema";
import type { Logs } from "../logs/types";

const SCOPE_ORDER: MetricScope[] = ["set", "exercise", "session"];

/** `number`/`scale` are CONTRACT's numeric metric types — `enum`/`text`/`bool` are
 * excluded, because only a numeric metric has a trend to plot. */
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

export type HubMetricRow = {
  scope: MetricScope;
  key: string;
  label: string;
  points: { x: number; y: number }[];
  latest: number | undefined;
  /** A `scale` metric's declared bounds, for `Sparkline`'s `yDomain`. */
  domain: [number, number] | undefined;
};

/**
 * One row per `(scope, key)` with something logged, ready to render inline on the hub.
 *
 * A set-scope metric is averaged per workout. `numericMetricSeries` stamps every value
 * with its workout's `started_at`, so a metric answered once per set — the fixture's
 * set-scope `symptoms_during` — returns several points sharing one x coordinate. That is
 * already true on the old metric detail page; inlining the chart on a busier screen makes
 * a vertical stack of dots at one date look like a rendering fault.
 *
 * A `scale` metric carries its declared bounds so `Sparkline` plots against them rather
 * than auto-scaling: a 0-10 score that moved 2 to 3 must render as the near-flat line it
 * is, not as a climb.
 */
export function hubMetricRows(contract: GainContract, logs: Logs): HubMetricRow[] {
  const rows: HubMetricRow[] = [];
  for (const { scope, def } of numericMetricDefs(contract)) {
    const series = numericMetricSeries(logs, scope, def.key);
    if (series.length === 0) continue;

    const sums = new Map<string, { startedAt: string; total: number; count: number }>();
    for (const point of series) {
      const entry = sums.get(point.workoutId) ?? {
        startedAt: point.startedAt,
        total: 0,
        count: 0,
      };
      entry.total += point.value;
      entry.count += 1;
      sums.set(point.workoutId, entry);
    }

    const points = [...sums.values()]
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((entry) => ({
        x: new Date(entry.startedAt).getTime(),
        y: entry.total / entry.count,
      }));

    rows.push({
      scope,
      key: def.key,
      label: def.label,
      points,
      latest: points.at(-1)?.y,
      domain:
        def.type === "scale" && def.min !== undefined && def.max !== undefined
          ? [def.min, def.max]
          : undefined,
    });
  }
  return rows;
}
