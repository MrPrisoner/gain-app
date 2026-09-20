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

  /**
   * `recentWorkoutsForPlan` answers the rotation cursor's question and
   * `openWorkoutsForPlan` (`tests/db/open-workouts.test.ts`) answers Home's
   * unfinished-session card. Between them every workout is accounted for exactly once,
   * which is why what each one *excludes* matters as much as what it returns.
   */
  describe("recentWorkoutsForPlan", () => {
    function workoutAt(clientId: string, sessionKey: string, iso: string, finished: boolean) {
      const { id } = startWorkout(userDb, {
        planVersionId,
        sessionKey,
        clientId,
        now: new Date(iso),
      });
      if (finished) {
        finishWorkout(userDb, { workoutId: id, status: "completed", now: new Date(iso) });
      }
    }

    it("returns workouts most-recent-first, limited", () => {
      workoutAt("wk-1", "A", "2026-09-01T08:00:00Z", true);
      workoutAt("wk-2", "B", "2026-09-05T08:00:00Z", true);

      const rows = recentWorkoutsForPlan(userDb, planId);
      expect(rows.map((r) => r.sessionKey)).toEqual(["B", "A"]);

      expect(recentWorkoutsForPlan(userDb, planId, 1)).toHaveLength(1);
    });

    it("returns only finished workouts", () => {
      workoutAt("wk-1", "A", "2026-09-01T08:00:00Z", true);
      workoutAt("wk-2", "B", "2026-09-05T08:00:00Z", false);

      expect(recentWorkoutsForPlan(userDb, planId).map((r) => r.sessionKey)).toEqual(["A"]);
    });

    it("does not let abandoned workouts push finished ones out of the limit", () => {
      // Why the filter is in the query and not only in `suggestNextSession`: applied after
      // a LIMIT, these three abandoned rows would fill the whole window on their own and
      // Home would claim no session had ever been done on this plan.
      workoutAt("wk-done", "A", "2026-09-01T08:00:00Z", true);
      workoutAt("wk-x1", "B", "2026-09-02T08:00:00Z", false);
      workoutAt("wk-x2", "C", "2026-09-03T08:00:00Z", false);
      workoutAt("wk-x3", "D", "2026-09-04T08:00:00Z", false);

      expect(recentWorkoutsForPlan(userDb, planId, 3).map((r) => r.sessionKey)).toEqual(["A"]);
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
