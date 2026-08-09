<script module lang="ts">
  export function formatSeconds(total: number): string {
    const m = Math.floor(Math.abs(total) / 60);
    const s = Math.abs(total) % 60;
    const sign = total < 0 ? "-" : "";
    return `${sign}${m}:${String(s).padStart(2, "0")}`;
  }
</script>

<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    extendRest,
    restPhaseAt,
    startRestTimer,
    type RestSpec,
    type RestTimerState,
  } from "$lib/session/rest-timer";

  let { spec, onDone, onSkip }: { spec: RestSpec; onDone: () => void; onSkip: () => void } =
    $props();
  void onDone;

  let timerState = $state<RestTimerState>(startRestTimer(spec, Date.now()));
  let nowMs = $state(Date.now());

  const interval = setInterval(() => (nowMs = Date.now()), 250);
  onDestroy(() => clearInterval(interval));

  const phase = $derived(restPhaseAt(timerState, nowMs));

  let wakeLock: WakeLockSentinel | undefined;
  $effect(() => {
    navigator.wakeLock?.request("screen").then(
      (lock) => (wakeLock = lock),
      () => {
        /* wake lock is a nicety; unavailable on some browsers/contexts */
      },
    );
    return () => wakeLock?.release();
  });

  function addThirty() {
    timerState = extendRest(timerState, 30);
  }
</script>

<div class="rest-overlay" role="timer">
  {#if phase.phase === "counting_down"}
    <span class="rest-time tabular">{formatSeconds(phase.remainingS)}</span>
    <span class="rest-label">Resting</span>
  {:else if phase.phase === "in_band"}
    <span class="rest-time tabular">{formatSeconds(phase.elapsedS)}</span>
    <span class="rest-label"
      >Ready — {formatSeconds(phase.bandMaxS - phase.elapsedS)} left in the window</span
    >
  {:else}
    <span class="rest-time tabular">{formatSeconds(phase.elapsedS)}</span>
    <span class="rest-label">Over rest</span>
  {/if}

  <div class="rest-actions">
    <button type="button" class="secondary" onclick={addThirty}>+30s</button>
    <button type="button" class="primary" onclick={onSkip}>Start next set</button>
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
  }
  .rest-time {
    font-size: 4rem;
    font-weight: 800;
  }
  .rest-label {
    color: var(--muted);
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
