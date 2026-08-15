<script lang="ts">
  import { SvelteMap } from "svelte/reactivity";
  import type { MetricDef } from "$lib/contract/schema";
  import { trapFocus } from "$lib/actions/focus-trap";
  import { newOpId } from "$lib/sync/ops";
  import { logWrite } from "$lib/sync/client.svelte";
  import MetricRow from "./MetricRow.svelte";

  /**
   * The end-of-session sheet (UI-DECISIONS §8): end metrics, a note about which metrics
   * are deliberately not asked here, and the finish op that ends the workout. Only ever
   * rendered while `workoutClientId` is set (the caller's `{#if showWrapUp &&
   * workoutClientId}`), so it is required here rather than optional — `DeviationSheet`
   * follows the same convention.
   */
  let {
    planSlug,
    workoutClientId,
    endMetrics,
    nextMorningMetrics,
    sessionMetricValues,
    storageKey,
    onClose,
    onFinished,
    onError,
  }: {
    planSlug: string;
    workoutClientId: string;
    endMetrics: MetricDef[];
    nextMorningMetrics: MetricDef[];
    sessionMetricValues: SvelteMap<string, number | string>;
    storageKey: string;
    onClose: () => void;
    /** The workout is finished and its local key cleared. The caller decides what
     * happens next — today, the celebration screen, and the navigation home after it. */
    onFinished: () => void;
    onError: (message: string | undefined) => void;
  } = $props();

  let finishing = $state(false);

  async function finish(): Promise<void> {
    if (finishing) return;
    finishing = true;
    try {
      await logWrite(planSlug, {
        kind: "finish",
        id: newOpId(),
        workoutClientId,
        status: "completed",
        finishedAt: new Date().toISOString(),
      });
      if (typeof localStorage !== "undefined") localStorage.removeItem(storageKey);
      // Deliberately no navigation from here any more. The finish op is written and the
      // local key is gone, so the workout is complete whatever happens next — the caller
      // is free to put a screen in front of the way home without any of it being load
      // bearing. `finishing` stays true so the button cannot be tapped a second time
      // while the caller swaps the sheet out.
      onFinished();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Something went wrong.");
      finishing = false;
    }
  }
</script>

<div class="sheet-backdrop" role="presentation">
  <!-- UI-DECISIONS §8: a real modal dialog, not just a visually bottom-sheeted div —
       `role="dialog"`/`aria-modal="true"` plus `aria-labelledby` pointing at the heading
       below announce it as such, and `use:trapFocus` (see `$lib/actions/focus-trap`)
       moves focus to that heading on open, cycles Tab within the sheet, restores focus
       to whatever had it on close, and treats Escape the same as the Back button. -->
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-labelledby="wrap-up-heading"
    use:trapFocus={{ onEscape: onClose }}
  >
    <h3 id="wrap-up-heading" tabindex="-1" data-trap-focus-heading>How did it go?</h3>

    {#each endMetrics as metric (metric.key)}
      <MetricRow
        {metric}
        {planSlug}
        {workoutClientId}
        selected={sessionMetricValues.get(metric.key)}
        onSelected={(value) => sessionMetricValues.set(metric.key, value)}
        {onError}
      />
    {/each}

    {#if nextMorningMetrics.length > 0}
      <!-- UI-DECISIONS §8: `next_morning` metrics are deliberately not asked here — they
           surface the following day. Say so explicitly rather than the user wondering
           whether the question was silently dropped (the nudge itself, on a future Today
           screen, is out of scope for this plan). -->
      <p class="next-morning-note">
        Not part of this wrap-up: {nextMorningMetrics.map((m) => m.label).join(", ")}. Asked again
        tomorrow, not now.
      </p>
    {/if}

    <div class="sheet-actions">
      <button type="button" class="secondary" onclick={onClose}>Back</button>
      <button type="button" class="primary" disabled={finishing} onclick={finish}>
        Finish session
      </button>
    </div>
  </div>
</div>

<style>
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-end;
    z-index: 60;
  }
  .sheet {
    width: 100%;
    max-height: 90dvh;
    overflow-y: auto;
    background: var(--surface);
    border-top-left-radius: var(--r-lg);
    border-top-right-radius: var(--r-lg);
    padding: 1.25rem;
    padding-bottom: calc(1.25rem + env(safe-area-inset-bottom));
    display: grid;
    gap: 0.75rem;
  }
  .sheet-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
  }
  .sheet-actions button {
    border: none;
    border-radius: var(--r-sm);
    padding: 0.7rem 1.25rem;
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
  .next-morning-note {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0;
  }
</style>
