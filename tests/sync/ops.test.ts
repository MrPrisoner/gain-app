import { describe, expect, it } from "vitest";
import { newOpId, syncBatchSchema, syncOpSchema } from "../../src/lib/sync/ops";

const START = {
  kind: "start",
  id: "01JZ0000000000000000000001",
  workoutClientId: "01JZ0000000000000000000001",
  planVersionId: "01JZ00000000000000000000PV",
  sessionKey: "A",
  startedAt: "2026-09-08T08:00:00.000Z",
};

describe("sync op schema", () => {
  it("accepts a start op", () => {
    expect(syncOpSchema.parse(START)).toEqual(START);
  });

  it("accepts a set op with only the fields its exercise type uses", () => {
    const op = {
      kind: "set",
      id: "01JZ0000000000000000000002",
      workoutClientId: "01JZ0000000000000000000001",
      exerciseSlug: "goblet-squat",
      setNo: 1,
      reps: 12,
      weightKg: 6,
      difficulty: "medium",
    };
    expect(syncOpSchema.parse(op)).toEqual(op);
  });

  it("rejects an unknown field rather than silently dropping it", () => {
    expect(() => syncOpSchema.parse({ ...START, sneaked: true })).toThrow();
  });

  it("rejects an unknown kind", () => {
    expect(() => syncOpSchema.parse({ ...START, kind: "wat" })).toThrow();
  });

  it("rejects a start op with no plan version — a workout must bind to the version it ran", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { planVersionId: _dropped, ...withoutVersion } = START;
    expect(() => syncOpSchema.parse(withoutVersion)).toThrow();
  });

  it("rejects a non-ISO startedAt", () => {
    expect(() => syncOpSchema.parse({ ...START, startedAt: "yesterday" })).toThrow();
  });

  it("accepts a batch and rejects an empty one", () => {
    expect(syncBatchSchema.parse({ ops: [START] }).ops).toHaveLength(1);
    expect(() => syncBatchSchema.parse({ ops: [] })).toThrow();
  });

  it("mints sortable ids", () => {
    const ids = Array.from({ length: 50 }, () => newOpId());
    expect([...ids].sort()).toEqual(ids);
  });
});
