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

export const syncStatus: SyncStatus = $state({
  pending: 0,
  quarantined: 0,
  state: "idle",
  resetNotice: false,
});

let storePromise: Promise<OutboxStore> | undefined;
let flushing = false;
let backoffMs = 1_000;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * The generation this browser tab believes its outbox was filled under (spec §7).
 * Seeded from `+layout.server.ts`'s `dataGeneration` on every load via `setGeneration` —
 * a page reload resets this module, so without seeding, the first flush after a reload
 * would default to 0 and either wrongly 409 a legitimate queue (this account was reset
 * long ago and has synced fine since) or wrongly let a genuinely stale queue through (this
 * tab has been open since before a reset). Seeding from the server's authoritative value
 * is the correct default either way; the 409 branch below is what corrects it when a
 * reset happens while this tab is already open.
 */
let currentGeneration = 0;

export function setGeneration(generation: number): void {
  currentGeneration = generation;
}

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
  // `retryTimer` set means a retry is already pending — including a `needs-auth` retry.
  // A 401 must not be a dead end: nothing else in this module ever transitions a
  // "needs-auth" state back to a retryable one, so an early return keyed on that state
  // (rather than on whether a retry is scheduled) would leave the queue stuck forever
  // the moment the session actually recovers, since nothing would be listening for that.
  if (flushing || retryTimer !== undefined) return;
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
      body: JSON.stringify({ ops: batch, generation: currentGeneration }),
    });

    if (response.status === 409) {
      // The account was reset. These ops describe data that no longer exists, so there
      // is nothing to reconcile — clear them and say so. This is the one place GAIN
      // discards local data, and it is narrow by construction: only the server, only on
      // an explicit generation mismatch (spec §7).
      const body = (await response.json().catch(() => null)) as {
        dataGeneration?: number;
      } | null;
      if (typeof body?.dataGeneration === "number") currentGeneration = body.dataGeneration;
      await outbox.clearAll();
      syncStatus.resetNotice = true;
      backoffMs = 1_000;
      await refreshCounts();
      syncStatus.state = "idle";
      return;
    }

    /**
     * The gate answers a fetch with 401 rather than a 303 precisely so this branch can
     * exist (§4): hold everything and let the banner ask for a sign-in — but still retry
     * on the same backoff as any other failure, because re-authenticating in this app
     * (dev bypass or OIDC) is a real navigation, and this module's state survives a
     * client-side route change back to this page. Without a scheduled retry, nothing
     * would ever notice the session came back.
     */
    if (response.status === 401) {
      scheduleRetry(planSlug, "needs-auth");
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
  retryTimer = setTimeout(() => {
    // Cleared before calling `flushNow`, not after — `flushNow`'s own guard checks
    // `retryTimer !== undefined`, so clearing it first is what lets this scheduled
    // attempt actually run instead of immediately bouncing off its own pending marker.
    retryTimer = undefined;
    void flushNow(planSlug);
  }, backoffMs);
  backoffMs = Math.min(backoffMs * 2, 60_000);
}

/** Cancels a pending backoff and flushes immediately — used by both `startSyncLoop`
 * listeners below, which are each a strong signal that a retry is worth trying right
 * away rather than waiting out whatever backoff a previous failure scheduled. */
function retryNow(planSlug: string): void {
  backoffMs = 1_000;
  clearTimeout(retryTimer);
  retryTimer = undefined;
  void flushNow(planSlug);
}

/** Flush on reconnect and whenever the tab comes back — the phone-lock case. */
export function startSyncLoop(planSlug: string): () => void {
  const onOnline = () => retryNow(planSlug);
  const onOffline = () => {
    syncStatus.state = "offline";
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") retryNow(planSlug);
  };

  addEventListener("online", onOnline);
  addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisible);
  void flushNow(planSlug);

  return () => {
    removeEventListener("online", onOnline);
    removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisible);
    // Clearing the timeout alone leaves `retryTimer` holding a stale, already-cancelled
    // handle. `flushNow`'s guard is `retryTimer !== undefined`, so a later caller (e.g.
    // another `startSyncLoop` on a different route) would bounce off a retry that isn't
    // actually pending. Reset it in the same step so the module returns to a clean state.
    clearTimeout(retryTimer);
    retryTimer = undefined;
  };
}
