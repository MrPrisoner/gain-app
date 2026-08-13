<script lang="ts">
  import type { DeviationKind } from "$lib/logs/types";
  import { trapFocus } from "$lib/actions/focus-trap";
  import { newOpId } from "$lib/sync/ops";
  import { logWrite } from "$lib/sync/client.svelte";

  let {
    exerciseSlug,
    substitutes,
    canChangeSetCount,
    planSlug,
    workoutClientId,
    onClose,
    onApplied,
    onRedFlagStop,
    onError,
  }: {
    exerciseSlug: string;
    substitutes: string[];
    /**
     * Whether adding or dropping a set is a thing that can happen here at all. False
     * inside a `type: rounds` block: CONTRACT makes `sets` invalid there because `set_no`
     * *is* the round, so there is no set count to move. Offering the choice anyway would
     * let the user record a deviation claiming something that could not have occurred —
     * the sheet would close, the row would be written, and the ledger would not budge.
     */
    canChangeSetCount: boolean;
    planSlug: string;
    workoutClientId: string;
    onClose: () => void;
    /**
     * Reports a deviation that was actually written, so the runner can make it *true*
     * rather than only recorded — a skip has to collapse the exercise, a swap has to
     * change what the strip logs against, an add/drop has to change the ledger. Fired
     * before `onClose`, and never for `stop_red_flag` (that path ends the workout through
     * `onRedFlagStop` instead).
     */
    onApplied: (
      kind: Exclude<DeviationKind, "stop_red_flag">,
      substituteSlug: string | undefined,
    ) => void;
    onRedFlagStop: (note: string | undefined) => void;
    /** Reports a failed write (or clears a prior one on success) into the parent page's
     * single shared error surface — this sheet has no error UI of its own — the runner
     * has one error surface, not two (UI-DECISIONS §2). */
    onError: (message: string | undefined) => void;
  } = $props();

  const reasons = [
    { code: "pain", label: "Symptoms" },
    { code: "fatigue", label: "Fatigue" },
    { code: "time", label: "Time" },
    { code: "equipment", label: "Equipment" },
    { code: "felt_easy", label: "Felt easy" },
    { code: "other", label: "Other" },
  ] as const;

  let kind = $state<"skip" | "substitute" | "add_set" | "drop_set" | "stop_red_flag">("skip");
  let reasonCode = $state<string>("pain");
  let substituteSlug = $state<string | undefined>(substitutes[0]);
  let note = $state("");
  let submitting = $state(false);

  async function save(): Promise<void> {
    if (submitting) return;
    submitting = true;
    try {
      await logWrite(planSlug, {
        kind: "deviation",
        id: newOpId(),
        workoutClientId,
        exerciseSlug,
        deviationKind: kind,
        reasonCode,
        note: note || undefined,
        substituteExerciseSlug: kind === "substitute" ? substituteSlug : undefined,
      });

      onError(undefined);
      if (kind === "stop_red_flag") {
        onRedFlagStop(note || undefined);
      } else {
        // The row is written; now make it true. `onApplied` runs before `onClose` so the
        // runner's state has already moved (skipped / swapped / ledger resized) by the
        // time this sheet unmounts.
        onApplied(kind, kind === "substitute" ? substituteSlug : undefined);
        onClose();
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      submitting = false;
    }
  }
</script>

<div class="sheet-backdrop" onclick={onClose} role="presentation">
  <!-- UI-DECISIONS §8: `role="dialog"`/`aria-modal="true"` plus
       `aria-labelledby` announce this as a real modal, and `use:trapFocus` (see
       `$lib/actions/focus-trap`) moves focus to the heading below on open, cycles Tab
       within the sheet, restores focus on close, and treats Escape the same as
       Cancel. -->
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-labelledby="deviation-heading"
    onclick={(e) => e.stopPropagation()}
    use:trapFocus={{ onEscape: onClose }}
  >
    <h3 id="deviation-heading" tabindex="-1" data-trap-focus-heading>Change this set</h3>

    <div class="kind-row">
      <label><input type="radio" name="kind" value="skip" bind:group={kind} /> Skip</label>
      {#if substitutes.length > 0}
        <label><input type="radio" name="kind" value="substitute" bind:group={kind} /> Swap</label>
      {/if}
      {#if canChangeSetCount}
        <label><input type="radio" name="kind" value="add_set" bind:group={kind} /> Add a set</label
        >
        <label
          ><input type="radio" name="kind" value="drop_set" bind:group={kind} /> Drop a set</label
        >
      {/if}
      <label
        ><input type="radio" name="kind" value="stop_red_flag" bind:group={kind} /> Stop (red flag)</label
      >
    </div>

    {#if kind === "substitute" && substitutes.length > 0}
      <select bind:value={substituteSlug}>
        {#each substitutes as sub (sub)}
          <option value={sub}>{sub}</option>
        {/each}
      </select>
    {/if}

    <div class="reason-row">
      {#each reasons as reason (reason.code)}
        <label>
          <input type="radio" name="reason_code" value={reason.code} bind:group={reasonCode} />
          {reason.label}
        </label>
      {/each}
    </div>

    <textarea
      placeholder="Optional note — exported as signal for the revising AI."
      bind:value={note}></textarea>

    <div class="sheet-actions">
      <button type="button" class="secondary" onclick={onClose}>Cancel</button>
      <button type="button" class="primary" disabled={submitting} onclick={save}>Save</button>
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
  .kind-row,
  .reason-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    font-size: 0.85rem;
  }
  /* Each label is the tap target for its radio (the input itself is a few px), so it
     needs the same 44px minimum as every other control here — a row of chip-like
     labels rather than bare inline text next to a tiny native radio. */
  .kind-row label,
  .reason-row label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 2.75rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--line);
    border-radius: var(--r-xs);
    background: var(--raised);
  }
  select,
  textarea {
    width: 100%;
    min-height: 2.75rem;
    padding: 0.6rem;
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
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
</style>
