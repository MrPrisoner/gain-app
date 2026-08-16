import { describe, expect, it } from "vitest";
import { EMPTY_LOGS, type Logs } from "../../src/lib/logs/types";
import { sessionTypeStats } from "../../src/lib/progress/session-stats";

const logs: Logs = {
  ...EMPTY_LOGS,
  workouts: [
    {
      id: "w1",
      session_key: "A",
      started_at: "2026-08-01T07:00:00Z",
      completed_at: "2026-08-01T07:40:00Z",
      status: "completed",
    },
    {
      id: "w2",
      session_key: "A",
      started_at: "2026-08-08T07:00:00Z",
      completed_at: "2026-08-08T07:35:00Z",
      status: "partial",
    },
    // Still in progress — no completed_at — must not count toward the rate.
    { id: "w3", session_key: "A", started_at: "2026-08-15T07:00:00Z", status: "partial" },
    {
      id: "w4",
      session_key: "B",
      started_at: "2026-08-02T07:00:00Z",
      completed_at: "2026-08-02T07:45:00Z",
      status: "completed",
    },
  ],
  deviations: [
    { id: "d1", workout_id: "w1", exercise_slug: "goblet-squat", kind: "skip" },
    { id: "d2", workout_id: "w2", exercise_slug: "goblet-squat", kind: "drop_set" },
    { id: "d3", workout_id: "w4", exercise_slug: "goblet-squat", kind: "skip" },
  ],
};

describe("sessionTypeStats", () => {
  it("computes completion rate over finished workouts only", () => {
    const stats = sessionTypeStats(logs, "A");
    expect(stats.finishedCount).toBe(2);
    expect(stats.completionRate).toBeCloseTo(0.5);
  });

  it("counts deviations scoped to that session's workouts", () => {
    expect(sessionTypeStats(logs, "A").deviationCount).toBe(2);
  });

  it("computes duration in minutes from completed_at - started_at, finished workouts only", () => {
    const stats = sessionTypeStats(logs, "A");
    expect(stats.duration).toEqual([
      { workoutId: "w1", startedAt: "2026-08-01T07:00:00Z", minutes: 40 },
      { workoutId: "w2", startedAt: "2026-08-08T07:00:00Z", minutes: 35 },
    ]);
  });

  it("reports undefined completion rate with no finished workouts", () => {
    const stats = sessionTypeStats(logs, "C");
    expect(stats.completionRate).toBeUndefined();
    expect(stats.finishedCount).toBe(0);
  });

  it("scopes entirely to the given session key", () => {
    const stats = sessionTypeStats(logs, "B");
    expect(stats.finishedCount).toBe(1);
    expect(stats.deviationCount).toBe(1);
  });
});
