import { describe, expect, it } from "vitest";
import {
  carryForwardFromPreviousSet,
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
    expect(prefill).toEqual({ reps: 11, weightKg: 12, durationS: undefined, isFirstTime: false });
  });

  it("filters to the requested side for a per-side exercise", () => {
    expect(pickPrefill(perSideRows, "left")).toEqual({
      reps: 9,
      weightKg: undefined,
      durationS: undefined,
      isFirstTime: false,
    });
    expect(pickPrefill(perSideRows, "right")).toEqual({
      reps: 10,
      weightKg: undefined,
      durationS: undefined,
      isFirstTime: false,
    });
  });

  it("returns undefined when no row matches the requested side", () => {
    expect(pickPrefill(rows, "left")).toBeUndefined();
  });
});

describe("pickPrefill — default_kg fallback (UI §3)", () => {
  it("falls back to default_kg for weight when nothing has ever been logged", () => {
    expect(pickPrefill([], undefined, 6)).toEqual({
      reps: undefined,
      weightKg: 6,
      durationS: undefined,
      isFirstTime: true,
    });
  });

  it("still returns undefined with no rows and no default_kg/repsTarget supplied", () => {
    expect(pickPrefill([], undefined, undefined)).toBeUndefined();
  });

  it("prefers the last matching performance's weight over default_kg", () => {
    expect(pickPrefill(rows, undefined, 99)).toEqual({
      reps: 11,
      weightKg: 12,
      durationS: undefined,
      isFirstTime: false,
    });
  });

  it("falls back to default_kg when the matching row logged no weight", () => {
    expect(pickPrefill(perSideRows, "left", 6)).toEqual({
      reps: 9,
      weightKg: 6,
      durationS: undefined,
      isFirstTime: false,
    });
  });

  it("falls back to default_kg (not blank) when no row matches the requested side", () => {
    expect(pickPrefill(rows, "left", 6)).toEqual({
      reps: undefined,
      weightKg: 6,
      durationS: undefined,
      isFirstTime: true,
    });
  });
});

describe("pickPrefill — reps-target fallback (todo: always populate a default rep count)", () => {
  it("falls back to the range's lower bound when nothing has ever been logged", () => {
    expect(pickPrefill([], undefined, undefined, [8, 12])).toEqual({
      reps: 8,
      weightKg: undefined,
      durationS: undefined,
      isFirstTime: true,
    });
  });

  it("falls back to a fixed reps target as-is", () => {
    expect(pickPrefill([], undefined, undefined, 10)).toEqual({
      reps: 10,
      weightKg: undefined,
      durationS: undefined,
      isFirstTime: true,
    });
  });

  it("combines with default_kg when both are supplied and nothing has ever been logged", () => {
    expect(pickPrefill([], undefined, 6, [8, 12])).toEqual({
      reps: 8,
      weightKg: 6,
      durationS: undefined,
      isFirstTime: true,
    });
  });

  it("prefers the last matching performance's reps over the reps target", () => {
    expect(pickPrefill(rows, undefined, undefined, [8, 12])).toEqual({
      reps: 11,
      weightKg: 12,
      durationS: undefined,
      isFirstTime: false,
    });
  });

  it("falls back to the reps target (not blank) when no row matches the requested side", () => {
    expect(pickPrefill(rows, "left", undefined, [8, 12])).toEqual({
      reps: 8,
      weightKg: undefined,
      durationS: undefined,
      isFirstTime: true,
    });
  });
});

const durationRows: RecentSetRow[] = [
  {
    startedAt: "2026-08-20T07:30:00Z",
    setNo: 1,
    side: null,
    reps: null,
    weightKg: null,
    durationS: 35,
    difficulty: "medium",
  },
];

describe("pickPrefill — duration-target fallback (same rule as reps, for type: time)", () => {
  it("falls back to the range's lower bound when nothing has ever been logged", () => {
    expect(pickPrefill([], undefined, undefined, undefined, [20, 40])).toEqual({
      reps: undefined,
      weightKg: undefined,
      durationS: 20,
      isFirstTime: true,
    });
  });

  it("falls back to a fixed duration target as-is", () => {
    expect(pickPrefill([], undefined, undefined, undefined, 30)).toEqual({
      reps: undefined,
      weightKg: undefined,
      durationS: 30,
      isFirstTime: true,
    });
  });

  it("prefers the last matching performance's duration over the duration target", () => {
    expect(pickPrefill(durationRows, undefined, undefined, undefined, [20, 40])).toEqual({
      reps: undefined,
      weightKg: undefined,
      durationS: 35,
      isFirstTime: false,
    });
  });
});

describe("carryForwardFromPreviousSet (todo: set 2 starts from what set 1 was actually logged as)", () => {
  it("passes the base pre-fill through unchanged when there is no previous set", () => {
    const base = { reps: 8, weightKg: 6 };
    expect(carryForwardFromPreviousSet(base, undefined)).toBe(base);
  });

  it("prefers the previous set's logged values over the base pre-fill", () => {
    expect(
      carryForwardFromPreviousSet({ reps: 8, weightKg: 6 }, { reps: 11, weightKg: 8 }),
    ).toEqual({
      reps: 11,
      weightKg: 8,
      durationS: undefined,
    });
  });

  it("falls back to the base pre-fill for a field the previous set left blank", () => {
    expect(carryForwardFromPreviousSet({ reps: 8, weightKg: 6 }, { weightKg: 8 })).toEqual({
      reps: 8,
      weightKg: 8,
      durationS: undefined,
    });
  });

  it("carries a held duration forward the same way", () => {
    expect(carryForwardFromPreviousSet({ durationS: 20 }, { durationS: 30 })).toEqual({
      reps: undefined,
      weightKg: undefined,
      durationS: 30,
    });
  });
});

describe("formatLastPerformance — the log strip's last-performance line (UI §2)", () => {
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

  it("does not pass off a duration-target fallback as history", () => {
    expect(
      formatLastPerformance(pickPrefill([], undefined, undefined, undefined, [20, 40]), "time"),
    ).toBe("No history — starting at 20 sec");
  });

  // A first-time result carries starting suggestions, not a performance that ever
  // happened, so it is named as one rather than dressed up as history.
  it("does not pass off a default_kg fallback as history", () => {
    expect(formatLastPerformance(pickPrefill([], undefined, 6), "reps")).toBe(
      "No history — starting at 6 kg",
    );
  });

  it("does not pass off a reps-target fallback as history", () => {
    expect(formatLastPerformance(pickPrefill([], undefined, undefined, [8, 12]), "reps")).toBe(
      "No history — starting at 8",
    );
  });

  it("names both starting suggestions together", () => {
    expect(formatLastPerformance(pickPrefill([], undefined, 6, [8, 12]), "reps")).toBe(
      "No history — starting at 8 at 6 kg",
    );
  });

  it("says so plainly when there is nothing at all", () => {
    expect(formatLastPerformance(undefined, "reps")).toBe("No history yet");
    expect(formatLastPerformance(undefined, "time")).toBe("No history yet");
    expect(formatLastPerformance({ reps: 8 }, "time")).toBe("No history yet");
  });
});
