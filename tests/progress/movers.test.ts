import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { EMPTY_LOGS, type Logs } from "../../src/lib/logs/types";
import { buildMovers } from "../../src/lib/progress/movers";

const source = readFileSync("fixtures/plans/home-training-v1.md", "utf8");
const parsed = parsePlanDocument(source);
if (!parsed.ok) throw new Error("fixture must parse");
const contract = parsed.contract;

function workout(id: string, sessionKey: string, day: string) {
  return {
    id,
    session_key: sessionKey,
    started_at: `${day}T07:00:00Z`,
    completed_at: `${day}T07:40:00Z`,
    status: "completed" as const,
  };
}

function set(id: string, workoutId: string, slug: string, reps: number, weightKg?: number) {
  return { id, workout_id: workoutId, exercise_slug: slug, set_no: 1, reps, weight_kg: weightKg };
}

describe("buildMovers", () => {
  it("gives a movement prescribed in two sessions one row, not two", () => {
    // goblet-squat is prescribed in both session A and session D of the fixture.
    // exercise-series keeps those apart for readiness; a mover is about the movement.
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        workout("w-a1", "A", "2026-08-03"),
        workout("w-d1", "D", "2026-08-07"),
        workout("w-a2", "A", "2026-08-10"),
      ],
      set_logs: [
        set("s1", "w-a1", "goblet-squat", 10, 6),
        set("s2", "w-d1", "goblet-squat", 13, 6),
        set("s3", "w-a2", "goblet-squat", 12, 8),
      ],
    };
    const rows = buildMovers(contract, logs, logs).filter((m) => m.exerciseSlug === "goblet-squat");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sessionCount).toBe(3);
  });

  it("computes the delta from the window's first session to its latest", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03"), workout("w2", "A", "2026-08-10")],
      set_logs: [set("s1", "w1", "goblet-squat", 10, 6), set("s2", "w2", "goblet-squat", 10, 9)],
    };
    const row = buildMovers(contract, logs, logs).find((m) => m.exerciseSlug === "goblet-squat");
    // 6 kg x 10 scores 8.0, 9 kg x 10 scores 12.0 — a 50% improvement.
    expect(row?.deltaPct).toBeCloseTo(0.5);
  });

  it("leaves a single-session movement without a delta rather than calling it 0%", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03")],
      set_logs: [set("s1", "w1", "goblet-squat", 10, 6)],
    };
    const row = buildMovers(contract, logs, logs).find((m) => m.exerciseSlug === "goblet-squat");
    expect(row?.deltaPct).toBeUndefined();
    expect(row?.sessionCount).toBe(1);
  });

  it("orders breakthrough-latest rows first, then improved, then the rest, each by recency", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        workout("w1", "A", "2026-08-03"),
        workout("w2", "A", "2026-08-10"),
        workout("w3", "A", "2026-08-17"),
      ],
      set_logs: [
        // goblet-squat improves and its latest session is a breakthrough.
        set("s1", "w1", "goblet-squat", 10, 6),
        set("s2", "w3", "goblet-squat", 10, 9),
        // db-floor-press improves, but its best session is not the latest.
        set("s3", "w1", "db-floor-press", 8, 10),
        set("s4", "w2", "db-floor-press", 8, 14),
        set("s5", "w3", "db-floor-press", 8, 12),
      ],
    };
    const order = buildMovers(contract, logs, logs)
      .filter((m) => ["goblet-squat", "db-floor-press"].includes(m.exerciseSlug))
      .map((m) => m.exerciseSlug);
    expect(order).toEqual(["goblet-squat", "db-floor-press"]);
  });

  it("never links to a session the movement is not prescribed in", () => {
    // reverse-crunch is prescribed in session D only. A set logged against it during a
    // session-A workout — a mid-session substitution — must not become the link target,
    // because the detail route 404s on an unprescribed (session, exercise) pair.
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w-d1", "D", "2026-08-07"), workout("w-a2", "A", "2026-08-10")],
      set_logs: [set("s1", "w-d1", "reverse-crunch", 10), set("s2", "w-a2", "reverse-crunch", 12)],
    };
    const row = buildMovers(contract, logs, logs).find((m) => m.exerciseSlug === "reverse-crunch");
    expect(row?.linkSessionKey).toBe("D");
    // And the substituted-in set does not inflate the row's session count.
    expect(row?.sessionCount).toBe(1);
  });

  it("plots one point per session, which is the same statement as the delta", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03"), workout("w2", "A", "2026-08-10")],
      set_logs: [set("s1", "w1", "goblet-squat", 10, 6), set("s2", "w2", "goblet-squat", 10, 9)],
    };
    const row = buildMovers(contract, logs, logs).find((m) => m.exerciseSlug === "goblet-squat");
    expect(row?.points).toHaveLength(2);
    expect(row?.points[0]?.y).toBeCloseTo(8);
    expect(row?.points[1]?.y).toBeCloseTo(12);
  });
});
