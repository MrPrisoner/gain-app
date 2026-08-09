import { describe, expect, it } from "vitest";
import {
  formatLastPerformance,
  pickPrefill,
  type RecentSetRow,
} from "../../src/lib/session/prefill";

const rows: RecentSetRow[] = [
  {
    startedAt: "2026-08-20T07:30:00Z",
    setNo: 1,
    side: null,
    reps: 11,
    weightKg: 12,
    durationS: null,
    difficulty: "medium",
  },
  {
    startedAt: "2026-08-17T07:30:00Z",
    setNo: 1,
    side: null,
    reps: 10,
    weightKg: 12,
    durationS: null,
    difficulty: "easy",
  },
];

const perSideRows: RecentSetRow[] = [
  {
    startedAt: "2026-08-20T07:30:00Z",
    setNo: 1,
    side: "left",
    reps: 9,
    weightKg: null,
    durationS: null,
    difficulty: "medium",
  },
  {
    startedAt: "2026-08-20T07:30:00Z",
    setNo: 1,
    side: "right",
    reps: 10,
    weightKg: null,
    durationS: null,
    difficulty: "medium",
  },
];

describe("pickPrefill", () => {
  it("returns undefined for an exercise never logged before", () => {
    expect(pickPrefill([], undefined)).toBeUndefined();
  });

  it("picks the most recent matching row (rows given most-recent-first)", () => {
    const prefill = pickPrefill(rows, undefined);
    expect(prefill).toEqual({ reps: 11, weightKg: 12, durationS: undefined });
  });

  it("filters to the requested side for a per-side exercise", () => {
    expect(pickPrefill(perSideRows, "left")).toEqual({
      reps: 9,
      weightKg: undefined,
      durationS: undefined,
    });
    expect(pickPrefill(perSideRows, "right")).toEqual({
      reps: 10,
      weightKg: undefined,
      durationS: undefined,
    });
  });

  it("returns undefined when no row matches the requested side", () => {
    expect(pickPrefill(rows, "left")).toBeUndefined();
  });
});

describe("pickPrefill — default_kg fallback (UI-DECISIONS §3)", () => {
  it("falls back to default_kg for weight when nothing has ever been logged", () => {
    expect(pickPrefill([], undefined, 6)).toEqual({
      reps: undefined,
      weightKg: 6,
      durationS: undefined,
    });
  });

  it("still returns undefined with no rows and no default_kg supplied", () => {
    expect(pickPrefill([], undefined, undefined)).toBeUndefined();
  });

  it("prefers the last matching performance's weight over default_kg", () => {
    expect(pickPrefill(rows, undefined, 99)).toEqual({
      reps: 11,
      weightKg: 12,
      durationS: undefined,
    });
  });

  it("falls back to default_kg when the matching row logged no weight", () => {
    expect(pickPrefill(perSideRows, "left", 6)).toEqual({
      reps: 9,
      weightKg: 6,
      durationS: undefined,
    });
  });

  it("falls back to default_kg (not blank) when no row matches the requested side", () => {
    expect(pickPrefill(rows, "left", 6)).toEqual({
      reps: undefined,
      weightKg: 6,
      durationS: undefined,
    });
  });
});

describe("formatLastPerformance — the log strip's last-performance line (UI-DECISIONS §2)", () => {
  it("names reps and total load", () => {
    expect(formatLastPerformance(pickPrefill(rows, undefined), "reps")).toBe(
      "Last time 11 at 12 kg",
    );
  });

  it("names reps alone when the movement carries no load", () => {
    expect(formatLastPerformance(pickPrefill(perSideRows, "left"), "reps")).toBe("Last time 9");
  });

  it("names a held duration for a time exercise", () => {
    expect(formatLastPerformance({ durationS: 30 }, "time")).toBe("Last time 30 sec");
  });

  // A `default_kg` fallback carries a weight and nothing else, so it is named as the
  // starting suggestion it is rather than dressed up as a performance that never happened.
  it("does not pass off a default_kg fallback as history", () => {
    expect(formatLastPerformance(pickPrefill([], undefined, 6), "reps")).toBe(
      "No history — starting at 6 kg",
    );
  });

  it("says so plainly when there is nothing at all", () => {
    expect(formatLastPerformance(undefined, "reps")).toBe("No history yet");
    expect(formatLastPerformance(undefined, "time")).toBe("No history yet");
    expect(formatLastPerformance({ reps: 8 }, "time")).toBe("No history yet");
  });
});
