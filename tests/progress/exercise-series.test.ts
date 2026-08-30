import { describe, expect, it } from "vitest";
import type { GainContract } from "../../src/lib/contract/schema";
import { EMPTY_LOGS, type Logs } from "../../src/lib/logs/types";
import {
  buildExerciseSeries,
  difficultyDistribution,
  exerciseOccurrences,
  topSetChartPoints,
  topSetPoints,
  volumePoints,
} from "../../src/lib/progress/exercise-series";

// Goblet squat prescribed in two sessions with two different rep ranges — the exact
// scenario that rules out keying on a bare exercise_slug.
const contract = {
  schema_version: 1,
  plan: { slug: "p", name: "P", version: 1, based_on_version: null },
  loads: [],
  exercises: [{ id: "goblet-squat" }, { id: "side-plank" }],
  sessions: [
    {
      key: "A",
      name: "Session A",
      order: 1,
      blocks: [
        {
          key: "main",
          name: "Main",
          exercises: [{ id: "goblet-squat", sets: 3, reps: [8, 12] }],
        },
      ],
    },
    {
      key: "D",
      name: "Session D",
      order: 2,
      blocks: [
        {
          key: "warmup",
          name: "Warm-up",
          tracking: "checkoff",
          exercises: [{ id: "goblet-squat", reps: 8 }],
        },
        {
          key: "main",
          name: "Main",
          exercises: [{ id: "goblet-squat", sets: 2, reps: [12, 15] }],
        },
      ],
    },
  ],
} as unknown as GainContract;

const logs: Logs = {
  ...EMPTY_LOGS,
  workouts: [
    { id: "w1", session_key: "A", started_at: "2026-08-01T07:00:00Z", status: "completed" },
    { id: "w2", session_key: "A", started_at: "2026-08-08T07:00:00Z", status: "completed" },
    { id: "w3", session_key: "D", started_at: "2026-08-03T07:00:00Z", status: "completed" },
  ],
  set_logs: [
    { id: "s1", workout_id: "w1", exercise_slug: "goblet-squat", set_no: 1, reps: 8, weight_kg: 6 },
    { id: "s2", workout_id: "w1", exercise_slug: "goblet-squat", set_no: 2, reps: 8, weight_kg: 6 },
    {
      id: "s3",
      workout_id: "w2",
      exercise_slug: "goblet-squat",
      set_no: 1,
      reps: 12,
      weight_kg: 6,
      difficulty: "medium",
    },
    {
      id: "s4",
      workout_id: "w2",
      exercise_slug: "goblet-squat",
      set_no: 2,
      reps: 12,
      weight_kg: 6,
      difficulty: "hard",
    },
    // Session D's own history — must not appear in session A's series.
    {
      id: "s5",
      workout_id: "w3",
      exercise_slug: "goblet-squat",
      set_no: 1,
      reps: 12,
      weight_kg: 8,
    },
  ],
};

describe("buildExerciseSeries", () => {
  it("groups by (session_key, exercise_slug), chronologically", () => {
    const series = buildExerciseSeries(logs, "A", "goblet-squat");
    expect(series.map((p) => p.workoutId)).toEqual(["w1", "w2"]);
    expect(series[0]!.sets).toHaveLength(2);
  });

  it("excludes another session's history for the same exercise", () => {
    const series = buildExerciseSeries(logs, "A", "goblet-squat");
    expect(series.some((p) => p.workoutId === "w3")).toBe(false);
  });

  it("returns an empty array for an exercise never logged in that session", () => {
    expect(buildExerciseSeries(logs, "A", "side-plank")).toEqual([]);
  });
});

describe("exerciseOccurrences", () => {
  it("lists one occurrence per (session, exercise) pair, catalogue order then session order", () => {
    const occurrences = exerciseOccurrences(contract);
    expect(occurrences.map((o) => `${o.exerciseSlug}:${o.sessionKey}`)).toEqual([
      "goblet-squat:A",
      "goblet-squat:D",
    ]);
  });

  it("skips a checkoff-tracked occurrence in favour of a full-tracking one in the same session", () => {
    // goblet-squat appears in D's warmup (checkoff) AND D's main (full) — main wins.
    const occurrence = exerciseOccurrences(contract).find((o) => o.sessionKey === "D");
    expect(occurrence?.resolved.reps).toEqual([12, 15]);
  });

  it("omits an exercise never prescribed anywhere", () => {
    const occurrences = exerciseOccurrences(contract);
    expect(occurrences.some((o) => o.exerciseSlug === "side-plank")).toBe(false);
  });
});

describe("topSetPoints", () => {
  it("picks the heaviest set per workout and its reps", () => {
    const series = buildExerciseSeries(logs, "A", "goblet-squat");
    expect(topSetPoints(series, undefined)).toEqual([
      { startedAt: "2026-08-01T07:00:00Z", weightKg: 6, reps: 8, durationS: undefined },
      { startedAt: "2026-08-08T07:00:00Z", weightKg: 6, reps: 12, durationS: undefined },
    ]);
  });
});

describe("topSetChartPoints", () => {
  it("plots the load and labels the reps when the movement carries a load", () => {
    const series = buildExerciseSeries(logs, "A", "goblet-squat");
    expect(topSetChartPoints(series, undefined, "reps")).toEqual({
      plots: "load",
      unit: "kg",
      points: [
        { startedAt: "2026-08-01T07:00:00Z", value: 6, label: "8" },
        { startedAt: "2026-08-08T07:00:00Z", value: 6, label: "12" },
      ],
    });
  });

  it("plots the reps themselves for a bodyweight movement — a flat zero-load line says nothing", () => {
    const bodyweight: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        { id: "w1", session_key: "A", started_at: "2026-08-01T07:00:00Z", status: "completed" },
      ],
      set_logs: [
        { id: "s1", workout_id: "w1", exercise_slug: "dead-bug", set_no: 1, reps: 14 },
        { id: "s2", workout_id: "w1", exercise_slug: "dead-bug", set_no: 2, reps: 16 },
      ],
    };
    const series = buildExerciseSeries(bodyweight, "A", "dead-bug");
    expect(topSetChartPoints(series, undefined, "reps")).toEqual({
      plots: "effort",
      unit: "reps",
      points: [{ startedAt: "2026-08-01T07:00:00Z", value: 16, label: undefined }],
    });
  });

  it("skips a workout with no load rather than plotting it as 0 kg, for a movement logged both loaded and bodyweight", () => {
    const mixed: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        { id: "w1", session_key: "A", started_at: "2026-08-01T07:00:00Z", status: "completed" },
        { id: "w2", session_key: "A", started_at: "2026-08-08T07:00:00Z", status: "completed" },
        { id: "w3", session_key: "A", started_at: "2026-08-15T07:00:00Z", status: "completed" },
      ],
      set_logs: [
        {
          id: "s1",
          workout_id: "w1",
          exercise_slug: "goblet-squat",
          set_no: 1,
          weight_kg: 6,
          reps: 8,
        },
        // A bodyweight-only session for the same movement — no weight_kg logged at all.
        { id: "s2", workout_id: "w2", exercise_slug: "goblet-squat", set_no: 1, reps: 10 },
        {
          id: "s3",
          workout_id: "w3",
          exercise_slug: "goblet-squat",
          set_no: 1,
          weight_kg: 8,
          reps: 6,
        },
      ],
    };
    const series = buildExerciseSeries(mixed, "A", "goblet-squat");
    expect(topSetChartPoints(series, undefined, "reps")).toEqual({
      plots: "load",
      unit: "kg",
      points: [
        { startedAt: "2026-08-01T07:00:00Z", value: 6, label: "8" },
        { startedAt: "2026-08-15T07:00:00Z", value: 8, label: "6" },
      ],
    });
  });

  it("plots seconds for a timed bodyweight movement", () => {
    const timed: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        { id: "w1", session_key: "A", started_at: "2026-08-01T07:00:00Z", status: "completed" },
      ],
      set_logs: [
        { id: "s1", workout_id: "w1", exercise_slug: "side-plank", set_no: 1, duration_s: 30 },
      ],
    };
    const series = buildExerciseSeries(timed, "A", "side-plank");
    expect(topSetChartPoints(series, undefined, "time")).toEqual({
      plots: "effort",
      unit: "s",
      points: [{ startedAt: "2026-08-01T07:00:00Z", value: 30, label: undefined }],
    });
  });
});

describe("volumePoints", () => {
  it("sums weight_kg x reps across every set in a workout", () => {
    const series = buildExerciseSeries(logs, "A", "goblet-squat");
    // w1: 8*6 + 8*6 = 96. w2: 12*6 + 12*6 = 144.
    expect(volumePoints(series, undefined)).toEqual([
      { startedAt: "2026-08-01T07:00:00Z", volumeKg: 96 },
      { startedAt: "2026-08-08T07:00:00Z", volumeKg: 144 },
    ]);
  });
});

describe("difficultyDistribution", () => {
  it("counts difficulty across every set in the series", () => {
    const series = buildExerciseSeries(logs, "A", "goblet-squat");
    expect(difficultyDistribution(series, undefined)).toEqual({ easy: 0, medium: 1, hard: 1 });
  });
});
