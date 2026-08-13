# Phase 6 — Offline PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A session can be chosen, started, run and completed with no connection, and syncs cleanly on reconnect without ever duplicating or losing a set.

**Architecture:** The session runner currently has no client-side store — every write is a SvelteKit form action, so its local state *is* the server round trip. This phase introduces a client write layer (ops appended to an IndexedDB outbox, flushed as ordered batches to a new `POST /api/sync`) and makes the existing `src/lib/db/workout.ts` the replay target for it. Nothing about the reconstruction of runner state is rewritten: `hydrateSession` already rebuilds the ledger from slug-keyed, ULID-ordered rows, and the outbox is projected into exactly that shape.

**Tech Stack:** TypeScript 6 (strict), SvelteKit 2 (Svelte 5 runes), better-sqlite3 13, Zod 4, Vitest 4, Playwright, fast-check (new devDependency), `ulidx`.

**Design:** [`docs/superpowers/specs/2026-08-12-phase-6-offline-pwa-design.md`](../specs/2026-08-12-phase-6-offline-pwa-design.md). Where this plan and that spec disagree, the spec is right and this plan is a bug.

## Global Constraints

- **Read `AGENTS.md` first**, then `docs/ARCHITECTURE.md` §4 and §9, then the design spec above. They are the contract; this plan implements them.
- **Node 24 LTS.** Every dependency is on a current major — Zod 4, TypeScript 6, ESLint 10, Vitest 4, better-sqlite3 13. Do not write Zod 3 idioms from memory: this repo uses `z.strictObject`, `z.looseObject` and `error:`, never `z.object().strict()` or `message:`.
- **`npm run verify` is the definition of done.** It short-circuits, so a lint failure means the tests never ran. Run it before claiming any task complete.
- **Never write a literal control character — write the escape** (`\u0000`). Two checks enforce this.
- **Run `npx prettier --write <file>` after editing any TypeScript or Svelte file.** `docs/` is byte-sensitive and excluded from formatting — never remove it from `.prettierignore`.
- **A form action must never throw.** Every failure path returns `fail(status, { actionError })`. Only `redirect` is thrown. The same rule applies to `+server.ts` handlers: return a `Response`, never let an exception become a 500 that a queued client reads as permanent failure.
- **An op is never discarded.** Not on a 401, not on a schema failure, not on sign-out. An op that cannot succeed is quarantined and surfaced; it is never dropped and never allowed to block the ops behind it.
- **Ops carry slugs and client ULIDs, never server ids.** The server resolves `exerciseSlug` and `workoutClientId` at replay.
- **Metric values key on `(scope, key)`, never the bare key.** A plan may legally declare `rpe` at both set and session scope.
- **`weight_kg` is always total kilograms.** No `paired` field, no per-side doubling.
- **360 × 800 is the layout floor**, checked mechanically at three viewports.
- **Do not commit real health data.** The fixture is fictional and stays that way.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/sync/ops.ts` | Op types + Zod schema + `newOpId` | 1 |
| `tests/sync/ops.test.ts` | Schema accept/reject cases | 1 |
| `src/lib/sync/queue.ts` | `OutboxStore` interface, `planBatch`, `applyAck` — pure | 2 |
| `tests/sync/queue.test.ts` | Batching and ack resolution | 2 |
| `src/lib/sync/history.ts` | Ops → `WorkoutHistory` projection | 3 |
| `tests/sync/history.test.ts` | Projection round-trips through `hydrateSession` | 3 |
| `src/lib/db/workout.ts` | Export `resolveWorkoutIdByClientId`, `resolveSetLogIdByClientId` (modify) | 4 |
| `src/lib/sync/replay.ts` | Server: ordered ops → `workout.ts` calls, per-op result | 4 |
| `src/routes/api/sync/+server.ts` | Auth, parse, one `IMMEDIATE` transaction, ack response | 4 |
| `tests/sync/replay.test.ts` | Example-based replay behaviour | 4 |
| `tests/server/sync-route.test.ts` | 401, 400 and success paths | 4 |
| `tests/sync/replay.property.test.ts` | fast-check properties over replay | 5 |
| `src/lib/sync/idb.ts` | IndexedDB implementation of `OutboxStore` | 6 |
| `src/lib/sync/client.svelte.ts` | Flush loop, online/offline, backoff, 401 state, reactive status | 6 |
| `src/routes/+layout.svelte` | Sync banner (modify) | 6 |
| `src/routes/plan/[slug]/session/[key]/+page.server.ts` | Expose `planVersionId`; delete the four write actions (modify) | 7 |
| `src/routes/plan/[slug]/session/[key]/*.svelte` | Call `logWrite` instead of posting forms (modify, six files) | 7 |
| `src/service-worker.ts` | Precache shell and files; version-keyed; serve `/offline` on a navigation miss | 8 |
| `src/lib/sync/precache.ts` | App side: ask the worker to cache the session `__data.json` payloads | 8 |
| `src/routes/offline/+page.svelte` | The honest offline fallback page | 8 |
| `static/site.webmanifest` | `start_url`, `scope`, `id`, maskable purpose (modify) | 8 |
| `playwright.config.ts` | An `offline` project on a built server (modify) | 9 |
| `e2e/offline-*.spec.ts` | Airplane mode, browser kill, token expiry | 9 |
| `README.md`, `docs/ROADMAP.md`, `AGENTS.md` | Status close-out (modify) | 10 |

**What already exists — do not rebuild it:**

- `src/lib/db/workout.ts` — `startWorkout`, `finishWorkout`, `logSet`, `logMetric`, `logDeviation`, each already idempotent on `client_id`. These *are* the replay primitives.
- `src/lib/session/resume.ts` — `hydrateSession`, and the `WorkoutHistory` / `WorkoutSetRow` / `WorkoutDeviationRow` / `WorkoutMetricRow` / `SessionHydration` types.
- `src/lib/db/workout-history.ts` — `workoutHistoryFor`, the server-side producer of that same shape.
- `src/lib/server/gate.ts` — `isNavigationRequest`, already written so a fetch gets 401 rather than 303.
- `src/lib/db/ulid.ts` — `newId()`, a monotonic ULID factory. Server-side ids only.

**Two things that look like work and are not:**

- **The clock fix needs no signature change.** `startWorkout` and `finishWorkout` already take an injected `now: Date`. Replay passes `new Date(op.startedAt)` into it. That is the whole fix.
- **The set-scope metric fix needs no schema change.** `logMetric` takes `setLogId`; replay resolves `op.setClientId` to that id first.

---

### Task 1: The op format

**Files:**
- Create: `src/lib/sync/ops.ts`
- Create: `tests/sync/ops.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SyncOp` (a discriminated union on `kind`), `StartOp`, `SetOp`, `MetricOp`, `DeviationOp`, `FinishOp`, `syncOpSchema: z.ZodType<SyncOp>`, `syncBatchSchema`, `newOpId(): string`. Every later task depends on these names.

- [ ] **Step 1: Write the failing test**

Create `tests/sync/ops.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run tests/sync/ops.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/sync/ops`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/sync/ops.ts`:

```ts
/**
 * The offline sync op format (ARCHITECTURE §9, "Offline model"; design spec §4).
 *
 * An op is one write the client made, addressed entirely by **slug and client ULID**.
 * Nothing here names a server id, because an op is created on a device that may never
 * have told the server this workout exists — the server resolves `exerciseSlug` and
 * `workoutClientId` when it replays (`$lib/sync/replay`).
 *
 * Two fields exist because deferring a write breaks assumptions the online-only actions
 * could safely make:
 *
 * - `startedAt` / `finishedAt` are the **client's** clock. The write layer stamps server
 *   time today, so a session logged on Tuesday and synced on Friday would be dated
 *   Friday — and the export's summary requires "first" and "latest" to be chronological
 *   (AGENTS.md, Invariants). The client clock is trusted here because physical per-user
 *   isolation means a skewed one can corrupt nobody else's data.
 * - `planVersionId` travels with the start op. Resolving the plan's *current* version at
 *   replay time would rebind a queued workout to a version it never ran under, breaking
 *   §8's guarantee that a workout is bound to the version it was logged under.
 *
 * `setClientId` on a `scope: "set"` metric addresses its set the same way. No component
 * logs a set-scope metric today, but the alternative — posting back the `setLogId` the
 * server returns — cannot survive offline, so the format admits it from the start rather
 * than changing the day the feature lands.
 */

import { monotonicFactory } from "ulidx";
import { z } from "zod";

const ulid = monotonicFactory();

/** A fresh client-side ULID: the op's identity, and the row's `client_id`. */
export function newOpId(): string {
  return ulid();
}

const opId = z.string().min(1);

const isoTimestamp = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { error: "expected an ISO timestamp" });

const startOpSchema = z.strictObject({
  kind: z.literal("start"),
  id: opId,
  workoutClientId: opId,
  planVersionId: z.string().min(1),
  sessionKey: z.string().min(1),
  startedAt: isoTimestamp,
});

const setOpSchema = z.strictObject({
  kind: z.literal("set"),
  id: opId,
  workoutClientId: opId,
  exerciseSlug: z.string().min(1),
  setNo: z.number().int().positive(),
  side: z.enum(["left", "right"]).optional(),
  reps: z.number().int().nonnegative().optional(),
  weightKg: z.number().nonnegative().optional(),
  durationS: z.number().int().nonnegative().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
});

const metricOpSchema = z.strictObject({
  kind: z.literal("metric"),
  id: opId,
  workoutClientId: opId,
  scope: z.enum(["set", "exercise", "session"]),
  exerciseSlug: z.string().min(1).optional(),
  setClientId: opId.optional(),
  metricKey: z.string().min(1),
  valueNum: z.number().optional(),
  valueText: z.string().optional(),
});

const deviationOpSchema = z.strictObject({
  kind: z.literal("deviation"),
  id: opId,
  workoutClientId: opId,
  exerciseSlug: z.string().min(1),
  deviationKind: z.enum(["skip", "substitute", "add_set", "drop_set", "stop_red_flag"]),
  reasonCode: z.string().min(1).optional(),
  note: z.string().optional(),
  substituteExerciseSlug: z.string().min(1).optional(),
});

const finishOpSchema = z.strictObject({
  kind: z.literal("finish"),
  id: opId,
  workoutClientId: opId,
  status: z.enum(["completed", "partial", "stopped"]),
  note: z.string().optional(),
  finishedAt: isoTimestamp,
});

export const syncOpSchema = z.discriminatedUnion("kind", [
  startOpSchema,
  setOpSchema,
  metricOpSchema,
  deviationOpSchema,
  finishOpSchema,
]);

export const syncBatchSchema = z.strictObject({
  ops: z.array(syncOpSchema).min(1).max(500),
});

export type StartOp = z.infer<typeof startOpSchema>;
export type SetOp = z.infer<typeof setOpSchema>;
export type MetricOp = z.infer<typeof metricOpSchema>;
export type DeviationOp = z.infer<typeof deviationOpSchema>;
export type FinishOp = z.infer<typeof finishOpSchema>;
export type SyncOp = z.infer<typeof syncOpSchema>;
export type SyncBatch = z.infer<typeof syncBatchSchema>;
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run tests/sync/ops.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Verify and commit**

```bash
npx prettier --write src/lib/sync/ops.ts tests/sync/ops.test.ts
npm run verify
git add src/lib/sync/ops.ts tests/sync/ops.test.ts
git commit -m "feat(sync): define the offline op format"
```

---

### Task 2: The outbox queue

**Files:**
- Create: `src/lib/sync/queue.ts`
- Create: `tests/sync/queue.test.ts`

**Interfaces:**
- Consumes: `SyncOp` from Task 1.
- Produces: `OutboxRecord`, `OutboxStore` (interface), `SyncStatus`, `AckResponse`, `planBatch(pending, limit): SyncOp[]`, `applyAck(batch, ack): { ackIds: string[]; quarantine: { id: string; error: string }[] }`.

The store is an *interface* here and nothing in this file imports IndexedDB — the batching and ack rules are the part worth testing, and they test in milliseconds without a browser.

- [ ] **Step 1: Write the failing test**

Create `tests/sync/queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyAck, planBatch } from "../../src/lib/sync/queue";
import type { SyncOp } from "../../src/lib/sync/ops";

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
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run tests/sync/queue.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/sync/queue`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/sync/queue.ts`:

```ts
/**
 * The outbox queue's rules, as pure functions over plain data (design spec §3, §6).
 *
 * Nothing here touches IndexedDB. The storage adapter is an interface (`OutboxStore`,
 * implemented by `$lib/sync/idb`) so the two decisions worth getting right — which ops
 * go in a batch, and what an ack means — are unit-testable without a browser.
 *
 * The ordering rule is load-bearing rather than cosmetic. Ops are ULIDs, so sorting by
 * `id` is chronological, and `logMetric` is documented as relying on it: two corrections
 * to the same metric delivered out of order would land on the earlier answer.
 */

import type { SyncOp } from "./ops";

/** An op as the outbox holds it: the op, plus whether it is still deliverable. */
export type OutboxRecord = {
  op: SyncOp;
  state: "pending" | "quarantined";
  /** Why it was quarantined. Shown to the user; never a reason to delete the record. */
  error?: string;
};

/** What the flush loop needs of a store. `$lib/sync/idb` implements it for real. */
export interface OutboxStore {
  append(op: SyncOp): Promise<void>;
  pending(): Promise<SyncOp[]>;
  ack(ids: readonly string[]): Promise<void>;
  quarantine(entries: readonly { id: string; error: string }[]): Promise<void>;
  forWorkout(workoutClientId: string): Promise<OutboxRecord[]>;
  counts(): Promise<{ pending: number; quarantined: number }>;
}

/** What the server says came of a batch. */
export type AckResponse = {
  applied: string[];
  failed: { id: string; error: string }[];
};

/** What the sync banner renders from. */
export type SyncStatus = {
  pending: number;
  quarantined: number;
  state: "idle" | "syncing" | "offline" | "needs-auth" | "error";
};

/** The default batch size. Large enough that a whole session leaves in one request. */
export const BATCH_LIMIT = 100;

/**
 * The next ops to send, oldest first. Sorting here rather than trusting the store means
 * the ordering guarantee holds whatever an IndexedDB cursor happens to return.
 */
export function planBatch(pending: readonly SyncOp[], limit: number = BATCH_LIMIT): SyncOp[] {
  return [...pending].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, limit);
}

/**
 * Resolve a server ack against the batch that produced it.
 *
 * Two rules, both about not losing data. An op the server said *nothing* about stays
 * pending — silence is not success, and a truncated or partial response must cost a
 * retry rather than a workout. And an id that was not in the batch is ignored entirely,
 * so a confused or replayed response can never ack an op that has not been sent.
 */
export function applyAck(
  batch: readonly SyncOp[],
  ack: AckResponse,
): { ackIds: string[]; quarantine: { id: string; error: string }[] } {
  const sent = new Set(batch.map((op) => op.id));
  return {
    ackIds: ack.applied.filter((id) => sent.has(id)),
    quarantine: ack.failed.filter((entry) => sent.has(entry.id)),
  };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run tests/sync/queue.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify and commit**

```bash
npx prettier --write src/lib/sync/queue.ts tests/sync/queue.test.ts
npm run verify
git add src/lib/sync/queue.ts tests/sync/queue.test.ts
git commit -m "feat(sync): add the outbox queue's batching and ack rules"
```

---

### Task 3: Ops to `WorkoutHistory`

The runner rebuilds its ledger from the outbox using the *existing* `hydrateSession`. This task is the projection that makes that possible, and it is why no reconstruction logic is written twice.

**Files:**
- Create: `src/lib/sync/history.ts`
- Create: `tests/sync/history.test.ts`

**Interfaces:**
- Consumes: `SyncOp` (Task 1); `WorkoutHistory`, `WorkoutSetRow`, `WorkoutDeviationRow`, `WorkoutMetricRow` from `$lib/session/resume`.
- Produces: `historyFromOps(ops: readonly SyncOp[]): WorkoutHistory`.

- [ ] **Step 1: Write the failing test**

Create `tests/sync/history.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { historyFromOps } from "../../src/lib/sync/history";
import { hydrateSession, type HydratableSession } from "../../src/lib/session/resume";
import type { SyncOp } from "../../src/lib/sync/ops";

const W = "01JZ000000000000000000000W";

const session: HydratableSession = {
  blocks: [
    {
      key: "main",
      type: "straight",
      tracking: "logged",
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
      { kind: "metric", id: "01", workoutClientId: W, scope: "session", metricKey: "energy", valueNum: 7 },
      { kind: "metric", id: "02", workoutClientId: W, scope: "set", setClientId: "aa", metricKey: "rpe", valueNum: 8 },
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
      { kind: "finish", id: "09", workoutClientId: W, status: "completed", finishedAt: "2026-09-08T09:00:00.000Z" },
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
      { kind: "deviation", id: "02", workoutClientId: W, exerciseSlug: "row", deviationKind: "skip", reasonCode: "time" },
    ];

    const hydration = hydrateSession(session, historyFromOps(ops));
    expect(hydration.loggedSets).toHaveLength(1);
    expect(hydration.skipped).toEqual(["main:row"]);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run tests/sync/history.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/sync/history`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/sync/history.ts`:

```ts
/**
 * The outbox, projected into the shape `$lib/session/resume` already consumes
 * (design spec §5).
 *
 * This is the hinge of the offline design. `workoutHistoryFor` reads the server's rows
 * back joined to their slug and ordered by ULID; an op log holds slugs and ULIDs
 * natively. So the local rebuild and the server resume feed *the same* pure
 * reconstruction, and the two can produce the same ledger by construction rather than by
 * two implementations agreeing — the failure mode AGENTS.md warns about wherever the
 * same derivation exists twice.
 *
 * Start and finish ops describe the workout row, not its history, so they project to
 * nothing here. Set-scope metrics reference a `set_log` rather than the workout and are
 * excluded for the same reason `metricValuesFor` excludes them server-side.
 */

import type {
  WorkoutDeviationRow,
  WorkoutHistory,
  WorkoutMetricRow,
  WorkoutSetRow,
} from "../session/resume";
import type { SyncOp } from "./ops";

export function historyFromOps(ops: readonly SyncOp[]): WorkoutHistory {
  const ordered = [...ops].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const sets: WorkoutSetRow[] = [];
  const deviations: WorkoutDeviationRow[] = [];
  const metrics: WorkoutMetricRow[] = [];

  for (const op of ordered) {
    switch (op.kind) {
      case "set":
        sets.push({
          id: op.id,
          exerciseSlug: op.exerciseSlug,
          setNo: op.setNo,
          side: op.side ?? null,
          reps: op.reps ?? null,
          weightKg: op.weightKg ?? null,
          durationS: op.durationS ?? null,
          difficulty: op.difficulty ?? null,
        });
        break;
      case "deviation":
        deviations.push({
          id: op.id,
          exerciseSlug: op.exerciseSlug,
          kind: op.deviationKind,
          substituteSlug: op.substituteExerciseSlug ?? null,
        });
        break;
      case "metric":
        if (op.scope === "set") break;
        metrics.push({
          id: op.id,
          scope: op.scope,
          metricKey: op.metricKey,
          valueNum: op.valueNum ?? null,
          valueText: op.valueText ?? null,
        });
        break;
      case "start":
      case "finish":
        break;
    }
  }

  return { sets, deviations, metrics };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run tests/sync/history.test.ts`
Expected: PASS, 4 tests. If `hydrateSession`'s `HydratableSession` import path or block field names differ from the test above, fix the *test* to match `src/lib/session/resume.ts` — that module is settled and this task adapts to it.

- [ ] **Step 5: Verify and commit**

```bash
npx prettier --write src/lib/sync/history.ts tests/sync/history.test.ts
npm run verify
git add src/lib/sync/history.ts tests/sync/history.test.ts
git commit -m "feat(sync): project the outbox into the resume layer's row shape"
```

---

### Task 4: Server replay and the sync endpoint

**Superseded by the Tasks 1-5 final review's fix wave** (`fix(sync): close four gaps the
whole-branch review found`, dispatched after Task 5). The code sketches below are the
historical starting point, not the final shape: `replayOps` no longer takes a `planId`
parameter (each op resolves its own plan — see `requirePlanForWorkout` and
`getPlanIdForVersion` in the real `src/lib/sync/replay.ts`), and `AckResponse` gained a
`pending` field alongside `applied`/`failed`. Tasks 1-5 are already built and committed;
read the actual files under `src/lib/sync/` and `src/lib/db/` rather than transcribing this
section if implementing anything new against them.

**Files:**
- Modify: `src/lib/db/workout.ts` — export two client-id resolvers
- Create: `src/lib/sync/replay.ts`
- Create: `src/routes/api/sync/+server.ts`
- Create: `tests/sync/replay.test.ts`
- Create: `tests/server/sync-route.test.ts`

**Interfaces:**
- Consumes: `SyncOp`, `syncBatchSchema` (Task 1); `AckResponse` (Task 2); the existing `startWorkout`, `finishWorkout`, `logSet`, `logMetric`, `logDeviation`.
- Produces: `resolveWorkoutIdByClientId(userDb, clientId): string | undefined`, `resolveSetLogIdByClientId(userDb, clientId): string | undefined`, `replayOps(userDb, planId, ops): AckResponse`.

- [ ] **Step 1: Write the failing test**

Create `tests/sync/replay.test.ts`. It follows the setup in `tests/db/workout.test.ts` exactly — a real `openUserDb` over a temp dir with the fixture imported:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { getPlanBySlug } from "../../src/lib/db/read";
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
  let planId: string;
  let planVersionId: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-replay-test-"));
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
    const ack = replayOps(userDb, planId, [start(), set("02", 1), set("03", 2)]);
    expect(ack.applied).toEqual(["01", "02", "03"]);
    expect(ack.failed).toEqual([]);

    const rows = userDb.db.prepare("SELECT COUNT(*) AS n FROM set_log").get() as { n: number };
    expect(rows.n).toBe(2);
  });

  it("stamps the workout with the client's clock, not the server's", () => {
    replayOps(userDb, planId, [start()]);
    const row = userDb.db.prepare("SELECT started_at FROM workout WHERE client_id = ?").get(W) as {
      started_at: string;
    };
    expect(row.started_at).toBe("2026-09-08T08:00:00.000Z");
  });

  it("binds the workout to the version the op names, not the plan's current one", () => {
    replayOps(userDb, planId, [start()]);
    const row = userDb.db
      .prepare("SELECT plan_version_id FROM workout WHERE client_id = ?")
      .get(W) as { plan_version_id: string };
    expect(row.plan_version_id).toBe(planVersionId);
  });

  it("is idempotent — replaying the same batch writes nothing new", () => {
    const ops = [start(), set("02", 1), set("03", 2)];
    replayOps(userDb, planId, ops);
    const second = replayOps(userDb, planId, ops);

    expect(second.applied).toEqual(["01", "02", "03"]);
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

    const ack = replayOps(userDb, planId, [start(), ghost, set("03", 1)]);
    expect(ack.applied).toEqual(["01", "03"]);
    expect(ack.failed).toHaveLength(1);
    expect(ack.failed[0].id).toBe("02");

    const rows = userDb.db.prepare("SELECT COUNT(*) AS n FROM set_log").get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it("retries — rather than quarantines — a set whose workout has not arrived yet", () => {
    const ack = replayOps(userDb, planId, [set("02", 1)]);
    expect(ack.applied).toEqual([]);
    expect(ack.failed).toEqual([]);
  });

  it("finishes a workout with the client's completion time", () => {
    replayOps(userDb, planId, [
      start(),
      { kind: "finish", id: "09", workoutClientId: W, status: "completed", finishedAt: "2026-09-08T09:12:00.000Z" },
    ]);
    const row = userDb.db
      .prepare("SELECT status, completed_at FROM workout WHERE client_id = ?")
      .get(W) as { status: string; completed_at: string };
    expect(row.status).toBe("completed");
    expect(row.completed_at).toBe("2026-09-08T09:12:00.000Z");
  });

  it("resolves a set-scope metric through the set's client id", () => {
    replayOps(userDb, planId, [
      start(),
      set("02", 1),
      { kind: "metric", id: "03", workoutClientId: W, scope: "set", setClientId: "02", metricKey: "rpe", valueNum: 8 },
    ]);
    const row = userDb.db
      .prepare("SELECT mv.value_num AS v FROM metric_value mv JOIN set_log s ON s.id = mv.set_log_id WHERE s.client_id = ?")
      .get("02") as { v: number };
    expect(row.v).toBe(8);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run tests/sync/replay.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/sync/replay`.

- [ ] **Step 3: Export the two client-id resolvers**

In `src/lib/db/workout.ts`, there is already a private `selectByClientId(userDb, table, clientId)`. Add two exported wrappers beneath it — replay needs to address a workout and a set by the identity the client knows:

```ts
/**
 * Resolve a workout by the client-generated id its start op carried (phase 6).
 *
 * `startWorkout` already answers this for the op that creates the row, but ops for one
 * workout can span several batches, so a later batch's set has to find a workout that a
 * previous request created.
 */
export function resolveWorkoutIdByClientId(userDb: UserDb, clientId: string): string | undefined {
  return selectByClientId(userDb, "workout", clientId);
}

/** Resolve a `set_log` row by its client id, for a `scope: 'set'` metric op. */
export function resolveSetLogIdByClientId(userDb: UserDb, clientId: string): string | undefined {
  return selectByClientId(userDb, "set_log", clientId);
}
```

- [ ] **Step 4: Write the replay module**

Create `src/lib/sync/replay.ts`:

```ts
/**
 * Server-side replay of a client's outbox batch (design spec §6).
 *
 * Thin by design: `$lib/db/workout` has been idempotent on `client_id` since phase 4 and
 * was written as a replay target, so this module resolves an op's slugs and client ids
 * into server ids and calls the write layer. It adds no write of its own.
 *
 * ## Three rules, all about not losing data
 *
 * **Failures are per op, not per batch.** One undeliverable op must not roll back the
 * session logged around it, so each op is attempted individually and the batch commits
 * the ones that worked.
 *
 * **A permanent failure is quarantined; a transient one is retried.** An op naming a slug
 * the plan does not have can never succeed, and reporting it as `failed` lets the client
 * park it and tell the user. An op whose workout has not arrived yet is neither applied
 * nor failed — it is simply left out of the response, and `applyAck` keeps it pending.
 * Conflating the two either loses data or blocks the queue forever.
 *
 * **The client's clock wins.** `startedAt` and `finishedAt` go into the write layer's
 * injected `now`, so a workout is dated when it was trained rather than when it synced.
 */

import {
  finishWorkout,
  logDeviation,
  logMetric,
  logSet,
  resolveSetLogIdByClientId,
  resolveWorkoutIdByClientId,
  startWorkout,
} from "../db/workout";
import { getExerciseDefIdBySlug } from "../db/read";
import type { UserDb } from "../db/user-db";
import type { AckResponse } from "./queue";
import type { SyncOp } from "./ops";

/** Thrown for an op that can never succeed, and caught into `failed`. */
class PermanentOpError extends Error {}

/** Signals "not yet" — the op stays pending and is neither applied nor failed. */
class NotYetError extends Error {}

export function replayOps(userDb: UserDb, planId: string, ops: readonly SyncOp[]): AckResponse {
  const applied: string[] = [];
  const failed: { id: string; error: string }[] = [];

  const ordered = [...ops].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // IMMEDIATE for the same reason import uses it: reads that later writes depend on must
  // not race another connection (AGENTS.md, Invariants).
  userDb.db.transaction(() => {
    for (const op of ordered) {
      try {
        applyOp(userDb, planId, op);
        applied.push(op.id);
      } catch (err) {
        if (err instanceof NotYetError) continue;
        failed.push({ id: op.id, error: err instanceof Error ? err.message : "unknown error" });
      }
    }
  }).immediate();

  return { applied, failed };
}

function applyOp(userDb: UserDb, planId: string, op: SyncOp): void {
  switch (op.kind) {
    case "start":
      // The workout's replay identity is `workoutClientId`, not the start op's own id —
      // `id` and `workoutClientId` are independent fields on `StartOp` (ops.ts), and every
      // later "set"/"deviation"/"finish" op resolves the workout through `workoutClientId`
      // (`requireWorkout` below), so that is what must land in `workout.client_id`.
      startWorkout(userDb, {
        planVersionId: op.planVersionId,
        sessionKey: op.sessionKey,
        clientId: op.workoutClientId,
        now: new Date(op.startedAt),
      });
      return;

    case "set":
      logSet(userDb, {
        workoutId: requireWorkout(userDb, op.workoutClientId),
        exerciseDefId: requireExercise(userDb, planId, op.exerciseSlug),
        setNo: op.setNo,
        side: op.side,
        reps: op.reps,
        weightKg: op.weightKg,
        durationS: op.durationS,
        difficulty: op.difficulty,
        clientId: op.id,
      });
      return;

    case "deviation":
      logDeviation(userDb, {
        workoutId: requireWorkout(userDb, op.workoutClientId),
        exerciseDefId: requireExercise(userDb, planId, op.exerciseSlug),
        kind: op.deviationKind,
        reasonCode: op.reasonCode,
        note: op.note,
        substituteExerciseSlug: op.substituteExerciseSlug,
        clientId: op.id,
      });
      return;

    case "metric": {
      const workoutId = requireWorkout(userDb, op.workoutClientId);
      logMetric(userDb, {
        scope: op.scope,
        setLogId: op.scope === "set" ? requireSetLog(userDb, op.setClientId) : undefined,
        workoutId: op.scope === "set" ? undefined : workoutId,
        exerciseDefId:
          op.exerciseSlug === undefined
            ? undefined
            : requireExercise(userDb, planId, op.exerciseSlug),
        metricKey: op.metricKey,
        valueNum: op.valueNum,
        valueText: op.valueText,
        clientId: op.id,
      });
      return;
    }

    case "finish":
      finishWorkout(userDb, {
        workoutId: requireWorkout(userDb, op.workoutClientId),
        status: op.status,
        note: op.note,
        now: new Date(op.finishedAt),
      });
      return;
  }
}

/** Transient: a later batch may still deliver the start op. */
function requireWorkout(userDb: UserDb, workoutClientId: string): string {
  const id = resolveWorkoutIdByClientId(userDb, workoutClientId);
  if (!id) throw new NotYetError(`workout ${workoutClientId} has not been started here yet`);
  return id;
}

/** Transient for the same reason: the set op may be in a batch still to come. */
function requireSetLog(userDb: UserDb, setClientId: string | undefined): string {
  if (!setClientId) throw new PermanentOpError('a "set" scope metric needs setClientId');
  const id = resolveSetLogIdByClientId(userDb, setClientId);
  if (!id) throw new NotYetError(`set ${setClientId} has not arrived yet`);
  return id;
}

/** Permanent: a slug this plan does not define will not start existing on a retry. */
function requireExercise(userDb: UserDb, planId: string, slug: string): string {
  const id = getExerciseDefIdBySlug(userDb, planId, slug);
  if (!id) throw new PermanentOpError(`unknown exercise \`${slug}\` in this plan`);
  return id;
}
```

- [ ] **Step 5: Run the replay tests and verify they pass**

Run: `npx vitest run tests/sync/replay.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Write the endpoint's failing test**

Create `tests/server/sync-route.test.ts`, following the shape of `tests/server/first-run.test.ts` (read it first for how that suite fakes `locals` and a minimal `RequestEvent`-like object to drive a handler directly — `export-route.test.ts` tests `buildExportBundle`, a plain function, and has no such pattern). It must cover:

- an unauthenticated request gets **401**, and the response body says nothing about the data;
- a body failing `syncBatchSchema` gets **400** with a readable message, and writes nothing;
- a valid batch gets **200** with `{ applied, failed }`;
- posting the same batch twice leaves the row counts unchanged and still answers 200.

- [ ] **Step 7: Write the endpoint**

Create `src/routes/api/sync/+server.ts`:

```ts
/**
 * The offline sync endpoint (design spec §3, §6).
 *
 * One batch, one transaction, one ack. `src/lib/server/gate.ts` already answers a
 * non-navigation request with 401 rather than a 303, which is what lets a queued POST
 * survive an expired session instead of being replayed as a body-discarding GET.
 *
 * Nothing here throws. A handler that 500s tells a client nothing it can act on, and a
 * client that cannot tell "retry" from "give up" either loses the workout or retries
 * forever (ARCHITECTURE §4).
 */

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { getPlanBySlug } from "$lib/db/read";
import { syncBatchSchema } from "$lib/sync/ops";
import { replayOps } from "$lib/sync/replay";

export const POST: RequestHandler = async ({ request, locals, url }) => {
  if (!locals.user) return json({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body is not valid JSON." }, { status: 400 });
  }

  const parsed = syncBatchSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid batch." }, { status: 400 });
  }

  const planSlug = url.searchParams.get("plan");
  if (!planSlug) return json({ error: "Missing `plan`." }, { status: 400 });

  const userDb = getUserDbFor(locals.user.id);
  return json(replayOps(userDb, parsed.data.ops));
};
```

**This sketch is superseded.** The Tasks 1-5 final whole-branch review found that a single
caller-supplied `planId` wrongly quarantines a batch mixing ops from two plans, so the fix
(`fix(sync): close four gaps the whole-branch review found`) removed the `?plan=` query
param and `getPlanBySlug` call shown above entirely — `replayOps` now takes no `planId`
argument and resolves each op's plan itself. The code block above reflects the corrected,
actually-committed shape; the earlier drafts of `planSlug`/`getPlanBySlug`/`url.searchParams`
in this section are historical and should not be re-implemented.

- [ ] **Step 8: Run the endpoint tests and verify they pass**

Run: `npx vitest run tests/server/sync-route.test.ts`

- [ ] **Step 9: Verify and commit**

```bash
npx prettier --write src/lib/sync/replay.ts src/lib/db/workout.ts src/routes/api/sync/+server.ts tests/sync/replay.test.ts tests/server/sync-route.test.ts
npm run verify
git add src/lib/sync/replay.ts src/lib/db/workout.ts src/routes/api/sync tests/sync/replay.test.ts tests/server/sync-route.test.ts
git commit -m "feat(sync): replay an outbox batch through the workout write layer"
```

---

### Task 5: Property tests on replay

ROADMAP phase 6 and ARCHITECTURE §12 both name these as a condition of the phase being done: *any subset of the queue, in any order, produces no duplicate sets and no data loss.*

**Files:**
- Modify: `package.json` — add `fast-check` to `devDependencies`
- Create: `tests/sync/replay.property.test.ts`

**Interfaces:**
- Consumes: `replayOps` (Task 4).
- Produces: nothing. This task is a gate, not an API.

- [ ] **Step 1: Add the dependency**

```bash
npm install --save-dev fast-check
```

- [ ] **Step 2: Write the property tests**

Create `tests/sync/replay.property.test.ts`. Every property opens and closes its **own** database inside the property body, so runs cannot leak into each other, and uses `{ numRuns: 50 }` to stay inside the "a few seconds" budget `npm run verify` promises.

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { importPlan } from "../../src/lib/db/import-plan";
import { openUserDb, type UserDb } from "../../src/lib/db/user-db";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { replayOps } from "../../src/lib/sync/replay";
import type { SyncOp } from "../../src/lib/sync/ops";

const ROOT = new URL("../../", import.meta.url);
const fixtureMd = fs.readFileSync(new URL("fixtures/plans/home-dumbbell-v1.md", ROOT), "utf8");
const NOW = new Date("2026-09-08T08:00:00Z");
const W = "01JZ000000000000000000000W";

/** Slugs the fixture really defines — an op naming anything else is a *permanent*
 * failure, which is a different property and belongs in the example-based suite. */
const SLUGS = ["goblet-squat", "dead-bug", "bird-dog"] as const;

type Harness = { userDb: UserDb; planId: string; planVersionId: string; dataDir: string };

function freshDb(): Harness {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-replay-prop-"));
  const userDb = openUserDb(dataDir, "user-1", { now: NOW });
  const parsed = parsePlanDocument(fixtureMd);
  if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
  const result = importPlan(userDb, { parsed, now: NOW });
  if (!result.ok) throw new Error(result.message);
  return { userDb, planId: result.plan_id, planVersionId: result.plan_version_id, dataDir };
}

function dispose(harness: Harness): void {
  harness.userDb.close();
  fs.rmSync(harness.dataDir, { recursive: true, force: true });
}

/** A ULID-shaped, sortable id from an index. */
function opId(n: number): string {
  return `01JZ${String(n).padStart(22, "0")}`;
}

function setLogClientIds(userDb: UserDb): string[] {
  const rows = userDb.db
    .prepare("SELECT client_id FROM set_log ORDER BY client_id")
    .all() as { client_id: string }[];
  return rows.map((row) => row.client_id);
}

/** A valid op log for one workout: a start, some sets, and maybe a finish. */
const opLog = (planVersionId: string) =>
  fc
    .array(
      fc.record({
        slug: fc.constantFrom(...SLUGS),
        reps: fc.integer({ min: 1, max: 20 }),
        weightKg: fc.integer({ min: 0, max: 40 }),
      }),
      { minLength: 1, maxLength: 20 },
    )
    .map((sets): SyncOp[] => [
      {
        kind: "start",
        id: opId(0),
        workoutClientId: W,
        planVersionId,
        sessionKey: "A",
        startedAt: "2026-09-08T08:00:00.000Z",
      },
      ...sets.map(
        (set, index): SyncOp => ({
          kind: "set",
          id: opId(index + 1),
          workoutClientId: W,
          exerciseSlug: set.slug,
          setNo: index + 1,
          reps: set.reps,
          weightKg: set.weightKg,
          difficulty: "medium",
        }),
      ),
    ]);

describe("replay properties", () => {
  it("is order-independent: a shuffled delivery lands the same rows as an ordered one", () => {
    const reference = freshDb();
    try {
      fc.assert(
        fc.property(opLog(reference.planVersionId), fc.array(fc.nat()), (ops, shuffleSeed) => {
          const ordered = freshDb();
          const shuffled = freshDb();
          try {
            const permuted = [...ops].sort(
              (a, b) => ((shuffleSeed[ops.indexOf(a)] ?? 0) - (shuffleSeed[ops.indexOf(b)] ?? 0)),
            );
            replayOps(ordered.userDb, ordered.planId, ops);
            replayOps(shuffled.userDb, shuffled.planId, permuted);
            expect(setLogClientIds(shuffled.userDb)).toEqual(setLogClientIds(ordered.userDb));
          } finally {
            dispose(ordered);
            dispose(shuffled);
          }
        }),
        { numRuns: 50 },
      );
    } finally {
      dispose(reference);
    }
  });

  it("never duplicates a set, however many times a batch is re-delivered", () => {
    const reference = freshDb();
    try {
      fc.assert(
        fc.property(
          opLog(reference.planVersionId),
          fc.integer({ min: 1, max: 4 }),
          (ops, redeliveries) => {
            const harness = freshDb();
            try {
              for (let i = 0; i < redeliveries; i += 1) {
                replayOps(harness.userDb, harness.planId, ops);
              }
              const ids = setLogClientIds(harness.userDb);
              const expected = ops.filter((op) => op.kind === "set").map((op) => op.id).sort();
              expect(ids).toEqual(expected);
            } finally {
              dispose(harness);
            }
          },
        ),
        { numRuns: 50 },
      );
    } finally {
      dispose(reference);
    }
  });

  it("loses nothing when the log is split into arbitrary batches", () => {
    const reference = freshDb();
    try {
      fc.assert(
        fc.property(
          opLog(reference.planVersionId),
          fc.integer({ min: 1, max: 5 }),
          (ops, batchSize) => {
            const harness = freshDb();
            try {
              for (let i = 0; i < ops.length; i += batchSize) {
                replayOps(harness.userDb, harness.planId, ops.slice(i, i + batchSize));
              }
              const expected = ops.filter((op) => op.kind === "set").map((op) => op.id).sort();
              expect(setLogClientIds(harness.userDb)).toEqual(expected);
            } finally {
              dispose(harness);
            }
          },
        ),
        { numRuns: 50 },
      );
    } finally {
      dispose(reference);
    }
  });

  it("invents nothing: a prefix of the log writes only that prefix's rows", () => {
    const reference = freshDb();
    try {
      fc.assert(
        fc.property(opLog(reference.planVersionId), fc.nat(), (ops, cut) => {
          const harness = freshDb();
          try {
            const prefix = ops.slice(0, (cut % ops.length) + 1);
            replayOps(harness.userDb, harness.planId, prefix);
            const expected = prefix.filter((op) => op.kind === "set").map((op) => op.id).sort();
            expect(setLogClientIds(harness.userDb)).toEqual(expected);
          } finally {
            dispose(harness);
          }
        }),
        { numRuns: 50 },
      );
    } finally {
      dispose(reference);
    }
  });
});
```

**On the third property:** a batch containing a set op but not yet the start op must leave that set *pending*, not failed — so a later batch delivers it. If the property fails because a set was dropped when its start op was in an earlier batch, that is `replay.ts`'s `NotYetError` handling being wrong, and it is exactly the defect this property exists to catch.

- [ ] **Step 3: Run them and verify they pass**

Run: `npx vitest run tests/sync/replay.property.test.ts`
Expected: PASS. **A failure here is a real defect in Task 4, not a flaky test** — record fast-check's counterexample, fix `replay.ts`, and re-run. Do not weaken a property to make it pass.

- [ ] **Step 4: Verify and commit**

```bash
npx prettier --write tests/sync/replay.property.test.ts
npm run verify
git add package.json package-lock.json tests/sync/replay.property.test.ts
git commit -m "test(sync): prove replay is order-independent and never duplicates a set"
```

---

### Task 6: The IndexedDB outbox and the flush loop

**Files:**
- Create: `src/lib/sync/idb.ts`
- Create: `src/lib/sync/client.svelte.ts`
- Modify: `src/routes/+layout.svelte` — the sync banner

**Interfaces:**
- Consumes: `OutboxStore`, `OutboxRecord`, `SyncStatus`, `AckResponse`, `planBatch`, `applyAck`, `BATCH_LIMIT` (Task 2); `SyncOp` (Task 1).
- Produces: `openOutbox(): Promise<OutboxStore>` from `idb.ts`; and from `client.ts`: `logWrite(planSlug: string, op: SyncOp): Promise<void>`, `opsForWorkout(workoutClientId: string): Promise<SyncOp[]>`, `flushNow(planSlug: string): Promise<void>`, `startSyncLoop(planSlug: string): () => void`, and `syncStatus` — a **mutable `$state` object**, not a function. The banner reads its fields directly.

There is no unit test for these two modules — they are the browser boundary, and Task 9's e2e specs are their test. Keep them thin for exactly that reason: any logic worth asserting belongs in `queue.ts`, which has one.

- [ ] **Step 1: Write the IndexedDB store**

Create `src/lib/sync/idb.ts`:

```ts
/**
 * The outbox, on IndexedDB (design spec §5). The `OutboxStore` implementation the flush
 * loop actually runs against; `$lib/sync/queue` holds the rules it obeys.
 *
 * This is the store that makes a browser kill survivable — `sessionStorage`, which phase
 * 4 used to hold the workout's client id, dies with the tab.
 *
 * **There is no `clear()`, and there never will be.** Ops leave this store exactly one
 * way: the server acknowledged them. A quarantined op is updated in place and kept, so
 * the user can be told about it (ARCHITECTURE §4 — a 401 must not cost queued data, and
 * neither must anything else).
 */

import type { OutboxRecord, OutboxStore } from "./queue";
import type { SyncOp } from "./ops";

const DB_NAME = "gain-sync";
const DB_VERSION = 1;
const STORE = "outbox";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "op.id" });
        store.createIndex("workoutClientId", "op.workoutClientId", { unique: false });
        store.createIndex("state", "state", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(store: IDBObjectStore, request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function openOutbox(): Promise<OutboxStore> {
  const db = await open();

  return {
    async append(op: SyncOp): Promise<void> {
      const record: OutboxRecord = { op, state: "pending" };
      await run(tx(db, "readwrite"), tx(db, "readwrite").put(record) as IDBRequest<IDBValidKey>);
    },

    async pending(): Promise<SyncOp[]> {
      const store = tx(db, "readonly");
      const all = await run(store, store.getAll() as IDBRequest<OutboxRecord[]>);
      return all.filter((record) => record.state === "pending").map((record) => record.op);
    },

    async ack(ids: readonly string[]): Promise<void> {
      const store = tx(db, "readwrite");
      await Promise.all(ids.map((id) => run(store, store.delete(id) as IDBRequest<undefined>)));
    },

    async quarantine(entries: readonly { id: string; error: string }[]): Promise<void> {
      const store = tx(db, "readwrite");
      for (const entry of entries) {
        const existing = await run(store, store.get(entry.id) as IDBRequest<OutboxRecord>);
        if (!existing) continue;
        await run(
          store,
          store.put({
            ...existing,
            state: "quarantined",
            error: entry.error,
          }) as IDBRequest<IDBValidKey>,
        );
      }
    },

    async forWorkout(workoutClientId: string): Promise<OutboxRecord[]> {
      const store = tx(db, "readonly");
      const index = store.index("workoutClientId");
      return run(index, index.getAll(workoutClientId) as IDBRequest<OutboxRecord[]>);
    },

    async counts(): Promise<{ pending: number; quarantined: number }> {
      const store = tx(db, "readonly");
      const all = await run(store, store.getAll() as IDBRequest<OutboxRecord[]>);
      return {
        pending: all.filter((record) => record.state === "pending").length,
        quarantined: all.filter((record) => record.state === "quarantined").length,
      };
    },
  };
}
```

**Note on the transaction helper:** the sketch above calls `tx()` twice in `append`, which opens two transactions. Fix it while implementing — hold one `IDBObjectStore` per method — and make sure every method awaits inside a single transaction's lifetime, because an IndexedDB transaction auto-commits as soon as the microtask queue drains. This is the one place in the phase where the obvious code is subtly wrong.

- [ ] **Step 2: Write the flush loop**

Create `src/lib/sync/client.svelte.ts`:

```ts
/**
 * The client half of sync (design spec §3, §8): append locally, flush when we can, and
 * never let a failure cost the user a set.
 *
 * `logWrite` deliberately does **not** await the network. A set must land and re-render
 * the ledger at the speed of IndexedDB — the runner's whole premise is that logging is
 * one tap between sets, and a tap that waits on a round trip is the online-only design
 * this phase exists to replace.
 */

import { applyAck, planBatch, type OutboxStore, type SyncStatus, type AckResponse } from "./queue";
import type { SyncOp } from "./ops";
import { openOutbox } from "./idb";
import { historyFromOps } from "./history";

export const syncStatus: SyncStatus = $state({ pending: 0, quarantined: 0, state: "idle" });

let storePromise: Promise<OutboxStore> | undefined;
let flushing = false;
let backoffMs = 1_000;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function store(): Promise<OutboxStore> {
  storePromise ??= openOutbox();
  return storePromise;
}

async function refreshCounts(): Promise<void> {
  const counts = await (await store()).counts();
  syncStatus.pending = counts.pending;
  syncStatus.quarantined = counts.quarantined;
}

export async function logWrite(planSlug: string, op: SyncOp): Promise<void> {
  await (await store()).append(op);
  await refreshCounts();
  void flushNow(planSlug);
}

/** Every op recorded for one workout on this device — what the runner rebuilds from. */
export async function opsForWorkout(workoutClientId: string): Promise<SyncOp[]> {
  const records = await (await store()).forWorkout(workoutClientId);
  return records.map((record) => record.op);
}

export async function flushNow(planSlug: string): Promise<void> {
  if (flushing || syncStatus.state === "needs-auth") return;
  flushing = true;

  try {
    const outbox = await store();
    const batch = planBatch(await outbox.pending());
    if (batch.length === 0) {
      syncStatus.state = "idle";
      await refreshCounts();
      return;
    }

    syncStatus.state = "syncing";

    // No `?plan=` on this URL: the endpoint resolves each op's plan itself, from the op's
    // own `planVersionId` (a `start` op) or its already-resolved workout's plan version
    // (every other kind) — never from a caller-supplied hint. A batch mixing ops from two
    // plans (the user switched plans while offline) is why: a single URL-level plan would
    // wrongly quarantine whichever plan wasn't named in it as "unknown exercise", which is
    // exactly the bug the Tasks 1-5 final review found and fixed (`replayOps` no longer
    // takes a `planId` parameter at all — see `src/lib/sync/replay.ts`).
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ops: batch }),
    });

    /**
     * The one response that must not look like a failure to retry. The gate answers a
     * fetch with 401 rather than a 303 precisely so this branch can exist (§4): hold
     * everything, stop trying, and let the banner ask for a sign-in.
     */
    if (response.status === 401) {
      syncStatus.state = "needs-auth";
      return;
    }

    if (!response.ok) {
      scheduleRetry(planSlug, "error");
      return;
    }

    const ack = (await response.json()) as AckResponse;
    const { ackIds, quarantine } = applyAck(batch, ack);
    if (ackIds.length > 0) await outbox.ack(ackIds);
    if (quarantine.length > 0) await outbox.quarantine(quarantine);

    backoffMs = 1_000;
    await refreshCounts();
    syncStatus.state = syncStatus.pending > 0 ? "syncing" : "idle";

    // More than one batch's worth was queued — keep going rather than waiting for the
    // next online event, which may never come if we are already online.
    if (syncStatus.pending > 0 && ackIds.length > 0) {
      flushing = false;
      void flushNow(planSlug);
      return;
    }
  } catch {
    scheduleRetry(planSlug, navigator.onLine ? "error" : "offline");
  } finally {
    flushing = false;
  }
}

function scheduleRetry(planSlug: string, state: SyncStatus["state"]): void {
  syncStatus.state = state;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => void flushNow(planSlug), backoffMs);
  backoffMs = Math.min(backoffMs * 2, 60_000);
}

/** Flush on reconnect and whenever the tab comes back — the phone-lock case. */
export function startSyncLoop(planSlug: string): () => void {
  const onOnline = () => {
    backoffMs = 1_000;
    void flushNow(planSlug);
  };
  const onOffline = () => {
    syncStatus.state = "offline";
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") void flushNow(planSlug);
  };

  addEventListener("online", onOnline);
  addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisible);
  void flushNow(planSlug);

  return () => {
    removeEventListener("online", onOnline);
    removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisible);
    clearTimeout(retryTimer);
  };
}
```

**Two things to check while implementing.** `$state` in a `.ts` file requires the file to be compiled by the Svelte compiler — if `svelte-check` rejects it, rename to `client.svelte.ts`, which is the Svelte 5 convention for runes outside a component, and update the import. And `historyFromOps` is imported above but used by Task 7, not here; drop the import if this module does not need it.

- [ ] **Step 3: Add the banner to the layout**

Modify `src/routes/+layout.svelte`. Render nothing when `state` is `idle` and `pending` is 0. Otherwise a single compact strip:

| State | Copy |
|---|---|
| `syncing` | `Syncing N workouts…` |
| `offline` | `Offline — N saved on this device` |
| `needs-auth` | `Signed out — your workout is saved. Reconnect to sync` + a link to `/login` |
| `error` | `Sync failed — N saved on this device. Retrying` |
| quarantined > 0 | `N entries could not sync` (always shown alongside the above) |

It goes in the layout rather than the runner because a queue can be pending on any screen, and a sync state visible only where it was created is a sync state nobody sees. Colour: never `var(--red)` — that belongs to the plan's symptom framework (UI-DECISIONS §5).

- [ ] **Step 4: Check it compiles and the layout still renders**

Run: `npm run check && npm run dev`
Open the app, confirm the banner is absent on a clean load and that no console error appears.

- [ ] **Step 5: Verify and commit**

```bash
npx prettier --write src/lib/sync/idb.ts src/lib/sync/client.svelte.ts src/routes/+layout.svelte
npm run verify
git add src/lib/sync/idb.ts src/lib/sync/client.svelte.ts src/routes/+layout.svelte
git commit -m "feat(sync): persist the outbox to IndexedDB and flush it on reconnect"
```

---

### Task 7: Rewire the runner onto the write layer

The largest task, and the one that makes the previous six matter. **Read `docs/UI-DECISIONS.md` §1, §2, §7 and §8 before starting** — none of the runner's behaviour changes here, only where its writes go.

**Files:**
- Modify: `src/routes/plan/[slug]/session/[key]/+page.server.ts`
- Modify: `src/routes/plan/[slug]/session/[key]/+page.svelte`
- Modify: `LogStrip.svelte`, `MetricRow.svelte`, `DeviationSheet.svelte`, `ExerciseCard.svelte`, `WrapUpSheet.svelte`

**Interfaces:**
- Consumes: `logWrite`, `opsForWorkout`, `startSyncLoop` (Task 6); `historyFromOps` (Task 3); `newOpId` (Task 1); the existing `hydrateSession`.
- Produces: nothing new. This task removes API rather than adding it.

- [ ] **Step 1: Expose the plan version id to the client**

In `+page.server.ts`'s `load`, add `planVersionId: version.id` to the returned object. The start op carries it so a revision imported while a workout is queued cannot rebind that workout to a version it never ran under (design spec §4).

- [ ] **Step 2: Replace the mount handshake with a local one**

In `+page.svelte`, delete the `sessionStorage` block (`storageKey`, `mintAndStore`, the `workoutClientId` seed) and the `?/start` form and its `$effect`. Replace with:

- `workoutClientId` read from IndexedDB for this `(planSlug, sessionKey)`, minted with `newOpId()` and a `start` op appended if absent;
- on mount, `hydrateSession(data.session, historyFromOps(await opsForWorkout(workoutClientId)))`, poured into the existing maps by the existing `applyHydration`;
- `startSyncLoop(data.planSlug)` in an `$effect` that returns its teardown.

`workoutId` — the server id — disappears from the component entirely. Nothing client-side needs it once ops address the workout by client id.

- [ ] **Step 3: Replace each form submission with a `logWrite` call**

Per component, replacing the `<form method="POST" action="?/…" use:enhance={…}>` wrapper with a `<button type="button" onclick={…}>` that builds the op and awaits `logWrite`:

| Component | Was | Becomes |
|---|---|---|
| `LogStrip.svelte` | `?/logSet` | `{ kind: "set", … }` |
| `MetricRow.svelte` | `?/logMetric` | `{ kind: "metric", … }` |
| `DeviationSheet.svelte` | `?/logDeviation` | `{ kind: "deviation", … }` |
| `ExerciseCard.svelte` | `?/logDeviation` | `{ kind: "deviation", … }` |
| `WrapUpSheet.svelte` | `?/finish` | `{ kind: "finish", … }` |
| `+page.svelte` (red flag) | `?/finish` | `{ kind: "finish", status: "stopped", … }` |

Four rules carry over from the phase-4 review and must survive this rewrite:

- **Client state is what was submitted, never what was pre-filled.** `LogStrip` currently reads the logged values off the outgoing `FormData`; it must now read them off the op object it builds. Same values, same rule.
- **A control that can write before its precondition exists must be disabled.** The `submitting` guard against a double-tap stays.
- **Errors render next to the control that failed**, through the same single `actionError` surface. A quarantined op is an error the user must see.
- **Recording an intent is not honouring it.** A skip still collapses and advances; a substitution still re-renders the slot. None of that logic moves.

- [ ] **Step 4: Delete the dead actions**

Remove `logSet`, `logMetric`, `logDeviation` and `finish` from `+page.server.ts`'s `actions`, along with `requireText`/`optionalText`/`optionalNumber`/`formText` and `DEVIATION_KINDS` if nothing else uses them. Keep `start` and `hydrateResumedWorkout`: that path is the fallback for a device with no local record (design spec §5).

Two write paths, one of them dead, is how the next agent picks the wrong one.

- [ ] **Step 5: Run the existing runner e2e suite**

Run: `npx playwright install chromium` (once), then `npm run test:e2e`
Expected: PASS. The eight existing runner specs assert *behaviour*, not transport, so they are the regression net for this rewrite. **If one fails, the rewrite is wrong — do not edit the spec to match the new behaviour** unless it asserts on a form element that no longer exists, in which case change only the selector.

- [ ] **Step 6: Verify and commit**

```bash
npx prettier --write "src/routes/plan/[slug]/session/[key]/*.svelte" "src/routes/plan/[slug]/session/[key]/+page.server.ts"
npm run verify
git add "src/routes/plan/[slug]/session/[key]"
git commit -m "refactor(session): write through the outbox instead of form actions"
```

---

### Task 8: Service worker, offline page and manifest

**Three gaps found executing this task that the sketch below doesn't cover — all fixed in
the real commit (`983ec12`):**

1. `/offline` must be a public path (`src/lib/server/gate.ts`). The service worker's
   `install` step precaches it via `cache.addAll`, which fails its *entire* call on any
   single non-OK response — and install runs on every page load, including `/login`
   before a session exists. Left gated, the very first page anyone ever loads 401s on
   `/offline` mid-precache and the whole app shell silently never caches, for every user,
   forever.
2. `/offline`'s own HTML must be precached explicitly, alongside `build`/`files` — those
   two arrays are the built JS/CSS bundle, not rendered routes, so `/offline` is nowhere
   in them. Without this, the navigation fallback finds nothing cached on a first-ever
   offline visit and falls through to a bare `"Offline"` text response instead of the real
   page.
3. `src/service-worker.ts` needs its own TypeScript project (`tsconfig.worker.json`,
   repo root) and its own `eslint.config.js` block. SvelteKit's generated
   `.svelte-kit/tsconfig.json` deliberately excludes the file from the main app project —
   its WebWorker global scope conflicts with the app's DOM lib — which means `tsc --noEmit`
   silently never checks it at all (confirmed by deliberately breaking it and watching
   `typecheck` stay green) and `eslint`'s type-aware rules hard-fail trying to find it in a
   project that excludes it by design. `npm run typecheck` now runs `tsc` twice.

**Files:**
- Create: `src/service-worker.ts`
- Create: `src/lib/sync/precache.ts`
- Create: `src/routes/offline/+page.svelte`
- Create: `tsconfig.worker.json` (repo root) — see gap 3 above
- Modify: `static/site.webmanifest`
- Modify: `src/routes/+page.svelte` — call `precacheSessions` on mount
- Modify: `src/lib/server/gate.ts` — add `/offline` to `isPublicPath` (gap 1)
- Modify: `package.json` — `typecheck` runs both `tsc` invocations (gap 3)
- Modify: `eslint.config.js` — a dedicated block for `src/service-worker.ts` (gap 3)

**Interfaces:**
- Consumes: `$service-worker`'s `build`, `files`, `version` (worker only).
- Produces: `precacheSessions(planSlug: string, sessionKeys: readonly string[]): Promise<void>` from `src/lib/sync/precache.ts`. Nothing in `src/service-worker.ts` is importable by the app — that asymmetry is the reason `precache.ts` exists at all.

- [ ] **Step 1: Write the service worker**

Create `src/service-worker.ts`. SvelteKit registers `src/service-worker.*` automatically in a production build — no registration code is needed.

```ts
/**
 * The app-shell cache and the offline read path (design spec §7).
 *
 * Runs in the service worker context, not the app: nothing here can be imported by a
 * page, and `$service-worker` exists only in this file. That is why precaching route
 * data is driven by a `postMessage` from the app (see `$lib/sync/precache`) rather than
 * by an exported function — the cache name embeds `version`, and only this file knows it.
 */

/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { build, files, version } from "$service-worker";

const sw = self as unknown as ServiceWorkerGlobalScope;

/**
 * Version-keyed, and this is the load-bearing part. A precached `__data.json` is
 * SvelteKit's own client-navigation payload, so its shape belongs to the build that
 * emitted it; a cache that outlived its build would serve a new app an old payload and
 * fail quietly. Keying on `version` and dropping every other cache on activate means a
 * deploy invalidates the data entries along with the shell (design spec §2, decision 7).
 */
const CACHE = `gain-${version}`;
const PRECACHED = [...build, ...files];

sw.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHED))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => sw.clients.claim()),
  );
});

/** The app asks for a plan's session payloads to be cached while it still has a network. */
sw.addEventListener("message", (event) => {
  const data = event.data as { type?: string; urls?: string[] } | undefined;
  if (data?.type !== "precache" || !Array.isArray(data.urls)) return;
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(data.urls!)));
});

sw.addEventListener("fetch", (event) => {
  const request = event.request;

  /**
   * Never cache a write. A cached `/api/sync` response would ack ops the server never
   * saw, which is the one route by which this design could silently lose a workout.
   */
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;

  // Content-hashed, so a cache hit can never be stale.
  if (PRECACHED.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then((cache) => cache.match(request) as Promise<Response>));
    return;
  }

  event.respondWith(networkFirst(request));
});

async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);

  try {
    const response = await fetch(request);
    // Only a real answer is worth keeping; a 404 or a 500 must not become the cached
    // version of a page that works again tomorrow.
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (request.mode === "navigate") {
      const offline = await cache.match("/offline");
      if (offline) return offline;
    }
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

export {};
```

- [ ] **Step 2: Precache the session route data from the app**

Create `src/lib/sync/precache.ts`. This lives in the app, not the worker: a page cannot import `$service-worker`, so it hands the worker a list of URLs and the worker caches them under its own versioned name.

```ts
/**
 * Ask the service worker to cache a plan's session payloads while a network still exists
 * (design spec §7).
 *
 * `/plan/<slug>/session/<key>/__data.json` is exactly what SvelteKit fetches on a
 * client-side navigation to that route, so caching it makes the session *startable*
 * offline rather than only continuable — and it requires no change to `+page.server.ts`.
 */
export async function precacheSessions(
  planSlug: string,
  sessionKeys: readonly string[],
): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  const registration = await navigator.serviceWorker.ready;
  const worker = registration.active;
  if (!worker) return;

  worker.postMessage({
    type: "precache",
    urls: sessionKeys.map((key) => `/plan/${planSlug}/session/${key}/__data.json`),
  });
}
```

Call it from the plan overview page's mount, passing every session key of the current plan. Four URLs for the fixture.

- [ ] **Step 3: Write the offline page**

Create `src/routes/offline/+page.svelte`. Honest and short: GAIN needs a connection for this screen; logged sessions are saved on this device and will sync; a link back to the plan. No spinner, no retry button that cannot know when to stop.

- [ ] **Step 4: Fix the manifest**

Modify `static/site.webmanifest` — add `"id": "/"`, `"start_url": "/"`, `"scope": "/"`, and `"purpose": "any maskable"` on the 512 icon.

- [ ] **Step 5: Verify the build emits the worker**

```bash
npm run build
ls build/client/service-worker.js
```
Expected: the file exists. If it does not, the worker is not being picked up and nothing in Task 9 will pass.

- [ ] **Step 6: Verify and commit**

```bash
npx prettier --write src/service-worker.ts "src/routes/offline/+page.svelte"
npm run verify
git add src/service-worker.ts src/routes/offline static/site.webmanifest
git commit -m "feat(pwa): precache the app shell and the runner's session data"
```

---

### Task 9: The offline e2e harness and the survival specs

**Files:**
- Modify: `playwright.config.ts`
- Modify: `e2e/env.ts` — a built-server port and origin
- Create: `e2e/offline-session.spec.ts`, `e2e/offline-survival.spec.ts`, `e2e/offline-auth.spec.ts`

- [ ] **Step 1: Add the offline project**

The existing three projects run against `vite dev`, where `$service-worker`'s `build` manifest is empty — **no offline test can pass there.** The offline project needs a real build.

In `e2e/env.ts`, add the built server's port and origin beside the existing constants:

```ts
/** The offline project's own server: a real `vite build` + `node build`, because
 * `$service-worker`'s `build` manifest is empty under `vite dev` and the precache would
 * be a no-op. Separate port so it can run alongside the dev server. */
export const E2E_BUILT_PORT = E2E_PORT + 1;
export const E2E_BUILT_BASE_URL = `http://localhost:${E2E_BUILT_PORT}`;
```

Then in `playwright.config.ts`, make `webServer` an array and add the project:

```ts
webServer: [
  {
    // ...the existing dev-server entry, unchanged
  },
  {
    command: `npm run build && node build`,
    url: E2E_BUILT_BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATA_DIR: E2E_DATA_DIR,
      GAIN_DEV_USER: E2E_DEV_USER,
      PORT: String(E2E_BUILT_PORT),
      // adapter-node requires ORIGIN outside dev, and a wrong one is the #1 cause of
      // login loops behind a proxy (svelte.config.js).
      ORIGIN: E2E_BUILT_BASE_URL,
      // NODE_ENV is deliberately NOT set to production. `src/lib/server/config.ts`
      // refuses GAIN_DEV_USER when NODE_ENV=production, and these specs need both the
      // dev-user bypass and a real build. The refusal keys on NODE_ENV rather than on
      // being a built bundle, so leaving it unset satisfies both — do not "fix" this by
      // weakening the refusal, which exists so a production deploy cannot ship an auth
      // bypass.
    },
  },
],

projects: [
  // ...the three existing viewport projects, each gaining:
  //   testIgnore: /offline-.*\.spec\.ts/
  {
    name: "offline",
    testMatch: /offline-.*\.spec\.ts/,
    use: {
      browserName: "chromium",
      baseURL: E2E_BUILT_BASE_URL,
      viewport: { width: 360, height: 800 },
    },
  },
],
```

Specs needing IndexedDB to survive a context close use `launchPersistentContext` with a per-test user-data directory rather than the project's default context.

- [ ] **Step 2: The airplane-mode spec**

`e2e/offline-session.spec.ts`: load the plan overview online (so the session data precaches), `context.setOffline(true)`, navigate to a session, log it end to end — sets, a deviation, the wrap-up — assert every interaction is instant and no error banner appears, then `context.setOffline(false)`, wait for the banner to clear, and assert through the export screen that the sets are present with the right loads and reps.

That last assertion is the one that matters: it proves the data crossed both the offline boundary *and* the sync boundary intact.

- [ ] **Step 3: The survival spec**

`e2e/offline-survival.spec.ts`, on a persistent context: log half a session, close the context, reopen it against the same user-data directory, navigate back to the session, and assert the ledger, cursor, skips and swaps are exactly as they were. That is the browser kill ARCHITECTURE §9 says only IndexedDB can survive.

Add a `visibilitychange` case as the phone-lock proxy. Container restart is a documented manual check in the plan's close-out unless this project self-manages its server.

- [ ] **Step 4: The token-expiry spec**

`e2e/offline-auth.spec.ts`: log part of a session, expire the session cookie, log another set, and assert the `needs-auth` banner appears **and the set is still in the ledger**. Then restore the session and assert the queue drains and the sets reach the server. Losing a workout to a token expiry is the failure §4 calls unacceptable, so this spec is the one that proves it does not happen.

- [ ] **Step 5: Run the offline project**

Run: `npx playwright test --project=offline`
Expected: PASS. Then `npm run test:e2e` to confirm the other three projects still pass.

- [ ] **Step 6: Verify and commit**

```bash
npx prettier --write playwright.config.ts e2e/env.ts e2e/offline-*.spec.ts
npm run verify
git add playwright.config.ts e2e
git commit -m "test(e2e): walk a session through airplane mode, a browser kill and a token expiry"
```

---

### Task 10: Status close-out

Three files state where the build has got to, and a stale one costs the next agent a rebuild of something that already exists (AGENTS.md, "Keep the status current").

**Files:**
- Modify: `README.md` — the status banner
- Modify: `docs/ROADMAP.md` — tick all six phase-6 items with their SHAs; move the "next" marker to phase 7; set phase 6's state to Done in the phase table
- Modify: `AGENTS.md` — the "Current state" paragraph, and a new "What the phase-6 review changed" subsection if the build surfaced rules worth carrying forward
- Modify: `docs/ARCHITECTURE.md` §12 — the build-order table's phase-6 row

- [ ] **Step 1: Update all four**

Match each document's own voice: ROADMAP is a checklist and reads like one; ARCHITECTURE and AGENTS argue a case and their prose should not be flattened into bullets.

- [ ] **Step 2: Write down the two deliberate limitations**

Both are decisions, not oversights, and an undocumented decision gets "fixed" by the next agent.

**Prefill can be stale during an offline streak** (design spec §2, decision 5). Pre-fill is read from the server's `set_log` rows, so a second session logged offline before the first has synced is pre-filled from the last *synced* performance. It self-corrects on any reconnect. This is accepted rather than solved because prefill is a suggestion and the ledger stores what was submitted, never what was offered — so a stale prefill cannot reach the export or the reviewing AI, unlike every other number in this phase. It belongs in `AGENTS.md` under Invariants, next to the export-summary rule it contrasts with.

**A quarantined op is held, never dropped, and never retried forever** (design spec §6). The rule and its reasoning go in the same place.

- [ ] **Step 3: Record the manual check**

If container restart was not automated in Task 9, add it to `todo.md` as a manual verification step with the exact commands, rather than leaving the roadmap's "explicit survival test" item ticked on three conditions out of four.

- [ ] **Step 4: Verify and commit**

```bash
npm run verify
git add README.md docs/ROADMAP.md docs/ARCHITECTURE.md AGENTS.md todo.md
git commit -m "docs: close phase 6 — the offline PWA ships"
```

---

## Watch for

- **A quarantined op is invisible unless the banner says so.** The whole design turns on never losing data; an op parked in IndexedDB that nobody is told about is lost in every sense that matters to the user.
- **`applyAck` treating silence as success** would delete an op the server never applied. The test for it is in Task 2; do not relax it.
- **Caching a POST.** A cached `/api/sync` response acks ops the server never saw, which is the one way this design can silently lose a workout.
- **The runner's e2e suite is the regression net for Task 7.** Editing a spec to match new behaviour, rather than fixing the behaviour, discards the only proof that the rewrite preserved UI-DECISIONS.
- **`weight_kg` stays total kilograms** through the op format, the replay and the export. No `paired` field, no per-side doubling (AGENTS.md, Invariants).
