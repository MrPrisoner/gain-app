/**
 * What the one app-wide sync banner says, as a pure function of the sync status.
 *
 * Split out of `+layout.svelte` so it can be unit-tested: the banner is the only thing
 * that ever tells a user their workout is not on the server yet, and "held, never
 * dropped" (ARCHITECTURE §4) is only true if the holding is visible. A wrong or empty
 * string here is exactly the invisible-quarantine failure the sync design exists to
 * prevent, and it is not something the e2e suite can enumerate cheaply.
 *
 * Returns the empty string when there is nothing to say — idle, nothing queued, nothing
 * quarantined — which is the common case and renders no banner at all.
 */

import type { SyncStatus } from "./queue";

export function bannerText(status: SyncStatus): string {
  if (status.resetNotice) return "Your data was reset by the administrator.";

  const { state, pending, quarantined } = status;
  const parts: string[] = [];

  switch (state) {
    case "syncing":
      parts.push(`Syncing ${pending} workout${pending === 1 ? "" : "s"}…`);
      break;
    case "offline":
      parts.push(`Offline — ${pending} saved on this device`);
      break;
    case "needs-auth":
      parts.push("Signed out — your workout is saved. Reconnect to sync");
      break;
    case "error":
      parts.push(`Sync failed — ${pending} saved on this device. Retrying`);
      break;
    case "idle":
      if (pending > 0) parts.push(`${pending} saved on this device`);
      break;
  }

  if (quarantined > 0) {
    parts.push(`${quarantined} ${quarantined === 1 ? "entry" : "entries"} could not sync`);
  }

  return parts.join(" — ");
}
