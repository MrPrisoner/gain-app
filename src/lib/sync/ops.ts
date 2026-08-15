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
 *   (CLAUDE.md, Invariants). The client clock is trusted here because physical per-user
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

const activityOpSchema = z.strictObject({
  kind: z.literal("activity"),
  id: opId,
  activityKind: z.string().min(1),
  occurredAt: isoTimestamp,
  durationMin: z.number().int().nonnegative().optional(),
  intensity: z.string().min(1).optional(),
  note: z.string().optional(),
});

export const syncOpSchema = z.discriminatedUnion("kind", [
  startOpSchema,
  setOpSchema,
  metricOpSchema,
  deviationOpSchema,
  finishOpSchema,
  activityOpSchema,
]);

export const syncBatchSchema = z.strictObject({
  ops: z.array(syncOpSchema).min(1).max(500),
});

export type StartOp = z.infer<typeof startOpSchema>;
export type SetOp = z.infer<typeof setOpSchema>;
export type MetricOp = z.infer<typeof metricOpSchema>;
export type DeviationOp = z.infer<typeof deviationOpSchema>;
export type FinishOp = z.infer<typeof finishOpSchema>;
export type ActivityOp = z.infer<typeof activityOpSchema>;
export type SyncOp = z.infer<typeof syncOpSchema>;
export type SyncBatch = z.infer<typeof syncBatchSchema>;
