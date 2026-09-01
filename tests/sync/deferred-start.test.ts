/**
 * The rule that holds a workout's `start` op back until the workout is actually written
 * to. Pure, so it is testable without a browser — `client.svelte.ts` holds only the
 * armed op and cannot be imported by a test at all (`vitest.config.ts` runs without the
 * Svelte plugin).
 */

import { describe, expect, it } from "vitest";
import { resolveWrite } from "../../src/lib/sync/deferred-start";
import type { StartOp, SyncOp } from "../../src/lib/sync/ops";

const WORKOUT = "01JZ000000000000000000000W";
const OTHER_WORKOUT = "01JZ000000000000000000000X";

const startOp: StartOp = {
  kind: "start",
  id: "01JZ00000000000000000000AA",
  workoutClientId: WORKOUT,
  planVersionId: "pv-1",
  sessionKey: "A",
  startedAt: "2026-09-01T08:00:00.000Z",
};

function setOp(id: string, workoutClientId = WORKOUT): SyncOp {
  return {
    kind: "set",
    id,
    workoutClientId,
    exerciseSlug: "goblet-squat",
    setNo: 1,
    reps: 12,
    difficulty: "medium",
  };
}

const activityOp: SyncOp = {
  kind: "activity",
  id: "01JZ00000000000000000000ZZ",
  activityKind: "walk",
  occurredAt: "2026-09-01T09:00:00.000Z",
};

describe("resolveWrite", () => {
  it("puts the armed start ahead of the op that commits it", () => {
    const result = resolveWrite(startOp, setOp("01JZ00000000000000000000BB"));
    expect(result.ops.map((op) => op.id)).toEqual([
      "01JZ00000000000000000000AA",
      "01JZ00000000000000000000BB",
    ]);
    expect(result.consumed).toBe(true);
  });

  it("emits the start with a lower ULID than the op it precedes", () => {
    const ops = resolveWrite(startOp, setOp("01JZ00000000000000000000BB")).ops;
    expect(ops[0]!.id < ops[1]!.id).toBe(true);
  });

  it("passes an op straight through once nothing is armed", () => {
    const result = resolveWrite(undefined, setOp("01JZ00000000000000000000BB"));
    expect(result.ops.map((op) => op.id)).toEqual(["01JZ00000000000000000000BB"]);
    expect(result.consumed).toBe(false);
  });

  it("leaves another workout's armed start alone", () => {
    const result = resolveWrite(startOp, setOp("01JZ00000000000000000000BB", OTHER_WORKOUT));
    expect(result.ops.map((op) => op.id)).toEqual(["01JZ00000000000000000000BB"]);
    expect(result.consumed).toBe(false);
  });

  it("never commits a workout on an op that belongs to no workout", () => {
    // An activity is logged from Home and carries no `workoutClientId` at all. Reading a
    // missing property as a match would start a workout nobody opened.
    const result = resolveWrite(startOp, activityOp);
    expect(result.ops).toEqual([activityOp]);
    expect(result.consumed).toBe(false);
  });

  it("commits on a finish, like every other workout-scoped op", () => {
    // Not a semantic nicety: a finish that reached the server with no workout would
    // resolve nothing, throw `NotYetError`, and retry forever with no start op left in
    // the outbox to rescue it. See the spec, section 3.
    const finish: SyncOp = {
      kind: "finish",
      id: "01JZ00000000000000000000CC",
      workoutClientId: WORKOUT,
      status: "completed",
      finishedAt: "2026-09-01T09:00:00.000Z",
    };
    expect(resolveWrite(startOp, finish).consumed).toBe(true);
  });

  it("commits on a deviation and on a metric", () => {
    const deviation: SyncOp = {
      kind: "deviation",
      id: "01JZ00000000000000000000DD",
      workoutClientId: WORKOUT,
      exerciseSlug: "goblet-squat",
      deviationKind: "skip",
      reasonCode: "time",
    };
    const metric: SyncOp = {
      kind: "metric",
      id: "01JZ00000000000000000000EE",
      workoutClientId: WORKOUT,
      scope: "session",
      metricKey: "energy_before",
      valueNum: 3,
    };
    expect(resolveWrite(startOp, deviation).consumed).toBe(true);
    expect(resolveWrite(startOp, metric).consumed).toBe(true);
  });
});
