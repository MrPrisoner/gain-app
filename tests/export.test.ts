/**
 * Export generator unit tests — windowing, CSV mechanics, determinism.
 * The full bundle shape is covered by the golden test.
 */

import { describe, expect, it } from "vitest";

import { filterLogsToWindow, weeksElapsed } from "../src/lib/export/bundle";
import { csvEscape, formatNum, toCsv } from "../src/lib/export/csv";
import type { Logs } from "../src/lib/logs/types";

describe("csv", () => {
  it("escapes commas, quotes and newlines", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line\nbreak")).toBe('"line\nbreak"');
  });

  it("renders header and rows with a trailing newline", () => {
    expect(toCsv(["a", "b"], [["1", "2"]])).toBe("a,b\n1,2\n");
  });

  it("formats numbers without floating-point noise", () => {
    expect(formatNum(6)).toBe("6");
    expect(formatNum(6.5)).toBe("6.5");
    expect(formatNum(0.1 + 0.2)).toBe("0.3");
  });
});

describe("windowing", () => {
  const logs: Logs = {
    workouts: [
      { id: "w1", session_key: "A", started_at: "2026-08-01T07:00:00Z", status: "completed" },
      { id: "w2", session_key: "B", started_at: "2026-08-15T07:00:00Z", status: "completed" },
      { id: "w3", session_key: "A", started_at: "2026-09-15T07:00:00Z", status: "completed" },
    ],
    set_logs: [
      { id: "s1", workout_id: "w1", exercise_slug: "goblet-squat", set_no: 1, reps: 8 },
      { id: "s2", workout_id: "w2", exercise_slug: "goblet-squat", set_no: 1, reps: 10 },
      { id: "s3", workout_id: "w3", exercise_slug: "goblet-squat", set_no: 1, reps: 12 },
    ],
    metric_values: [
      { id: "m1", key: "energy", ref: { scope: "session", workout_id: "w1" }, value_num: 7 },
      { id: "m2", key: "energy", ref: { scope: "session", workout_id: "w3" }, value_num: 6 },
      { id: "m3", key: "feel", ref: { scope: "set", set_log_id: "s2" }, value_num: 3 },
    ],
    deviations: [{ id: "d1", workout_id: "w3", exercise_slug: "goblet-squat", kind: "skip" }],
    activities: [
      { id: "a1", kind: "squash", occurred_at: "2026-08-20T18:00:00Z" },
      { id: "a2", kind: "squash", occurred_at: "2026-10-01T18:00:00Z" },
    ],
  };

  it("filters workouts and everything that follows them", () => {
    const windowed = filterLogsToWindow(logs, {
      label: "August",
      start: "2026-08-01T00:00:00Z",
      end: "2026-08-31T23:59:59Z",
    });

    expect(windowed.workouts.map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(windowed.set_logs.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(windowed.metric_values.map((m) => m.id)).toEqual(["m1", "m3"]);
    expect(windowed.deviations).toHaveLength(0);
    expect(windowed.activities.map((a) => a.id)).toEqual(["a1"]);
  });

  it("treats omitted bounds as full history", () => {
    const windowed = filterLogsToWindow(logs, { label: "full history" });
    expect(windowed.workouts).toHaveLength(3);
    expect(windowed.activities).toHaveLength(2);
  });
});

describe("weeksElapsed", () => {
  it("is 0 with no workouts", () => {
    const empty: Logs = {
      workouts: [],
      set_logs: [],
      metric_values: [],
      deviations: [],
      activities: [],
    };
    expect(weeksElapsed(empty, new Date("2026-09-01T00:00:00Z"))).toBe(0);
  });

  it("counts whole weeks since the first workout", () => {
    const logs: Logs = {
      workouts: [
        { id: "w1", session_key: "A", started_at: "2026-08-01T07:00:00Z", status: "completed" },
        { id: "w2", session_key: "B", started_at: "2026-08-20T07:00:00Z", status: "completed" },
      ],
      set_logs: [],
      metric_values: [],
      deviations: [],
      activities: [],
    };
    // 29 days after the first workout → 4 whole weeks.
    expect(weeksElapsed(logs, new Date("2026-08-30T07:00:00Z"))).toBe(4);
  });
});
