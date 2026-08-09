import { describe, expect, it } from "vitest";
import { pickPrefill, type RecentSetRow } from "../../src/lib/session/prefill";

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
