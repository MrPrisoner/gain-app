import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { EMPTY_LOGS, type Logs, type Workout } from "../../src/lib/logs/types";
import { MAX_WEEK_BUCKETS, buildConsistency } from "../../src/lib/progress/consistency";

const source = readFileSync("fixtures/plans/home-training-v1.md", "utf8");
const parsed = parsePlanDocument(source);
if (!parsed.ok) throw new Error("fixture must parse");
const contract = parsed.contract;

function finished(id: string, sessionKey: string, day: string): Workout {
  return {
    id,
    session_key: sessionKey,
    started_at: `${day}T07:00:00Z`,
    completed_at: `${day}T07:40:00Z`,
    status: "completed",
  };
}

// 2026-08-03, 2026-08-10, 2026-08-17, 2026-08-24 are Mondays.
const NOW = new Date("2026-08-26T09:00:00Z");

describe("buildConsistency", () => {
  it("buckets finished workouts into Monday-start UTC weeks", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        finished("w1", "A", "2026-08-03"),
        finished("w2", "B", "2026-08-06"),
        finished("w3", "A", "2026-08-10"),
      ],
    };
    const c = buildConsistency(contract, logs, logs, NOW);
    expect(c.weeks.find((w) => w.weekStart === "2026-08-03")?.count).toBe(2);
    expect(c.weeks.find((w) => w.weekStart === "2026-08-10")?.count).toBe(1);
  });

  it("keeps empty weeks in the strip rather than compressing the gap away", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [finished("w1", "A", "2026-08-03"), finished("w2", "A", "2026-08-17")],
    };
    const c = buildConsistency(contract, logs, logs, NOW);
    expect(c.weeks.map((w) => w.weekStart)).toEqual([
      "2026-08-03",
      "2026-08-10",
      "2026-08-17",
      "2026-08-24",
    ]);
    expect(c.weeks[1]?.count).toBe(0);
  });

  it("counts a red-flag stop as showing up", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        { ...finished("w1", "A", "2026-08-03"), status: "stopped" },
        // Still open — no completed_at — counts towards nothing.
        { id: "w2", session_key: "A", started_at: "2026-08-04T07:00:00Z", status: "partial" },
      ],
    };
    expect(buildConsistency(contract, logs, logs, NOW).sessionCount).toBe(1);
  });

  it("measures the streak to the last completed week when this week is still empty", () => {
    // NOW is Wednesday 2026-08-26 and nothing is logged in that week yet. Without this
    // rule, opening the app on a Monday morning reads "streak: 0".
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        finished("w1", "A", "2026-08-10"),
        finished("w2", "A", "2026-08-17"),
        finished("w3", "A", "2026-08-24"),
      ],
    };
    expect(buildConsistency(contract, logs, logs, NOW).streakWeeks).toBe(3);
  });

  it("breaks the streak on a missed week", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [finished("w1", "A", "2026-08-03"), finished("w2", "A", "2026-08-24")],
    };
    expect(buildConsistency(contract, logs, logs, NOW).streakWeeks).toBe(1);
  });

  it("computes the streak over full history, not the window", () => {
    const full: Logs = {
      ...EMPTY_LOGS,
      workouts: [
        finished("w1", "A", "2026-08-03"),
        finished("w2", "A", "2026-08-10"),
        finished("w3", "A", "2026-08-17"),
        finished("w4", "A", "2026-08-24"),
      ],
    };
    const windowed: Logs = { ...EMPTY_LOGS, workouts: full.workouts.slice(2) };
    // A streak is a fact about the user, not about the selected span — windowing it to
    // two weeks would report a four-week streak as two.
    expect(buildConsistency(contract, windowed, full, NOW).streakWeeks).toBe(4);
  });

  it("caps the strip at the most recent buckets rather than handing over an unbounded run", () => {
    // Two years of weekly training on the `All` window. Past roughly 70 buckets the bar
    // chart's own arithmetic runs out of width (chart-geometry.test.ts holds the floor
    // under that); long before then the strip stops saying anything, so it is trimmed to
    // its most recent weeks here.
    const workouts = Array.from({ length: 104 }, (_, i) =>
      finished(
        `w${i}`,
        "A",
        new Date(Date.UTC(2024, 7, 26) + i * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      ),
    );
    const logs: Logs = { ...EMPTY_LOGS, workouts };
    const c = buildConsistency(contract, logs, logs, NOW);
    expect(c.weeks).toHaveLength(MAX_WEEK_BUCKETS);
    // The trim takes the tail, so the strip ends on the current week and its weeks stay
    // contiguous — never thinned, which would silently redefine what a bar means.
    expect(c.weeks.at(-1)?.weekStart).toBe("2026-08-24");
    expect(c.weeks[0]?.weekStart).toBe("2026-03-02");
    // And the numbers beside the strip still read the whole log rather than the trim.
    expect(c.sessionCount).toBe(104);
    expect(c.streakWeeks).toBe(104);
  });

  it("breaks down finished workouts and deviations per session type", () => {
    const logs: Logs = {
      ...EMPTY_LOGS,
      workouts: [finished("w1", "A", "2026-08-03"), finished("w2", "B", "2026-08-04")],
      deviations: [{ id: "d1", workout_id: "w1", exercise_slug: "goblet-squat", kind: "skip" }],
    };
    const c = buildConsistency(contract, logs, logs, NOW);
    const a = c.bySessionType.find((s) => s.key === "A");
    expect(a?.finished).toBe(1);
    expect(a?.deviations).toBe(1);
    expect(c.deviationCount).toBe(1);
  });
});
