import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { EMPTY_LOGS, type Logs } from "../../src/lib/logs/types";
import type { ExerciseSeriesPoint } from "../../src/lib/progress/exercise-series";
import {
  doubleProgressionState,
  formatDoubleProgressionState,
  formatReadiness,
  readyOccurrences,
} from "../../src/lib/progress/double-progression";

const parsed = parsePlanDocument(readFileSync("fixtures/plans/home-training-v1.md", "utf8"));
if (!parsed.ok) throw new Error("fixture must parse");
const contract = parsed.contract;

const point = (startedAt: string, sets: ExerciseSeriesPoint["sets"]): ExerciseSeriesPoint => ({
  workoutId: startedAt,
  startedAt,
  sets,
});

const setOf = (set_no: number, reps: number, side?: "left" | "right") => ({
  id: `${set_no}-${side ?? "n"}`,
  workout_id: "w",
  exercise_slug: "goblet-squat",
  set_no,
  reps,
  side,
});

describe("doubleProgressionState", () => {
  it("reports no state for a scalar target — nothing to progress through", () => {
    expect(doubleProgressionState([], 10, 1, "reps", false)).toBeUndefined();
    expect(doubleProgressionState([], [10, 10], 1, "reps", false)).toBeUndefined();
  });

  it("reports no_data with no history", () => {
    const state = doubleProgressionState([], [8, 12], 3, "reps", false);
    expect(state?.none).toEqual({ status: "no_data" });
  });

  it("is ready when every prescribed set in the latest workout meets the range's top", () => {
    const series = [point("2026-08-01", [setOf(1, 12), setOf(2, 12)])];
    const state = doubleProgressionState(series, [8, 12], 2, "reps", false);
    expect(state?.none).toEqual({ status: "ready", latest: [12, 12] });
  });

  it("is in_progress when fewer sets were logged than prescribed, however good they were", () => {
    // One set at the top of the range out of a prescribed three is not a session at the
    // top of the range — and this verdict reaches the reviewing AI through summary.ts.
    const series = [point("2026-08-01", [setOf(1, 12)])];
    const state = doubleProgressionState(series, [8, 12], 3, "reps", false);
    expect(state?.none).toEqual({ status: "in_progress", latest: [12] });
  });

  it("takes a ranged prescription's LOWER bound as the requirement", () => {
    // The fixture's session-D goblet squat is `sets: [2, 3]` — two sets is work the plan
    // itself sanctions, so two at the top of the range is ready. Requiring three would
    // leave a user who reliably does two reading "in progress" forever.
    const series = [point("2026-08-01", [setOf(1, 15), setOf(2, 15)])];
    const state = doubleProgressionState(series, [12, 15], [2, 3], "reps", false);
    expect(state?.none).toEqual({ status: "ready", latest: [15, 15] });
  });

  it("is in_progress when the worked example (12/11/11) falls short of the top", () => {
    const series = [point("2026-08-01", [setOf(1, 12), setOf(2, 11), setOf(3, 11)])];
    const state = doubleProgressionState(series, [8, 12], 3, "reps", false);
    expect(state?.none).toEqual({ status: "in_progress", latest: [12, 11, 11] });
  });

  it("reads only the most recent workout, not history before it", () => {
    const series = [point("2026-08-01", [setOf(1, 8)]), point("2026-08-08", [setOf(1, 12)])];
    const state = doubleProgressionState(series, [8, 12], 1, "reps", false);
    expect(state?.none).toEqual({ status: "ready", latest: [12] });
  });

  it("evaluates each side independently for a per_side exercise", () => {
    const series = [point("2026-08-01", [setOf(1, 12, "left"), setOf(1, 9, "right")])];
    const state = doubleProgressionState(series, [8, 12], 1, "reps", true);
    expect(state?.left).toEqual({ status: "ready", latest: [12] });
    expect(state?.right).toEqual({ status: "in_progress", latest: [9] });
  });

  it("reads duration for a type: time exercise", () => {
    const series = [point("2026-08-01", [{ ...setOf(1, 0), reps: undefined, duration_s: 40 }])];
    const state = doubleProgressionState(series, [20, 40], 1, "time", false);
    expect(state?.none).toEqual({ status: "ready", latest: [40] });
  });
});

describe("readyOccurrences", () => {
  const workout = (id: string, sessionKey: string, day: string) => ({
    id,
    session_key: sessionKey,
    started_at: `${day}T07:00:00Z`,
    completed_at: `${day}T07:40:00Z`,
    status: "completed" as const,
  });
  const logged = (id: string, workoutId: string, slug: string, setNo: number, reps: number) => ({
    id,
    workout_id: workoutId,
    exercise_slug: slug,
    set_no: setNo,
    reps,
  });

  it("names the occurrence and carries the state the list renders from", () => {
    // Session A prescribes goblet-squat as `sets: 3, reps: [8, 12]`.
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03")],
      set_logs: [
        logged("s1", "w1", "goblet-squat", 1, 12),
        logged("s2", "w1", "goblet-squat", 2, 12),
        logged("s3", "w1", "goblet-squat", 3, 12),
      ],
    };
    const ready = readyOccurrences(contract, logs);
    const squat = ready.find((r) => r.occurrence.exerciseSlug === "goblet-squat");
    expect(squat?.occurrence.sessionKey).toBe("A");
    expect(formatReadiness(squat?.state, "–")).toBe("12/12/12 — ready for a load increase");
  });

  it("finds nothing in an empty log rather than reporting every occurrence ready", () => {
    expect(readyOccurrences(contract, EMPTY_LOGS)).toEqual([]);
  });

  it("keeps the same occurrence in another session out of the list", () => {
    // goblet-squat is prescribed in session A ([8,12]) and session D ([12,15]). Three sets
    // of 12 in session A earns a load increase there and does not touch session D, whose
    // range tops out at 15 — one row, not two.
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03"), workout("w2", "D", "2026-08-07")],
      set_logs: [
        logged("s1", "w1", "goblet-squat", 1, 12),
        logged("s2", "w1", "goblet-squat", 2, 12),
        logged("s3", "w1", "goblet-squat", 3, 12),
        logged("s4", "w2", "goblet-squat", 1, 12),
        logged("s5", "w2", "goblet-squat", 2, 12),
      ],
    };
    const squats = readyOccurrences(contract, logs).filter(
      (r) => r.occurrence.exerciseSlug === "goblet-squat",
    );
    expect(squats.map((r) => r.occurrence.sessionKey)).toEqual(["A"]);
  });
});

describe("formatDoubleProgressionState", () => {
  it("formats no history", () => {
    expect(formatDoubleProgressionState({ status: "no_data" })).toBe("No history yet");
  });

  it("formats an in-progress state with its raw numbers", () => {
    expect(formatDoubleProgressionState({ status: "in_progress", latest: [12, 11, 11] })).toBe(
      "12/11/11 — in progress",
    );
  });

  it("formats a ready state", () => {
    expect(formatDoubleProgressionState({ status: "ready", latest: [12, 12] })).toBe(
      "12/12 — ready for a load increase",
    );
  });
});

describe("formatReadiness", () => {
  it("returns the caller's no-range text when there is no state at all", () => {
    expect(formatReadiness(undefined, "–")).toBe("–");
  });

  it("renders a single-sided state as one sentence", () => {
    expect(formatReadiness({ none: { status: "ready", latest: [12] } }, "–")).toBe(
      "12 — ready for a load increase",
    );
  });

  it("renders both sides of a per_side state", () => {
    expect(
      formatReadiness(
        { left: { status: "ready", latest: [12] }, right: { status: "in_progress", latest: [9] } },
        "–",
      ),
    ).toBe("L: 12 — ready for a load increase · R: 9 — in progress");
  });
});
