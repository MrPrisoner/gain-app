import { describe, expect, it } from "vitest";
import { bannerText } from "../../src/lib/sync/banner";
import type { SyncStatus } from "../../src/lib/sync/queue";

function status(over: Partial<SyncStatus> = {}): SyncStatus {
  return { pending: 0, quarantined: 0, state: "idle", resetNotice: false, ...over };
}

describe("bannerText", () => {
  it("says nothing when there is nothing to say", () => {
    expect(bannerText(status())).toBe("");
  });

  it("counts a queue that is still on this device while idle", () => {
    expect(bannerText(status({ pending: 3 }))).toBe("3 saved on this device");
  });

  it("pluralises the syncing count", () => {
    expect(bannerText(status({ state: "syncing", pending: 1 }))).toBe("Syncing 1 workout…");
    expect(bannerText(status({ state: "syncing", pending: 2 }))).toBe("Syncing 2 workouts…");
  });

  it("names the failure without implying the data is gone", () => {
    expect(bannerText(status({ state: "offline", pending: 2 }))).toBe(
      "Offline — 2 saved on this device",
    );
    expect(bannerText(status({ state: "error", pending: 2 }))).toBe(
      "Sync failed — 2 saved on this device. Retrying",
    );
    expect(bannerText(status({ state: "needs-auth", pending: 2 }))).toContain(
      "your workout is saved",
    );
  });

  /** ARCHITECTURE §4: a quarantined op the banner does not surface is the data loss the
   * whole sync design exists to prevent, just moved one step later. It has to appear
   * alongside every other state, not instead of one. */
  it("always surfaces quarantined entries, whatever else is happening", () => {
    expect(bannerText(status({ quarantined: 1 }))).toBe("1 entry could not sync");
    expect(bannerText(status({ state: "syncing", pending: 2, quarantined: 3 }))).toBe(
      "Syncing 2 workouts… — 3 entries could not sync",
    );
  });

  it("lets the reset notice replace everything else", () => {
    expect(bannerText(status({ resetNotice: true, pending: 9, quarantined: 9 }))).toBe(
      "Your data was reset by the administrator.",
    );
  });
});
