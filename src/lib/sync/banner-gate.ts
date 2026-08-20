/**
 * When the sync banner is allowed on screen, as opposed to what it says (`banner.ts`).
 *
 * The banner renders in flow, above `<main>`, so every appearance and disappearance
 * reflows the page under the user's thumb. A healthy online write goes idle → pending →
 * syncing → idle in roughly a tenth of a second — `logWrite` appends and refreshes the
 * counts before `flushNow` has even set `"syncing"` — so tapping a symptom score used to
 * mount two different banners and unmount them again inside 100ms. That reads as the
 * layout glitching, not as information.
 *
 * The fix is to gate visibility on *time*, not on state: say nothing until the condition
 * has held long enough to be worth saying, and once said, leave it up long enough to be
 * read. What survives that gate is exactly the case the message was for — a sync that is
 * genuinely slow, or one that has genuinely failed. A healthy sync now says nothing at
 * all, which is correct: the user has nothing to do about it.
 *
 * Deliberately plain TypeScript with a callback rather than a `.svelte.ts` holding
 * `$state`: `vitest.config.ts` runs without the SvelteKit plugin, so a rune here would
 * be untestable, and the timing rules below are the part worth testing.
 */

export type BannerGateOptions = {
  /** How long a non-empty message must hold before it is shown at all. */
  appearAfterMs: number;
  /** How long a shown message stays up, even if the condition clears immediately. */
  minVisibleMs: number;
  onChange: (text: string) => void;
};

export type BannerGate = {
  /** The latest text the banner *would* say — "" for nothing to say. */
  update: (text: string) => void;
  dispose: () => void;
};

export function createBannerGate({
  appearAfterMs,
  minVisibleMs,
  onChange,
}: BannerGateOptions): BannerGate {
  let latest = "";
  let visible = "";
  let shownAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clear(): void {
    clearTimeout(timer);
    timer = undefined;
  }

  function show(): void {
    clear();
    shownAt = Date.now();
    visible = latest;
    onChange(visible);
  }

  function hide(): void {
    clear();
    visible = "";
    onChange("");
  }

  return {
    update(text: string): void {
      latest = text;

      if (visible !== "") {
        // Already up. A new message replaces the old one in place — the banner is one
        // slot, and re-running the appear delay for a state change would hide a "sync
        // failed" behind the "syncing" it replaced.
        if (text !== "") {
          clear();
          if (text !== visible) {
            visible = text;
            onChange(visible);
          }
          return;
        }

        // Nothing left to say. Hide once it has been readable for `minVisibleMs`, so a
        // banner that appears a moment before the queue drains does not flash and
        // vanish — that is the same glitch as before, just rarer and harder to explain.
        if (timer !== undefined) return;
        const elapsed = Date.now() - shownAt;
        if (elapsed >= minVisibleMs) hide();
        else timer = setTimeout(hide, minVisibleMs - elapsed);
        return;
      }

      if (text === "") {
        // The condition cleared before it was ever worth showing. Cancelling rather than
        // pausing is what makes a burst of quick writes stay silent: each one restarts
        // the wait instead of accumulating towards it.
        clear();
        return;
      }

      // Non-empty and not yet visible. Keep any wait already running — the condition has
      // been continuously non-empty, and restarting on every text change would mean a
      // status that keeps changing (a queue draining in batches) never appears at all.
      if (timer === undefined) timer = setTimeout(show, appearAfterMs);
    },

    dispose(): void {
      clear();
    },
  };
}
