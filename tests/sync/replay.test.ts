import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { replayOps } from "../../src/lib/sync/replay";
import type { SyncOp } from "../../src/lib/sync/ops";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-dumbbell-v1.md", ROOT), "utf8");
const NOW = new Date("2026-09-08T08:00:00Z");
const W = "01JZ000000000000000000000W";

describe("replayOps", () => {
  let dataDir: string;
  let userDb: UserDb;
  let planVersionId: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-replay-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: NOW });
    const parsed = parsePlanDocument(fixtureMd);
    if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
    const result = importPlan(userDb, { parsed, now: NOW });
    if (!result.ok) throw new Error(result.message);
    planVersionId = result.plan_version_id;
  });

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function start(id = "01"): SyncOp {
    return {
      kind: "start",
      id,
      workoutClientId: W,
      planVersionId,
      sessionKey: "A",
      startedAt: "2026-09-08T08:00:00.000Z",
    };
  }

  function set(id: string, setNo: number): SyncOp {
    return {
      kind: "set",
      id,
      workoutClientId: W,
      exerciseSlug: "goblet-squat",
      setNo,
      reps: 12,
      weightKg: 6,
      difficulty: "medium",
    };
  }

  it("applies a start and its sets", () => {
    const ack = replayOps(userDb, [start(), set("02", 1), set("03", 2)]);
    expect(ack.applied).toEqual(["01", "02", "03"]);
    expect(ack.failed).toEqual([]);
    expect(ack.pending).toEqual([]);

    const rows = userDb.db.prepare("SELECT COUNT(*) AS n FROM set_log").get() as { n: number };
    expect(rows.n).toBe(2);
  });

  it("stamps the workout with the client's clock, not the server's", () => {
    replayOps(userDb, [start()]);
    const row = userDb.db.prepare("SELECT started_at FROM workout WHERE client_id = ?").get(W) as {
      started_at: string;
    };
    expect(row.started_at).toBe("2026-09-08T08:00:00.000Z");
  });

  it("binds the workout to the version the op names, not the plan's current one", () => {
    replayOps(userDb, [start()]);
    const row = userDb.db
      .prepare("SELECT plan_version_id FROM workout WHERE client_id = ?")
      .get(W) as { plan_version_id: string };
    expect(row.plan_version_id).toBe(planVersionId);
  });

  it("is idempotent — replaying the same batch writes nothing new", () => {
    const ops = [start(), set("02", 1), set("03", 2)];
    replayOps(userDb, ops);
    const second = replayOps(userDb, ops);

    expect(second.applied).toEqual(["01", "02", "03"]);
    expect(second.failed).toEqual([]);
    expect(second.pending).toEqual([]);
    const rows = userDb.db.prepare("SELECT COUNT(*) AS n FROM set_log").get() as { n: number };
    expect(rows.n).toBe(2);
  });

  it("quarantines an unknown slug and still applies everything around it", () => {
    const ghost: SyncOp = {
      kind: "set",
      id: "02",
      workoutClientId: W,
      exerciseSlug: "not-a-real-movement",
      setNo: 1,
      reps: 12,
      difficulty: "medium",
    };

    const ack = replayOps(userDb, [start(), ghost, set("03", 1)]);
    expect(ack.applied).toEqual(["01", "03"]);
    expect(ack.failed).toHaveLength(1);
    expect(ack.failed[0]?.id).toBe("02");
    expect(ack.pending).toEqual([]);

    const rows = userDb.db.prepare("SELECT COUNT(*) AS n FROM set_log").get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it("retries — rather than quarantines — a set whose workout has not arrived yet", () => {
    const ack = replayOps(userDb, [set("02", 1)]);
    expect(ack.applied).toEqual([]);
    expect(ack.failed).toEqual([]);
    expect(ack.pending).toEqual(["02"]);
  });

  it("finishes a workout with the client's completion time", () => {
    replayOps(userDb, [
      start(),
      {
        kind: "finish",
        id: "09",
        workoutClientId: W,
        status: "completed",
        finishedAt: "2026-09-08T09:12:00.000Z",
      },
    ]);
    const row = userDb.db
      .prepare("SELECT status, completed_at FROM workout WHERE client_id = ?")
      .get(W) as { status: string; completed_at: string };
    expect(row.status).toBe("completed");
    expect(row.completed_at).toBe("2026-09-08T09:12:00.000Z");
  });

  it("resolves a set-scope metric through the set's client id", () => {
    replayOps(userDb, [
      start(),
      set("02", 1),
      {
        kind: "metric",
        id: "03",
        workoutClientId: W,
        scope: "set",
        setClientId: "02",
        metricKey: "rpe",
        valueNum: 8,
      },
    ]);
    const row = userDb.db
      .prepare(
        "SELECT mv.value_num AS v FROM metric_value mv JOIN set_log s ON s.id = mv.set_log_id WHERE s.client_id = ?",
      )
      .get("02") as { v: number };
    expect(row.v).toBe(8);
  });
});
