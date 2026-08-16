/**
 * Section 2 of the export — the pre-computed progress summary.
 *
 * The reviewing AI reads these tables instead of doing arithmetic over the CSV, so
 * a wrong number here becomes a wrong prescription. These tests pin the properties
 * that are easy to get quietly wrong: which load belongs to which set, what "first"
 * and "latest" mean, and that two scopes sharing a metric key stay two series.
 */

import { describe, expect, it } from "vitest";

import type { GainContract } from "../src/lib/contract/schema";
import { buildProgressSummary, renderExerciseSets } from "../src/lib/export/summary";
import { EMPTY_LOGS, type Logs, type SetLog } from "../src/lib/logs/types";

const NOW = new Date("2026-09-01T09:00:00Z");

const set = (over: Partial<SetLog> & Pick<SetLog, "id" | "set_no">): SetLog => ({
  workout_id: "w1",
  exercise_slug: "goblet-squat",
  ...over,
});

describe("renderExerciseSets", () => {
  it("hoists the load when every set carried the same one", () => {
    expect(
      renderExerciseSets([
        set({ id: "1", set_no: 1, reps: 10, weight_kg: 6 }),
        set({ id: "2", set_no: 2, reps: 10, weight_kg: 6 }),
        set({ id: "3", set_no: 3, reps: 9, weight_kg: 6 }),
      ]),
    ).toBe("6 kg × 10/10/9");
  });

  it("attaches the load to each set when they differ — a drop set is not 3 sets at the top weight", () => {
    const rendered = renderExerciseSets([
      set({ id: "1", set_no: 1, reps: 10, weight_kg: 6 }),
      set({ id: "2", set_no: 2, reps: 8, weight_kg: 6 }),
      set({ id: "3", set_no: 3, reps: 8, weight_kg: 4 }),
    ]);
    expect(rendered).toBe("10 @ 6 kg/8 @ 6 kg/8 @ 4 kg");
    expect(rendered).not.toMatch(/^6 kg × /);
  });

  it("renders bodyweight sets with no load prefix", () => {
    expect(
      renderExerciseSets([
        set({ id: "1", set_no: 1, reps: 12 }),
        set({ id: "2", set_no: 2, reps: 10 }),
      ]),
    ).toBe("12/10");
  });

  it("renders timed sets in seconds", () => {
    expect(
      renderExerciseSets([
        set({ id: "1", set_no: 1, duration_s: 30 }),
        set({ id: "2", set_no: 2, duration_s: 35 }),
      ]),
    ).toBe("30s/35s");
  });

  it("splits per-side sets, left before right", () => {
    expect(
      renderExerciseSets([
        set({ id: "1", set_no: 1, reps: 10, side: "right" }),
        set({ id: "2", set_no: 1, reps: 9, side: "left" }),
      ]),
    ).toBe("L 9 · R 10");
  });

  it("orders by set_no regardless of input order", () => {
    expect(
      renderExerciseSets([
        set({ id: "2", set_no: 2, reps: 8 }),
        set({ id: "1", set_no: 1, reps: 10 }),
      ]),
    ).toBe("10/8");
  });
});

describe("buildProgressSummary", () => {
  /** Two scopes declaring the same metric key — legal, since keys are unique WITHIN a scope. */
  const contract = {
    schema_version: 1,
    plan: { slug: "p", name: "P", version: 1, based_on_version: null },
    loads: [{ ref: "db", label: "Dumbbells" }],
    exercises: [{ id: "goblet-squat" }],
    sessions: [
      {
        key: "A",
        name: "Session A",
        order: 1,
        blocks: [{ key: "main", name: "Main", exercises: [{ id: "goblet-squat", reps: 10 }] }],
      },
    ],
    metrics: {
      set: [{ key: "rpe", label: "Set RPE", type: "scale" as const, min: 1, max: 10 }],
      session: [{ key: "rpe", label: "Session RPE", type: "scale" as const, min: 1, max: 10 }],
    },
  } as unknown as GainContract;

  const logs: Logs = {
    workouts: [
      { id: "w1", session_key: "A", started_at: "2026-08-01T07:00:00Z", status: "completed" },
      { id: "w2", session_key: "A", started_at: "2026-08-08T07:00:00Z", status: "completed" },
    ],
    set_logs: [
      { id: "s1", workout_id: "w1", exercise_slug: "goblet-squat", set_no: 1, reps: 8 },
      { id: "s2", workout_id: "w2", exercise_slug: "goblet-squat", set_no: 1, reps: 10 },
    ],
    metric_values: [
      { id: "m1", key: "rpe", ref: { scope: "set", set_log_id: "s1" }, value_num: 5 },
      { id: "m2", key: "rpe", ref: { scope: "set", set_log_id: "s2" }, value_num: 6 },
      { id: "m3", key: "rpe", ref: { scope: "session", workout_id: "w1" }, value_num: 9 },
      { id: "m4", key: "rpe", ref: { scope: "session", workout_id: "w2" }, value_num: 8 },
    ],
    deviations: [],
    activities: [],
  };

  const rowFor = (summary: string, scope: string): string =>
    summary.split("\n").find((l) => l.startsWith(`| ${scope} | \`rpe\``)) ?? "";

  /** Cell count as a Markdown renderer sees it: escaped pipes are not delimiters. */
  const columns = (row: string): number => row.replaceAll("\\|", "").split("|").length - 1;

  it("keeps same-key metrics in different scopes as separate series", () => {
    const summary = buildProgressSummary(contract, logs, "full history", NOW);

    // Each row counts only its own scope's two values, not all four.
    expect(rowFor(summary, "set")).toContain("| Set RPE | 2 |");
    expect(rowFor(summary, "session")).toContain("| Session RPE | 2 |");
    // The set series is 5–6 and the session series 8–9; neither may borrow the other's extremes.
    expect(rowFor(summary, "set")).toMatch(/\| 5 \| 6 \| 5 \| 5\.5 \| 6 \|/);
    expect(rowFor(summary, "session")).toMatch(/\| 9 \| 8 \| 8 \| 8\.5 \| 9 \|/);
  });

  it("orders first and latest chronologically, not by input order", () => {
    const shuffled: Logs = { ...logs, metric_values: [...logs.metric_values].reverse() };
    const summary = buildProgressSummary(contract, shuffled, "full history", NOW);

    // w1 (5) precedes w2 (6) whatever order the values arrive in.
    expect(rowFor(summary, "set")).toMatch(/\| 5 \| 6 \|/);
    expect(rowFor(summary, "session")).toMatch(/\| 9 \| 8 \|/);
  });

  it("escapes pipes in free text so one note cannot eat a table row", () => {
    const piped = {
      ...contract,
      sessions: [{ ...contract.sessions[0], name: "Push | Pull" }],
    } as unknown as GainContract;

    const summary = buildProgressSummary(piped, { ...EMPTY_LOGS }, "weeks 1|2", NOW);
    const adherence = summary.split("\n").find((l) => l.startsWith("| A |")) ?? "";

    expect(adherence).toContain("Push \\| Pull");
    // Six columns, so seven delimiters — the pipe inside the name is not one of them.
    expect(columns(adherence)).toBe(7);
  });

  it("escapes pipes in deviation notes", () => {
    const withDeviation: Logs = {
      ...logs,
      deviations: [
        {
          id: "d1",
          workout_id: "w1",
          exercise_slug: "goblet-squat",
          kind: "skip",
          note: "back tight | stopped early",
        },
      ],
    };
    const summary = buildProgressSummary(contract, withDeviation, "full history", NOW);
    const row = summary.split("\n").find((l) => l.includes("back tight")) ?? "";
    expect(row).toContain("back tight \\| stopped early");
    expect(columns(row)).toBe(7);
  });

  it("splits the same exercise into two rows when it's prescribed in two sessions with different ranges", () => {
    const twoSessionContract = {
      ...contract,
      sessions: [
        ...contract.sessions,
        {
          key: "D",
          name: "Session D",
          order: 2,
          blocks: [
            {
              key: "main",
              name: "Main",
              exercises: [{ id: "goblet-squat", sets: 2, reps: [12, 15] }],
            },
          ],
        },
      ],
    } as unknown as GainContract;

    const twoSessionLogs: Logs = {
      ...logs,
      workouts: [
        ...logs.workouts,
        { id: "w3", session_key: "D", started_at: "2026-08-10T07:00:00Z", status: "completed" },
      ],
      set_logs: [
        ...logs.set_logs,
        { id: "s3", workout_id: "w3", exercise_slug: "goblet-squat", set_no: 1, reps: 12 },
      ],
    };

    const summary = buildProgressSummary(twoSessionContract, twoSessionLogs, "full history", NOW);
    const rows = summary.split("\n").filter((l) => l.startsWith("| Goblet squat"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Session A");
    expect(rows[1]).toContain("Session D");
  });

  it("shows a readiness verdict for a ranged prescription", () => {
    const summary = buildProgressSummary(contract, logs, "full history", NOW);
    const row = summary.split("\n").find((l) => l.startsWith("| Goblet squat"));
    // The fixture's own contract here prescribes a scalar `reps: 10` (see the file-level
    // `contract` above) — no range, so the readiness cell is a dash, not a verdict. This
    // pins that a scalar target renders as "no range" rather than a silently blank cell.
    expect(row).toMatch(/\|\s*–\s*\|$/);
  });
});
