import { describe, expect, it } from "vitest";
import { applyAck, planBatch } from "../../src/lib/sync/queue";
import type { SyncOp } from "../../src/lib/sync/ops";
import { memoryOutbox } from "./memory-outbox";

function setOp(id: string): SyncOp {
  return {
    kind: "set",
    id,
    workoutClientId: "01JZ000000000000000000000W",
    exerciseSlug: "goblet-squat",
    setNo: 1,
    reps: 12,
    difficulty: "medium",
  };
}

describe("planBatch", () => {
  it("takes the oldest ops first, in ULID order, regardless of store order", () => {
    const pending = [setOp("03"), setOp("01"), setOp("02")];
    expect(planBatch(pending, 2).map((op) => op.id)).toEqual(["01", "02"]);
  });

  it("returns everything when the limit exceeds the queue", () => {
    expect(planBatch([setOp("01")], 50)).toHaveLength(1);
  });

  it("returns nothing for an empty queue", () => {
    expect(planBatch([], 50)).toEqual([]);
  });
});

describe("applyAck", () => {
  const batch = [setOp("01"), setOp("02"), setOp("03")];

  it("acks what applied and quarantines what failed", () => {
    const result = applyAck(batch, {
      applied: ["01", "03"],
      failed: [{ id: "02", error: "unknown exercise `ghost`" }],
    });
    expect(result.ackIds).toEqual(["01", "03"]);
    expect(result.quarantine).toEqual([{ id: "02", error: "unknown exercise `ghost`" }]);
  });

  it("leaves an op the server said nothing about pending — silence is not success", () => {
    const result = applyAck(batch, { applied: ["01"], failed: [] });
    expect(result.ackIds).toEqual(["01"]);
    expect(result.quarantine).toEqual([]);
  });

  it("never reports an id the batch did not contain", () => {
    const result = applyAck(batch, {
      applied: ["01", "99"],
      failed: [{ id: "98", error: "who?" }],
    });
    expect(result.ackIds).toEqual(["01"]);
    expect(result.quarantine).toEqual([]);
  });
});

describe("the outbox contract", () => {
  it("discards quarantined records and keeps pending ones", async () => {
    const outbox = memoryOutbox();
    await outbox.append(setOp("01"));
    await outbox.append(setOp("02"));
    await outbox.quarantine([{ id: "02", error: "unknown exercise `ghost`" }]);

    await outbox.clearQuarantined();

    expect(await outbox.counts()).toEqual({ pending: 1, quarantined: 0 });
  });

  it("clearAll drops pending and quarantined alike", async () => {
    const outbox = memoryOutbox();
    await outbox.append(setOp("01"));
    await outbox.append(setOp("02"));
    await outbox.quarantine([{ id: "02", error: "unknown exercise `ghost`" }]);

    await outbox.clearAll();

    expect(await outbox.counts()).toEqual({ pending: 0, quarantined: 0 });
  });
});
