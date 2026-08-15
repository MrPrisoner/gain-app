import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { finishWorkout, logActivity, logMetric, startWorkout } from "../../src/lib/db/workout";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import {
  recentActivities,
  recentWorkoutsForPlan,
  nextMorningCandidates,
} from "../../src/lib/db/home";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-training-v1.md", ROOT), "utf8");
const NOW = new Date("2026-09-08T08:00:00Z");

describe("src/lib/db/home", () => {
  let dataDir: string;
  let userDb: UserDb;
  let planId: string;
  let planVersionId: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-home-test-"));
    userDb = openUserDb(dataDir, "user-1", { now: NOW });

    const parsed = parsePlanDocument(fixtureMd);
    if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
    const result = importPlan(userDb, { parsed, now: NOW });
    if (!result.ok) throw new Error(result.message);
    planId = result.plan_id;
    planVersionId = result.plan_version_id;
  });

  afterEach(() => {
    userDb.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  describe("recentWorkoutsForPlan", () => {
    it("returns workouts most-recent-first, limited", () => {
      startWorkout(userDb, {
        planVersionId,
        sessionKey: "A",
        clientId: "wk-1",
        now: new Date("2026-09-01T08:00:00Z"),
      });
      startWorkout(userDb, {
        planVersionId,
        sessionKey: "B",
        clientId: "wk-2",
        now: new Date("2026-09-05T08:00:00Z"),
      });

      const rows = recentWorkoutsForPlan(userDb, planId);
      expect(rows.map((r) => r.sessionKey)).toEqual(["B", "A"]);

      expect(recentWorkoutsForPlan(userDb, planId, 1)).toHaveLength(1);
    });
  });

  describe("recentActivities", () => {
    it("returns activities most-recent-first, limited", () => {
      logActivity(userDb, {
        kind: "squash",
        occurredAt: new Date("2026-09-01T08:00:00Z"),
        clientId: "act-1",
      });
      logActivity(userDb, {
        kind: "yoga",
        occurredAt: new Date("2026-09-05T08:00:00Z"),
        clientId: "act-2",
      });

      const rows = recentActivities(userDb);
      expect(rows.map((r) => r.kind)).toEqual(["yoga", "squash"]);

      expect(recentActivities(userDb, 1)).toHaveLength(1);
    });
  });

  describe("nextMorningCandidates", () => {
    it("surfaces a completed workout's next_morning session metrics, unanswered", () => {
      const { id } = startWorkout(userDb, {
        planVersionId,
        sessionKey: "A",
        clientId: "wk-nm-1",
        now: NOW,
      });
      finishWorkout(userDb, { workoutId: id, status: "completed", now: NOW });

      const rows = nextMorningCandidates(userDb, NOW);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.workoutClientId).toBe("wk-nm-1");
      expect(rows[0]?.metrics.map((m) => m.key)).toContain("symptoms_next_morning");
      expect(rows[0]?.answeredKeys).toEqual([]);
    });

    it("excludes an already-answered metric key from answeredKeys' complement", () => {
      const { id } = startWorkout(userDb, {
        planVersionId,
        sessionKey: "A",
        clientId: "wk-nm-2",
        now: NOW,
      });
      finishWorkout(userDb, { workoutId: id, status: "completed", now: NOW });
      logMetric(userDb, {
        scope: "session",
        workoutId: id,
        metricKey: "symptoms_next_morning",
        valueNum: 3,
        clientId: "mv-1",
      });

      const [row] = nextMorningCandidates(userDb, NOW);
      expect(row?.answeredKeys).toEqual(["symptoms_next_morning"]);
    });

    it("excludes a workout completed outside the read window", () => {
      const { id } = startWorkout(userDb, {
        planVersionId,
        sessionKey: "A",
        clientId: "wk-nm-old",
        now: new Date("2026-09-01T08:00:00Z"),
      });
      finishWorkout(userDb, {
        workoutId: id,
        status: "completed",
        now: new Date("2026-09-01T08:00:00Z"),
      });

      expect(nextMorningCandidates(userDb, NOW)).toHaveLength(0);
    });

    it("excludes a workout with no client_id — there is no offline-addressable way to answer it", () => {
      const { id } = startWorkout(userDb, {
        planVersionId,
        sessionKey: "A",
        clientId: "wk-nm-legacy",
        now: NOW,
      });
      finishWorkout(userDb, { workoutId: id, status: "completed", now: NOW });
      userDb.db.prepare("UPDATE workout SET client_id = NULL WHERE id = ?").run(id);

      expect(nextMorningCandidates(userDb, NOW)).toHaveLength(0);
    });
  });
});
