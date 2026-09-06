import { describe, expect, it } from "vitest";
import type { GainContract } from "../../src/lib/contract/schema";
import { EMPTY_LOGS, type Logs } from "../../src/lib/logs/types";
import {
  numericMetricDefs,
  numericMetricSeries,
  hubMetricRows,
} from "../../src/lib/progress/metric-series";

const contract = {
  metrics: {
    set: [
      { key: "rpe", label: "Set RPE", type: "scale", min: 1, max: 10 },
      { key: "symptoms_during", label: "Symptoms", type: "scale", min: 0, max: 10 },
    ],
    session: [
      { key: "rpe", label: "Session RPE", type: "scale", min: 1, max: 10 },
      { key: "symptoms_during", label: "Symptoms", type: "scale", min: 0, max: 10 },
    ],
  },
} as unknown as GainContract;

const logs: Logs = {
  ...EMPTY_LOGS,
  workouts: [
    { id: "w1", session_key: "A", started_at: "2026-08-01T07:00:00Z", status: "completed" },
    { id: "w2", session_key: "A", started_at: "2026-08-08T07:00:00Z", status: "completed" },
  ],
  set_logs: [{ id: "s1", workout_id: "w1", exercise_slug: "goblet-squat", set_no: 1 }],
  metric_values: [
    // Same key, different scope — must stay two series.
    { id: "m1", key: "rpe", ref: { scope: "set", set_log_id: "s1" }, value_num: 5 },
    { id: "m2", key: "rpe", ref: { scope: "session", workout_id: "w1" }, value_num: 9 },
    { id: "m3", key: "rpe", ref: { scope: "session", workout_id: "w2" }, value_num: 7 },
  ],
};

describe("numericMetricDefs", () => {
  it("returns only number/scale metrics, in scope order", () => {
    expect(
      numericMetricDefs(contract).map(
        (m: { scope: string; def: { key: string } }) => `${m.scope}:${m.def.key}`,
      ),
    ).toEqual(["set:rpe", "set:symptoms_during", "session:rpe", "session:symptoms_during"]);
  });
});

describe("numericMetricSeries", () => {
  it("keys on (scope, key) — a set-scope rpe value never appears in the session-scope series", () => {
    const series = numericMetricSeries(logs, "session", "rpe");
    expect(series).toEqual([
      { workoutId: "w1", startedAt: "2026-08-01T07:00:00Z", value: 9 },
      { workoutId: "w2", startedAt: "2026-08-08T07:00:00Z", value: 7 },
    ]);
  });

  it("resolves a set-scope value's workout through its set_log", () => {
    const series = numericMetricSeries(logs, "set", "rpe");
    expect(series).toEqual([{ workoutId: "w1", startedAt: "2026-08-01T07:00:00Z", value: 5 }]);
  });

  it("returns an empty array for a key with no values", () => {
    expect(numericMetricSeries(logs, "session", "not-declared")).toEqual([]);
  });
});

describe("hubMetricRows", () => {
  it("averages a set-scope metric per workout instead of stacking points on one date", () => {
    // numericMetricSeries stamps every value with its workout's started_at, so a metric
    // answered once per set returns several points sharing one x. Inlined on the hub that
    // renders as a vertical stack of dots and reads as a fault.
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        {
          id: "w1",
          session_key: "A",
          started_at: "2026-08-03T07:00:00Z",
          completed_at: "2026-08-03T07:40:00Z",
          status: "completed",
        },
      ],
      set_logs: [
        { id: "s1", workout_id: "w1", exercise_slug: "goblet-squat", set_no: 1, reps: 10 },
        { id: "s2", workout_id: "w1", exercise_slug: "goblet-squat", set_no: 2, reps: 10 },
      ],
      metric_values: [
        { id: "m1", key: "symptoms_during", ref: { scope: "set", set_log_id: "s1" }, value_num: 2 },
        { id: "m2", key: "symptoms_during", ref: { scope: "set", set_log_id: "s2" }, value_num: 4 },
      ],
    };
    const row = hubMetricRows(contract, logs).find(
      (r) => r.key === "symptoms_during" && r.scope === "set",
    );
    expect(row?.points).toHaveLength(1);
    expect(row?.points[0]?.y).toBe(3);
  });

  it("carries a scale metric's declared bounds so the chart cannot overstate it", () => {
    // symptoms_during is declared at BOTH set and session scope in the fixture, each a
    // 0-10 scale — which is exactly why rows key on (scope, key) and never the bare key.
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        {
          id: "w1",
          session_key: "A",
          started_at: "2026-08-03T07:00:00Z",
          completed_at: "2026-08-03T07:40:00Z",
          status: "completed",
        },
      ],
      metric_values: [
        {
          id: "m1",
          key: "symptoms_during",
          ref: { scope: "session", workout_id: "w1" },
          value_num: 3,
        },
      ],
    };
    const row = hubMetricRows(contract, logs).find(
      (r) => r.key === "symptoms_during" && r.scope === "session",
    );
    expect(row?.domain).toEqual([0, 10]);
  });

  it("omits a metric with nothing logged", () => {
    expect(hubMetricRows(contract, EMPTY_LOGS)).toEqual([]);
  });
});
