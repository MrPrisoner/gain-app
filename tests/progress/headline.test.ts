import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { EMPTY_LOGS, type Logs } from "../../src/lib/logs/types";
import { buildHeadline } from "../../src/lib/progress/headline";

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

function set(
  id: string,
  workoutId: string,
  slug: string,
  reps: number,
  weightKg?: number,
  side?: "left" | "right",
) {
  return {
    id,
    workout_id: workoutId,
    exercise_slug: slug,
    set_no: 1,
    reps,
    weight_kg: weightKg,
    side,
  };
}

describe("buildHeadline", () => {
  it("counts a new best only when it beats every session before it", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03"), workout("w2", "A", "2026-08-10")],
      set_logs: [set("s1", "w1", "goblet-squat", 10, 6), set("s2", "w2", "goblet-squat", 10, 9)],
    };
    expect(buildHeadline(contract, logs, logs, undefined).newBests).toBe(1);
  });

  it("does not count the first ever session as a new best", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03")],
      set_logs: [set("s1", "w1", "goblet-squat", 10, 6)],
    };
    expect(buildHeadline(contract, logs, logs, undefined).newBests).toBe(0);
  });

  it("counts movements, not breakthroughs, so a per-side best cannot report two", () => {
    // split-squat is per_side in the fixture and is prescribed in session C (not D —
    // verified against fixtures/plans/home-training-v1.md, which is why the session key
    // matters: buildPrescribedSeries drops workouts of any other session type).
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "C", "2026-08-03"), workout("w2", "C", "2026-08-10")],
      set_logs: [
        set("s1", "w1", "split-squat", 8, 6, "left"),
        set("s2", "w1", "split-squat", 8, 6, "right"),
        set("s3", "w2", "split-squat", 10, 6, "left"),
        set("s4", "w2", "split-squat", 10, 6, "right"),
      ],
    };
    expect(buildHeadline(contract, logs, logs, undefined).newBests).toBe(1);
  });

  it("keeps a breakthrough outside the window out of the count", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03"), workout("w2", "A", "2026-08-10")],
      set_logs: [set("s1", "w1", "goblet-squat", 10, 6), set("s2", "w2", "goblet-squat", 10, 9)],
    };
    expect(buildHeadline(contract, logs, logs, "2026-08-20T00:00:00Z").newBests).toBe(0);
  });

  it("states improvement as a fraction whose denominator excludes single-session work", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03"), workout("w2", "A", "2026-08-10")],
      set_logs: [
        // Improved across two sessions.
        set("s1", "w1", "goblet-squat", 10, 6),
        set("s2", "w2", "goblet-squat", 10, 9),
        // Went backwards across two sessions.
        set("s3", "w1", "db-floor-press", 8, 14),
        set("s4", "w2", "db-floor-press", 8, 10),
        // Logged once — neither improved nor unimproved, and in neither number.
        set("s5", "w1", "prone-row", 10, 8),
      ],
    };
    const headline = buildHeadline(contract, logs, logs, undefined);
    expect(headline.improved).toEqual({ count: 1, comparable: 2 });
  });

  it("counts a movement sitting at the top of its range for every prescribed set", () => {
    // Session A prescribes goblet-squat as `sets: 3, reps: [8, 12]`, so three sets at 12
    // is exactly `doubleProgressionState`'s ready condition: the latest workout carried at
    // least the prescribed set count and every set met the range's top. Readiness reads
    // full history rather than the window, which is why `windowStart` is irrelevant here.
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03")],
      set_logs: [
        { ...set("s1", "w1", "goblet-squat", 12, 8), set_no: 1 },
        { ...set("s2", "w1", "goblet-squat", 12, 8), set_no: 2 },
        { ...set("s3", "w1", "goblet-squat", 12, 8), set_no: 3 },
      ],
    };
    expect(buildHeadline(contract, logs, logs, undefined).readyToIncrease).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("does not count a movement short of its prescribed set count as ready", () => {
    // Two sets at the top of a three-set prescription is not a session that earned more
    // load — the guard `double-progression.ts` calls load-bearing rather than pedantry.
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [workout("w1", "A", "2026-08-03")],
      set_logs: [
        { ...set("s1", "w1", "goblet-squat", 12, 8), set_no: 1 },
        { ...set("s2", "w1", "goblet-squat", 12, 8), set_no: 2 },
      ],
    };
    expect(buildHeadline(contract, logs, logs, undefined).readyToIncrease).toBe(0);
  });

  it("reports nothing comparable rather than dividing by zero on an empty window", () => {
    const headline = buildHeadline(contract, EMPTY_LOGS, EMPTY_LOGS, undefined);
    expect(headline).toEqual({
      newBests: 0,
      readyToIncrease: 0,
      improved: { count: 0, comparable: 0 },
    });
  });
});
