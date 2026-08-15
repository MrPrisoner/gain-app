import { describe, expect, it } from "vitest";
import { historyFromOps } from "../../src/lib/sync/history";
import { hydrateSession, type HydratableSession } from "../../src/lib/session/resume";
import type { SyncOp } from "../../src/lib/sync/ops";

const W = "01JZ000000000000000000000W";

const session: HydratableSession = {
  blocks: [
    {
      key: "main",
      type: "sequence",
      tracking: "full",
      exercises: [{ slug: "goblet-squat" }, { slug: "row" }],
    },
  ],
};

describe("historyFromOps", () => {
  it("projects set ops into slug-keyed rows ordered by op id", () => {
    const ops: SyncOp[] = [
      {
        kind: "set",
        id: "02",
        workoutClientId: W,
        exerciseSlug: "goblet-squat",
        setNo: 2,
        reps: 10,
        weightKg: 6,
        difficulty: "hard",
      },
      {
        kind: "set",
        id: "01",
        workoutClientId: W,
        exerciseSlug: "goblet-squat",
        setNo: 1,
        reps: 12,
        weightKg: 6,
        difficulty: "medium",
      },
    ];

    const history = historyFromOps(ops);
    expect(history.sets.map((row) => row.id)).toEqual(["01", "02"]);
    expect(history.sets[0]).toEqual({
      id: "01",
      exerciseSlug: "goblet-squat",
      setNo: 1,
      side: null,
      reps: 12,
      weightKg: 6,
      durationS: null,
      difficulty: "medium",
    });
  });

  it("omits set-scope metrics, which hang off a set rather than the workout", () => {
    const ops: SyncOp[] = [
      {
        kind: "metric",
        id: "01",
        workoutClientId: W,
        scope: "session",
        metricKey: "energy",
        valueNum: 7,
      },
      {
        kind: "metric",
        id: "02",
        workoutClientId: W,
        scope: "set",
        setClientId: "aa",
        metricKey: "rpe",
        valueNum: 8,
      },
    ];
    expect(historyFromOps(ops).metrics.map((row) => row.metricKey)).toEqual(["energy"]);
  });

  it("ignores start and finish ops, which are the workout row rather than its history", () => {
    const ops: SyncOp[] = [
      {
        kind: "start",
        id: "01",
        workoutClientId: W,
        planVersionId: "pv",
        sessionKey: "A",
        startedAt: "2026-09-08T08:00:00.000Z",
      },
      {
        kind: "finish",
        id: "09",
        workoutClientId: W,
        status: "completed",
        finishedAt: "2026-09-08T09:00:00.000Z",
      },
    ];
    const history = historyFromOps(ops);
    expect(history.sets).toEqual([]);
    expect(history.deviations).toEqual([]);
    expect(history.metrics).toEqual([]);
  });

  it("ignores activity ops too — an activity hangs off no workout, so it has no history row", () => {
    const ops: SyncOp[] = [
      {
        kind: "activity",
        id: "01",
        activityKind: "squash",
        occurredAt: "2026-09-08T08:00:00.000Z",
      },
    ];
    const history = historyFromOps(ops);
    expect(history.sets).toEqual([]);
    expect(history.deviations).toEqual([]);
    expect(history.metrics).toEqual([]);
  });

  it("feeds hydrateSession, so a local rebuild produces the same ledger a server resume does", () => {
    const ops: SyncOp[] = [
      {
        kind: "set",
        id: "01",
        workoutClientId: W,
        exerciseSlug: "goblet-squat",
        setNo: 1,
        reps: 12,
        weightKg: 6,
        difficulty: "medium",
      },
      {
        kind: "deviation",
        id: "02",
        workoutClientId: W,
        exerciseSlug: "row",
        deviationKind: "skip",
        reasonCode: "time",
      },
    ];

    const hydration = hydrateSession(session, historyFromOps(ops));
    expect(hydration.loggedSets).toHaveLength(1);
    expect(hydration.skipped).toEqual(["main:row"]);
  });
});
