<script lang="ts">
  import type { MetricDef } from "$lib/contract/schema";
  import MetricRow from "$lib/components/MetricRow.svelte";
  import IconSunrise from "~icons/lucide/sunrise";
  import IconX from "~icons/lucide/x";

  /**
   * The next_morning metric prompt (ARCHITECTURE §9, "Post-session"; design spec §6).
   * Reuses `MetricRow` verbatim rather than re-implementing metric rendering — every
   * metric here is session-scope, exactly what `MetricRow` already expects.
   */
  let {
    planSlug,
    sessionKey,
    workoutClientId,
    metrics,
    onDismiss,
  }: {
    planSlug: string;
    sessionKey: string;
    workoutClientId: string;
    metrics: readonly MetricDef[];
    onDismiss: (workoutClientId: string) => void;
  } = $props();

  let selected = $state<Record<string, number | string>>({});
  let error = $state<string | undefined>();

  function onSelected(key: string, value: number | string): void {
    selected = { ...selected, [key]: value };
    if (metrics.every((m) => selected[m.key] !== undefined)) onDismiss(workoutClientId);
  }
</script>

<section class="card next-morning">
  <div class="head">
    <h2><IconSunrise />How did yesterday's {sessionKey} feel this morning?</h2>
    <button
      type="button"
      class="dismiss-btn"
      aria-label="Dismiss"
      onclick={() => onDismiss(workoutClientId)}
    >
      <IconX />
    </button>
  </div>
  {#each metrics as metric (metric.key)}
    <MetricRow
      {metric}
      {planSlug}
      {workoutClientId}
      selected={selected[metric.key]}
      onSelected={(value) => onSelected(metric.key, value)}
      onError={(message) => (error = message)}
    />
  {/each}
  {#if error}<p class="error">{error}</p>{/if}
</section>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: 1.25rem;
    margin-top: 1.25rem;
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .dismiss-btn {
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: var(--muted);
    padding: 0.3rem;
    min-width: 2.75rem;
    min-height: 2.75rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .error {
    background: var(--raised);
    color: var(--text);
    font-weight: 700;
    border-radius: var(--r-xs);
    padding: 0.6rem 0.75rem;
    margin: 0.5rem 0 0;
  }
</style>
