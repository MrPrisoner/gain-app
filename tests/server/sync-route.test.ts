/**
 * The sync endpoint, driven through its exported `POST` handler (ARCHITECTURE §4, design
 * spec §6) — same level `tests/server/first-run.test.ts` drives `+page.server.ts`'s
 * actions: a minimal `RequestEvent` stand-in over the real `getUserDbFor`/`getConfig`
 * plumbing, not a reimplementation of the handler's logic.
 *
 * Four things must hold: an expired or absent session gets 401 without a hint of the
 * batch it refused to look at (§4 — a queued POST must survive re-login, not be answered
 * with a body a curious client could learn from); a batch that fails `syncBatchSchema`
 * gets 400 and writes nothing; a valid batch gets 200 with the ack; and replaying the
 * same batch is a no-op the second time, because `replayOps` is only as idempotent as the
 * write layer it calls.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "../../src/routes/api/sync/+server";
import { importPlan } from "../../src/lib/db/import-plan";
import { getUserDbFor, resetAppStateForTests } from "../../src/lib/server/app-state";
import { resetConfigForTests } from "../../src/lib/server/config";
import { parsePlanDocument } from "../../src/lib/parse/parser";

const FIXTURE = fs.readFileSync("fixtures/plans/home-training-v1.md", "utf8");
const USER_ID = "01KZKQ4GB22EEQBF20YDKD1BYE";
const NOW = new Date("2026-09-08T08:00:00Z");
const W = "01JZ000000000000000000000W";

let tmpDir: string;
let planVersionId: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-sync-route-test-"));
  process.env.DATA_DIR = tmpDir;
  process.env.GAIN_DEV_USER = "tester";
  delete process.env.OIDC_ISSUER;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_CLIENT_SECRET;
  delete process.env.OIDC_REQUIRED_GROUP;
  resetConfigForTests();
  resetAppStateForTests();

  const userDb = getUserDbFor(USER_ID);
  const parsed = parsePlanDocument(FIXTURE);
  if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
  const result = importPlan(userDb, { parsed, now: NOW });
  if (!result.ok) throw new Error(result.message);
  planVersionId = result.plan_version_id;
});

afterEach(() => {
  resetAppStateForTests();
  resetConfigForTests();
  delete process.env.DATA_DIR;
  delete process.env.GAIN_DEV_USER;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Minimal RequestEvent stand-in — the handler only ever reads `locals.user`,
// `request.json()` and `url.searchParams` (same shape first-run.test.ts uses
// for the page actions).
// ---------------------------------------------------------------------------

function event(opts: { authed?: boolean; body?: unknown }) {
  const { authed = true, body } = opts;
  const url = new URL("https://gain.example.com/api/sync");
  return {
    request: { json: () => Promise.resolve(body) },
    locals: authed ? { user: { id: USER_ID, bypass: true } } : { user: null },
    url,
  } as never;
}

function validBatch() {
  return {
    ops: [
      {
        kind: "start",
        id: "01",
        workoutClientId: W,
        planVersionId,
        sessionKey: "A",
        startedAt: "2026-09-08T08:00:00.000Z",
      },
      {
        kind: "set",
        id: "02",
        workoutClientId: W,
        exerciseSlug: "goblet-squat",
        setNo: 1,
        reps: 12,
        weightKg: 6,
        difficulty: "medium",
      },
    ],
  };
}

function counts() {
  const userDb = getUserDbFor(USER_ID);
  const workouts = userDb.db.prepare("SELECT COUNT(*) AS n FROM workout").get() as { n: number };
  const sets = userDb.db.prepare("SELECT COUNT(*) AS n FROM set_log").get() as { n: number };
  return { workouts: workouts.n, sets: sets.n };
}

describe("POST /api/sync", () => {
  it("answers an unauthenticated request with 401 and no hint of the data it refused", async () => {
    const res = await POST(event({ authed: false, body: validBatch() }));
    expect(res.status).toBe(401);

    const data = (await res.json()) as Record<string, unknown>;
    const serialized = JSON.stringify(data);
    // Nothing from the batch — not the workout's client id, not the exercise it named,
    // not an `applied`/`failed` shape that would confirm the endpoint even looked.
    expect(serialized).not.toContain(W);
    expect(serialized).not.toContain("goblet-squat");
    expect(data).not.toHaveProperty("applied");
    expect(data).not.toHaveProperty("failed");

    expect(counts()).toEqual({ workouts: 0, sets: 0 });
  });

  it("answers a batch that fails syncBatchSchema with 400, a readable message, and writes nothing", async () => {
    // Missing every required field a "start" op needs.
    const res = await POST(event({ body: { ops: [{ kind: "start" }] } }));
    expect(res.status).toBe(400);

    const data = (await res.json()) as { error: string };
    expect(typeof data.error).toBe("string");
    expect(data.error.length).toBeGreaterThan(0);

    expect(counts()).toEqual({ workouts: 0, sets: 0 });
  });

  it("applies a valid batch and answers 200 with the ack", async () => {
    const res = await POST(event({ body: validBatch() }));
    expect(res.status).toBe(200);

    const data = (await res.json()) as { applied: string[]; failed: unknown[]; pending: string[] };
    expect(data).toEqual({ applied: ["01", "02"], failed: [], pending: [] });
    expect(counts()).toEqual({ workouts: 1, sets: 1 });
  });

  it("posting the same batch twice leaves row counts unchanged and still answers 200", async () => {
    const first = await POST(event({ body: validBatch() }));
    expect(first.status).toBe(200);
    expect(counts()).toEqual({ workouts: 1, sets: 1 });

    const second = await POST(event({ body: validBatch() }));
    expect(second.status).toBe(200);

    const data = (await second.json()) as {
      applied: string[];
      failed: unknown[];
      pending: string[];
    };
    expect(data).toEqual({ applied: ["01", "02"], failed: [], pending: [] });
    expect(counts()).toEqual({ workouts: 1, sets: 1 });
  });
});
