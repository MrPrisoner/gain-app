<script module lang="ts">
  export function formatSeconds(total: number): string {
    const m = Math.floor(Math.abs(total) / 60);
    const s = Math.abs(total) % 60;
    const sign = total < 0 ? "-" : "";
    return `${sign}${m}:${String(s).padStart(2, "0")}`;
  }
</script>

<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { trapFocus } from "$lib/actions/focus-trap";
  import {
    extendRest,
    restPhaseAt,
    startRestTimer,
    type RestSpec,
    type RestTimerState,
  } from "$lib/session/rest-timer";

  let {
    spec,
    upNext,
    onSkip,
  }: {
    spec: RestSpec;
    /** What is coming next (UI-DECISIONS §4), pre-formatted by the caller the same way
     * `LogStrip`'s `context`/`lastPerformance` are — this component does no formatting
     * of its own, only rendering. */
    upNext: { label: string; target: string; isLast: boolean };
    onSkip: () => void;
  } = $props();

  // One-shot capture at mount, the same pattern the home screen documents with
  // `untrack()` (`src/routes/+page.svelte`): the parent mounts a fresh `RestTimer` for
  // every rest period (`{#if activeRest}`), so `spec` never changes under a live
  // instance — reading it reactively here would only add a dependency nothing needs.
  let timerState = $state<RestTimerState>(
    startRestTimer(
      untrack(() => spec),
      Date.now(),
    ),
  );
  let nowMs = $state(Date.now());

  const interval = setInterval(() => (nowMs = Date.now()), 250);
  onDestroy(() => clearInterval(interval));

  const phase = $derived(restPhaseAt(timerState, nowMs));

  // "Ranged rest is drawn honestly" (UI-DECISIONS §4): the track always spans 0..maxS,
  // shaded from minS..maxS only when the rest is genuinely ranged — a fixed rest has no
  // band to shade. `elapsedS` is derived uniformly across all three phases so the fill
  // position never has to special-case `counting_down`, whose `RestPhase` only carries a
  // countdown (`remainingS`), not the elapsed time itself.
  const bandMinS = $derived(timerState.spec.minS);
  const bandMaxS = $derived(timerState.spec.maxS);
  const isRanged = $derived(bandMinS !== bandMaxS);
  const elapsedS = $derived(
    phase.phase === "counting_down" ? bandMinS - phase.remainingS : phase.elapsedS,
  );
  const fillPct = $derived(Math.min(100, Math.max(0, (elapsedS / bandMaxS) * 100)));
  const bandStartPct = $derived((bandMinS / bandMaxS) * 100);

  // Wake lock (screen must stay on through rest, UI-DECISIONS §4 — you are reading this
  // from a mat at arm's length, not touching the screen to keep it awake). The request is
  // async and can resolve after the component has already been torn down (the user tapped
  // "start next set" before the promise settled); without the `cancelled` guard, a
  // late-resolving promise would assign into `wakeLock` *after* the effect's cleanup has
  // already run and released whatever it held at that time, leaking the lock for the rest
  // of the page's life. Checking `cancelled` in the `.then` callback closes that race: a
  // lock that arrives after teardown is released immediately instead of being kept.
  let wakeLock: WakeLockSentinel | undefined;
  $effect(() => {
    let cancelled = false;
    navigator.wakeLock?.request("screen").then(
      (lock) => {
        if (cancelled) {
          lock.release();
          return;
        }
        wakeLock = lock;
      },
      () => {
        /* wake lock is a nicety; unavailable on some browsers/contexts */
      },
    );
    return () => {
      cancelled = true;
      wakeLock?.release();
      wakeLock = undefined;
    };
  });

  function addThirty() {
    timerState = extendRest(timerState, 30);
  }
</script>

<!-- Final-review finding: this is a full-screen `position: fixed` overlay, so it is a modal
     dialog whether or not it was announced as one — and it was not. The exercise list and
     the log strip stay mounted underneath it, so before the trap a keyboard user could Tab
     straight past the overlay into effort keys they could not see and log a set during
     rest. Same treatment the wrap-up sheet and `DeviationSheet` got (UI-DECISIONS §8):
     `role="dialog"`/`aria-modal="true"`, `use:trapFocus` (see `$lib/actions/focus-trap`)
     to move focus in, cycle Tab within the overlay and restore focus on close, and Escape
     wired to the same deliberate escape the primary button already offers — dismiss rest
     early (`onSkip`), worded as "start the next set" or "finish up" depending on whether
     `upNext` says anything is actually coming. There is still no auto-dismiss
     (UI-DECISIONS §4): Escape is a tap, not a timeout.

     `role="timer"` moves down onto the readout it actually describes. It cannot stay on
     this element — one element has one role, and `dialog` is the one that matters for
     containment. -->
<div
  class="rest-overlay"
  role="dialog"
  aria-modal="true"
  aria-labelledby="rest-heading"
  use:trapFocus={{ onEscape: onSkip }}
>
  <!-- The dialog's own name and its focus landing point, following both sheets' pattern:
       `tabindex="-1"` keeps it focusable programmatically but out of the Tab cycle, and
       `data-trap-focus-heading` is what the action looks for. Naming the dialog by the
       clock and its phase ("1:15, Resting") is the honest answer to "what is this?". -->
  <div class="rest-state" id="rest-heading" tabindex="-1" data-trap-focus-heading>
    {#if phase.phase === "counting_down"}
      <span class="rest-time tabular" role="timer">{formatSeconds(phase.remainingS)}</span>
      <span class="rest-label" aria-live="polite">Resting</span>
    {:else if phase.phase === "in_band"}
      <span class="rest-time tabular" role="timer">{formatSeconds(phase.elapsedS)}</span>
      <span class="rest-label" aria-live="polite"
        >Ready — {formatSeconds(phase.bandMaxS - phase.elapsedS)} left in the window</span
      >
    {:else}
      <span class="rest-time tabular" role="timer">{formatSeconds(phase.elapsedS)}</span>
      <span class="rest-label" aria-live="polite">Over rest</span>
    {/if}
  </div>

  <div class="rest-track" aria-hidden="true">
    {#if isRanged}
      <div class="rest-band" style:left="{bandStartPct}%" style:width="{100 - bandStartPct}%"></div>
    {/if}
    <div class="rest-fill" style:width="{fillPct}%"></div>
  </div>

  <div class="rest-upnext">
    <span class="upnext-kicker">Up next</span>
    <span class="upnext-label">{upNext.label}</span>
    <span class="upnext-target tabular">{upNext.target}</span>
  </div>

  <div class="rest-actions">
    <button type="button" class="secondary" onclick={addThirty}>+30s</button>
    <button type="button" class="primary" onclick={onSkip}
      >{upNext.isLast ? "Finish up" : "Start next set"}</button
    >
  </div>
</div>

<style>
  .rest-overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: var(--ground);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 1.5rem;
  }
  .rest-state {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .rest-time {
    font-size: 4rem;
    font-weight: 800;
  }
  .rest-label {
    color: var(--muted);
  }

  /* The band track (UI-DECISIONS §4): a plain progress bar for a fixed rest, or — for a
     ranged one — a shaded region from `minS` to `maxS` behind it, so "ready" reads as a
     window rather than a finish line. The fill is the one moving, meaningful thing here
     and is always `--accent` (§5: colour is reserved for meaning, never a status light). */
  .rest-track {
    position: relative;
    width: min(20rem, 100%);
    height: 0.6rem;
    border-radius: var(--r-lg);
    background: var(--raised);
    border: 1px solid var(--line);
    overflow: hidden;
  }
  .rest-band {
    position: absolute;
    top: 0;
    bottom: 0;
    /* `left`/`width` come from the inline style — the band's start and extent depend on
       `minS`/`maxS`, which only the component instance knows. */
    background: var(--accent-soft);
  }
  .rest-fill {
    position: relative;
    height: 100%;
    background: var(--accent);
    border-radius: inherit;
    transition: width 0.2s linear;
  }

  .rest-upnext {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    text-align: center;
    max-width: 22rem;
  }
  .upnext-kicker {
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--dim);
  }
  .upnext-label {
    font-weight: 700;
  }
  .upnext-target {
    color: var(--muted);
    font-size: 0.9rem;
  }

  .rest-actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;
  }
  .rest-actions button {
    border: none;
    border-radius: var(--r-sm);
    padding: 0.9rem 1.5rem;
    font-weight: 700;
  }
  .primary {
    background: var(--accent);
    color: var(--accent-in);
  }
  .secondary {
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
  }
</style>
