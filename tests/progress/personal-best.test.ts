import { describe, expect, it } from "vitest";
import type { ExerciseSeriesPoint } from "../../src/lib/progress/exercise-series";
import {
  bestSetsBySession,
  breakthroughs,
  formatScore,
  scoreKindFor,
} from "../../src/lib/progress/personal-best";

function session(
  id: string,
  startedAt: string,
  sets: ExerciseSeriesPoint["sets"],
): ExerciseSeriesPoint {
  return { workoutId: id, startedAt, sets };
}

describe("scoreKindFor", () => {
  it("picks e1rm for a loaded rep movement and reps for a bodyweight one", () => {
    const loaded = [
      session("w1", "2026-08-01T07:00:00Z", [
        { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, reps: 10, weight_kg: 6 },
      ]),
    ];
    const bodyweight = [
      session("w1", "2026-08-01T07:00:00Z", [
        { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, reps: 10 },
      ]),
    ];
    expect(scoreKindFor(loaded, "reps")).toBe("e1rm");
    expect(scoreKindFor(bodyweight, "reps")).toBe("reps");
  });

  it("picks loaded_hold for a loaded timed movement and seconds for a bodyweight one", () => {
    const loaded = [
      session("w1", "2026-08-01T07:00:00Z", [
        { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, duration_s: 30, weight_kg: 4 },
      ]),
    ];
    const bodyweight = [
      session("w1", "2026-08-01T07:00:00Z", [
        { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, duration_s: 30 },
      ]),
    ];
    expect(scoreKindFor(loaded, "time")).toBe("loaded_hold");
    expect(scoreKindFor(bodyweight, "time")).toBe("seconds");
  });

  it("decides once for the whole series, so one bodyweight session cannot switch the unit", () => {
    const mixed = [
      session("w1", "2026-08-01T07:00:00Z", [
        { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, reps: 10, weight_kg: 6 },
      ]),
      session("w2", "2026-08-08T07:00:00Z", [
        { id: "b", workout_id: "w2", exercise_slug: "x", set_no: 1, reps: 14 },
      ]),
    ];
    expect(scoreKindFor(mixed, "reps")).toBe("e1rm");
  });
});

describe("bestSetsBySession", () => {
  it("caps reps at 12 inside the Epley estimate", () => {
    // Uncapped, 6 kg x 20 would score 10.0 and beat 8 kg x 8 (10.13) only just; at
    // reps far above the formula's fitted range it would sail past genuinely heavier
    // work. Capped, 6 kg x 20 scores as 6 kg x 12 = 8.4.
    const series = [
      session("w1", "2026-08-01T07:00:00Z", [
        { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, reps: 20, weight_kg: 6 },
      ]),
    ];
    expect(bestSetsBySession(series, "e1rm")[0]?.score).toBeCloseTo(8.4);
  });

  it("scores a loaded hold as weight x seconds, so a longer hold at one load counts", () => {
    const series = [
      session("w1", "2026-08-01T07:00:00Z", [
        { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, duration_s: 30, weight_kg: 8 },
      ]),
      session("w2", "2026-08-08T07:00:00Z", [
        { id: "b", workout_id: "w2", exercise_slug: "x", set_no: 1, duration_s: 45, weight_kg: 8 },
      ]),
    ];
    const scores = bestSetsBySession(series, "loaded_hold").map((b) => b.score);
    expect(scores).toEqual([240, 360]);
  });

  it("takes the best set of each session and skips sessions with nothing scoreable", () => {
    const series = [
      session("w1", "2026-08-01T07:00:00Z", [
        { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, reps: 8 },
        { id: "b", workout_id: "w1", exercise_slug: "x", set_no: 2, reps: 11 },
      ]),
      session("w2", "2026-08-08T07:00:00Z", [
        { id: "c", workout_id: "w2", exercise_slug: "x", set_no: 1, duration_s: 40 },
      ]),
    ];
    expect(bestSetsBySession(series, "reps").map((b) => b.score)).toEqual([11]);
  });

  it("honours a filter, which is how a per-side movement is scored per side", () => {
    const series = [
      session("w1", "2026-08-01T07:00:00Z", [
        { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, side: "left", reps: 9 },
        { id: "b", workout_id: "w1", exercise_slug: "x", set_no: 1, side: "right", reps: 12 },
      ]),
    ];
    expect(bestSetsBySession(series, "reps", (s) => s.side === "left")[0]?.score).toBe(9);
  });
});

describe("breakthroughs", () => {
  const rising = [
    session("w1", "2026-08-01T07:00:00Z", [
      { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, reps: 10 },
    ]),
    session("w2", "2026-08-08T07:00:00Z", [
      { id: "b", workout_id: "w2", exercise_slug: "x", set_no: 1, reps: 12 },
    ]),
    session("w3", "2026-08-15T07:00:00Z", [
      { id: "c", workout_id: "w3", exercise_slug: "x", set_no: 1, reps: 11 },
    ]),
    session("w4", "2026-08-22T07:00:00Z", [
      { id: "d", workout_id: "w4", exercise_slug: "x", set_no: 1, reps: 13 },
    ]),
  ];

  it("reports a session that beats every session before it", () => {
    expect(breakthroughs(rising, "x", "reps", false).map((b) => b.at.workoutId)).toEqual([
      "w2",
      "w4",
    ]);
  });

  it("treats the first logged session as a baseline, never a breakthrough", () => {
    const single = [rising[0]!];
    expect(breakthroughs(single, "x", "reps", false)).toEqual([]);
  });

  it("carries the best that stood before it, for a was-this line", () => {
    const first = breakthroughs(rising, "x", "reps", false)[0];
    expect(first?.previous.score).toBe(10);
  });

  it("scores each side of a per-side movement separately", () => {
    const perSide = [
      session("w1", "2026-08-01T07:00:00Z", [
        { id: "a", workout_id: "w1", exercise_slug: "x", set_no: 1, side: "left", reps: 8 },
        { id: "b", workout_id: "w1", exercise_slug: "x", set_no: 1, side: "right", reps: 8 },
      ]),
      session("w2", "2026-08-08T07:00:00Z", [
        { id: "c", workout_id: "w2", exercise_slug: "x", set_no: 1, side: "left", reps: 10 },
        { id: "d", workout_id: "w2", exercise_slug: "x", set_no: 1, side: "right", reps: 8 },
      ]),
    ];
    const found = breakthroughs(perSide, "x", "reps", true);
    expect(found.map((b) => b.side)).toEqual(["left"]);
  });
});

describe("formatScore", () => {
  it("renders each kind in the unit the user logged", () => {
    expect(
      formatScore({
        score: 8.4,
        kind: "e1rm",
        weightKg: 6,
        reps: 12,
        workoutId: "w1",
        startedAt: "2026-08-01T07:00:00Z",
      }),
    ).toBe("6 kg × 12");
    expect(
      formatScore({
        score: 360,
        kind: "loaded_hold",
        weightKg: 8,
        durationS: 45,
        workoutId: "w1",
        startedAt: "2026-08-01T07:00:00Z",
      }),
    ).toBe("8 kg × 45s");
    expect(
      formatScore({
        score: 12,
        kind: "reps",
        reps: 12,
        workoutId: "w1",
        startedAt: "2026-08-01T07:00:00Z",
      }),
    ).toBe("12 reps");
    expect(
      formatScore({
        score: 45,
        kind: "seconds",
        durationS: 45,
        workoutId: "w1",
        startedAt: "2026-08-01T07:00:00Z",
      }),
    ).toBe("45s");
  });
});
