/**
 * The client half of sync (design spec §3, §8): append locally, flush when we can, and
 * never let a failure cost the user a set.
 *
 * `logWrite` deliberately does **not** await the network. A set must land and re-render
 * the ledger at the speed of IndexedDB — the runner's whole premise is that logging is
 * one tap between sets, and a tap that waits on a round trip is the online-only design
 * this phase exists to replace.
 *
 * `.svelte.ts` rather than `.ts`: `syncStatus` uses `$state` outside a component, which
 * needs the Svelte compiler to see this file.
 */

import { applyAck, planBatch, type AckResponse, type OutboxStore, type SyncStatus } from "./queue";
import type { SyncOp } from "./ops";
import { openOutbox } from "./idb";

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
