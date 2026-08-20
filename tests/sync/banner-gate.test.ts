import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBannerGate } from "../../src/lib/sync/banner-gate";

const APPEAR = 700;
const MIN_VISIBLE = 1_500;

describe("createBannerGate", () => {
  let shown: string[];

  function gate() {
    return createBannerGate({
      appearAfterMs: APPEAR,
      minVisibleMs: MIN_VISIBLE,
      onChange: (text) => shown.push(text),
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    shown = [];
  });

  afterEach(() => vi.useRealTimers());

  /** The whole point: an online set log goes idle → pending → syncing → idle in about a
   * tenth of a second, and every one of those transitions used to mount and unmount a
   * banner that reflows the page under the user's thumb. */
  it("never shows a banner for a sync that resolves quickly", () => {
    const g = gate();
    g.update("1 saved on this device");
    vi.advanceTimersByTime(40);
    g.update("Syncing 1 workout…");
    vi.advanceTimersByTime(60);
    g.update("");
    vi.advanceTimersByTime(10_000);

    expect(shown).toEqual([]);
  });

  it("shows a banner once the condition has held long enough", () => {
    const g = gate();
    g.update("Syncing 1 workout…");
    vi.advanceTimersByTime(APPEAR - 1);
    expect(shown).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(shown).toEqual(["Syncing 1 workout…"]);
  });

  it("shows the latest text, not the text that started the wait", () => {
    const g = gate();
    g.update("Syncing 1 workout…");
    vi.advanceTimersByTime(300);
    g.update("Sync failed — 1 saved on this device. Retrying");
    vi.advanceTimersByTime(APPEAR);

    expect(shown).toEqual(["Sync failed — 1 saved on this device. Retrying"]);
  });

  /** A gap in the middle means the app was fine in the middle. The wait restarts rather
   * than accumulating, so a burst of quick syncs never adds up to a visible banner. */
  it("restarts the wait when the condition clears and returns", () => {
    const g = gate();
    g.update("Syncing 1 workout…");
    vi.advanceTimersByTime(APPEAR - 100);
    g.update("");
    g.update("Syncing 1 workout…");
    vi.advanceTimersByTime(APPEAR - 100);
    expect(shown).toEqual([]);

    vi.advanceTimersByTime(100);
    expect(shown).toEqual(["Syncing 1 workout…"]);
  });

  it("updates a visible banner immediately, without waiting again", () => {
    const g = gate();
    g.update("Syncing 2 workouts…");
    vi.advanceTimersByTime(APPEAR);
    g.update("Syncing 1 workout…");

    expect(shown).toEqual(["Syncing 2 workouts…", "Syncing 1 workout…"]);
  });

  /** Without this the flicker just moves to a rarer case: a banner that appears at the
   * 700ms mark and is acked at 710ms would flash for ten milliseconds. */
  it("keeps a banner up for a minimum time once it has appeared", () => {
    const g = gate();
    g.update("Syncing 1 workout…");
    vi.advanceTimersByTime(APPEAR);
    g.update("");

    vi.advanceTimersByTime(MIN_VISIBLE - 1);
    expect(shown).toEqual(["Syncing 1 workout…"]);

    vi.advanceTimersByTime(1);
    expect(shown).toEqual(["Syncing 1 workout…", ""]);
  });

  it("cancels a pending hide when the condition returns", () => {
    const g = gate();
    g.update("Syncing 1 workout…");
    vi.advanceTimersByTime(APPEAR);
    g.update("");
    vi.advanceTimersByTime(100);
    g.update("Sync failed — 1 saved on this device. Retrying");
    vi.advanceTimersByTime(10_000);

    expect(shown).toEqual(["Syncing 1 workout…", "Sync failed — 1 saved on this device. Retrying"]);
  });

  it("hides immediately once the minimum has already elapsed", () => {
    const g = gate();
    g.update("Offline — 1 saved on this device");
    vi.advanceTimersByTime(APPEAR + MIN_VISIBLE + 5_000);
    g.update("");

    expect(shown).toEqual(["Offline — 1 saved on this device", ""]);
  });

  it("reports no change when the text has not changed", () => {
    const g = gate();
    g.update("Syncing 1 workout…");
    vi.advanceTimersByTime(APPEAR);
    g.update("Syncing 1 workout…");
    g.update("Syncing 1 workout…");

    expect(shown).toEqual(["Syncing 1 workout…"]);
  });

  it("drops its timers when disposed", () => {
    const g = gate();
    g.update("Syncing 1 workout…");
    g.dispose();
    vi.advanceTimersByTime(10_000);

    expect(shown).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
