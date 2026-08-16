import { describe, expect, it } from "vitest";
import type { GainContract } from "../../src/lib/contract/schema";
import { EMPTY_LOGS, type Logs } from "../../src/lib/logs/types";
import { numericMetricDefs, numericMetricSeries } from "../../src/lib/progress/metric-series";

const contract = {
  metrics: {
    set: [{ key: "rpe", label: "Set RPE", type: "scale", min: 1, max: 10 }],
    session: [
      { key: "rpe", label: "Session RPE", type: "scale", min: 1, max: 10 },
      { key: "symptoms_during", label: "Symptoms", type: "text" },
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
    ).toEqual(["set:rpe", "session:rpe"]);
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
