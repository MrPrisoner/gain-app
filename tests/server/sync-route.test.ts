/**
 * The sync endpoint, driven through its exported `POST` handler (ARCHITECTURE §4, design
 * — same level `tests/server/first-run.test.ts` drives `+page.server.ts`'s
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
import { getControlDb, getUserDbFor, resetAppStateForTests } from "../../src/lib/server/app-state";
import { bumpDataGeneration } from "../../src/lib/server/control-db";
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

  // A real `control_user` row for USER_ID, so `getDataGeneration`/`bumpDataGeneration`
  // have something to read and write — this suite otherwise never touches control.db.
  getControlDb()
    .db.prepare(
      "INSERT INTO control_user (id, oidc_sub, created_at, last_login_at) VALUES (?, ?, ?, ?)",
    )
    .run(USER_ID, "sub-sync-route-test", NOW.toISOString(), NOW.toISOString());
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
// `request` and `url.searchParams` (same shape first-run.test.ts uses for the page
// actions). The request itself is a real `Request` rather than a stub: the body cap
// reads the body as a stream, so a hand-written `{ json() }` double could not exercise
// it at all, and the cases that matter are precisely the ones where the headers and the
// actual bytes disagree.
// ---------------------------------------------------------------------------

function event(opts: {
  authed?: boolean;
  body?: unknown;
  /** A raw body, for the size cases — notably a stream, which carries no length. */
  rawBody?: BodyInit;
  /** Sent verbatim, so a test can lie about the length or send nonsense. */
  contentLength?: string;
}) {
  const { authed = true, body, rawBody, contentLength } = opts;
  const url = new URL("https://gain.example.com/api/sync");
  const headers = new Headers({ "content-type": "application/json" });
  if (contentLength !== undefined) headers.set("content-length", contentLength);

  const init: RequestInit & { duplex?: string } = { method: "POST", headers };
  if (rawBody !== undefined) {
    init.body = rawBody;
    // Node requires this on any request whose body is a stream.
    init.duplex = "half";
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  return {
    request: new Request(url, init),
    locals: authed ? { user: { id: USER_ID, bypass: true } } : { user: null },
    url,
  } as never;
}

/** A body of `bytes` valid-JSON bytes, delivered in chunks so it carries no length. */
function oversizedStream(bytes: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunk = encoder.encode("x".repeat(64 * 1024));
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent === 0) controller.enqueue(encoder.encode('{"ops":[],"note":"'));
      if (sent >= bytes) {
        controller.enqueue(encoder.encode('"}'));
        controller.close();
        return;
      }
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
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

  it("rejects an oversized batch with 413 before parsing the body", async () => {
    const res = await POST(event({ body: validBatch(), contentLength: "2000000" }));
    expect(res.status).toBe(413);
    expect(counts()).toEqual({ workouts: 0, sets: 0 });
  });

  it("rejects an oversized body that declares no length at all", async () => {
    // A chunked request has no Content-Length, so a cap that reads only the header lets
    // an unbounded body straight through to be buffered whole.
    const res = await POST(event({ rawBody: oversizedStream(1_500_000) }));
    expect(res.status).toBe(413);
    expect(counts()).toEqual({ workouts: 0, sets: 0 });
  });

  it("rejects an oversized body whose declared length is nonsense", async () => {
    // `Number("banana")` is NaN and every comparison against it is false, so a garbage
    // header skipped the check entirely rather than failing it.
    const res = await POST(event({ rawBody: oversizedStream(1_500_000), contentLength: "banana" }));
    expect(res.status).toBe(413);
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

  it("rejects a whole batch from a stale generation and writes nothing", async () => {
    bumpDataGeneration(getControlDb(), USER_ID); // now generation 1

    const res = await POST(event({ body: { generation: 0, ...validBatch() } }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ dataGeneration: 1 });
    expect(counts()).toEqual({ workouts: 0, sets: 0 });
  });

  it("applies a batch whose generation matches", async () => {
    const res = await POST(event({ body: { generation: 0, ...validBatch() } }));
    expect(res.status).toBe(200);
    expect(counts()).toEqual({ workouts: 1, sets: 1 });
  });
});
