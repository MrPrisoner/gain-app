<script lang="ts">
  import { untrack } from "svelte";
  import type { DeviationKind } from "$lib/logs/types";
  import { trapFocus } from "$lib/actions/focus-trap";
  import { newOpId } from "$lib/sync/ops";
  import { logWrite } from "$lib/sync/client.svelte";
  import type { SymptomGuideLevel } from "$lib/session/symptom-guide";

  let {
    exerciseSlug,
    substitutes,
    nameForSlug,
    canChangeSetCount,
    redLevel,
    planSlug,
    workoutClientId,
    onClose,
    onApplied,
    onRedFlagStop,
    onError,
  }: {
    exerciseSlug: string;
    substitutes: string[];
    /** Resolves a substitute's slug to its catalogue name — the sheet offers these to a
     * user, and a bare slug is not a name (`$lib/session/session-view`). */
    nameForSlug: (slug: string) => string;
    /**
     * Whether adding or dropping a set is a thing that can happen here at all. False
     * inside a `type: rounds` block: CONTRACT makes `sets` invalid there because `set_no`
     * *is* the round, so there is no set count to move. Offering the choice anyway would
     * let the user record a deviation claiming something that could not have occurred —
     * the sheet would close, the row would be written, and the ledger would not budge.
     */
    canChangeSetCount: boolean;
    /** The plan's `red` symptom level (D2), quoted inline on the `stop_red_flag` choice
     * so a control that ends the workout also says what stopping means. `undefined` when
     * the plan declares no symptom framework at all. */
    redLevel: SymptomGuideLevel | undefined;
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
     * has one error surface, not two (UI §2). */
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
  // One-shot capture at mount, the same pattern the home screen documents with
  // `untrack()` (`src/routes/+page.svelte`): the parent mounts a fresh `DeviationSheet`
  // per exercise slot, so `substitutes` never changes under a live instance — this only
  // seeds the default radio choice, not a value that should track the prop afterwards.
  let substituteSlug = $state<string | undefined>(untrack(() => substitutes[0]));
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

<!-- Close only on a click that lands on the backdrop itself, not one that bubbles up from
     inside the sheet — checking `target === currentTarget` means the sheet needs no click
     handler of its own, so its `role="dialog"` element carries no interactive behaviour
     that would need a `tabindex` to be reachable. -->
<div
  class="sheet-backdrop"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
>
  <!-- UI §8: `role="dialog"`/`aria-modal="true"` plus
       `aria-labelledby` announce this as a real modal, and `use:trapFocus` (see
       `$lib/actions/focus-trap`) moves focus to the heading below on open, cycles Tab
       within the sheet, restores focus on close, and treats Escape the same as
       Cancel. -->
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-labelledby="deviation-heading"
    use:trapFocus={{ onEscape: onClose }}
  >
    <h3 id="deviation-heading" tabindex="-1" data-trap-focus-heading>Change this set</h3>

    <!-- `role="radiogroup"` with an `aria-label` rather than a `fieldset`/`legend`: both
         name the group, but a legend adds visible chrome to a sheet whose whole point is
         that deviating is never slower than lying (UI §7). Without a name the
         radios announce individually and a screen-reader user hears "Skip, radio button"
         with no indication of what is being chosen. -->
    <div class="kind-row" role="radiogroup" aria-label="What changed">
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
      <select bind:value={substituteSlug} aria-label="Swap in which exercise">
        {#each substitutes as sub (sub)}
          <option value={sub}>{nameForSlug(sub)}</option>
        {/each}
      </select>
    {/if}

    {#if kind === "stop_red_flag" && redLevel}
      <div class="red-level" style:border-color={`var(${redLevel.token})`}>
        <p class="red-level-label">{redLevel.label}</p>
        {#if redLevel.modifications.length > 0}
          <ul>
            {#each redLevel.modifications as modification (modification)}
              <li>{modification}</li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    <div class="reason-row" role="radiogroup" aria-label="Why">
      {#each reasons as reason (reason.code)}
        <label>
          <input type="radio" name="reason_code" value={reason.code} bind:group={reasonCode} />
          {reason.label}
        </label>
      {/each}
    </div>

    <!-- A placeholder is not an accessible name: it is announced as a hint at best, and
         vanishes the moment the field has content. -->
    <textarea
      aria-label="Note"
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
    padding: var(--s-5);
    padding-bottom: calc(var(--s-5) + env(safe-area-inset-bottom));
    display: grid;
    gap: var(--s-3);
  }
  .kind-row,
  .reason-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-3);
    font-size: var(--t-sm);
  }
  .red-level {
    border-left: 3px solid;
    padding: var(--s-2) var(--s-3);
    font-size: var(--t-sm);
    background: var(--raised);
    border-radius: var(--r-xs);
  }
  .red-level-label {
    margin: 0;
    font-weight: var(--w-semi);
  }
  .red-level ul {
    margin: 0.35rem 0 0;
    padding-left: var(--s-5);
    color: var(--muted);
  }
  /* Each label is the tap target for its radio (the input itself is a few px), so it
     needs the same 44px minimum as every other control here — a row of chip-like
     labels rather than bare inline text next to a tiny native radio. */
  .kind-row label,
  .reason-row label {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 2.75rem;
    padding: var(--s-1) var(--s-2);
    border: 1px solid var(--line);
    border-radius: var(--r-xs);
    background: var(--raised);
  }
  select,
  textarea {
    width: 100%;
    min-height: 2.75rem;
    padding: var(--s-3);
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
  }
  .sheet-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--s-3);
  }
  .sheet-actions button {
    border: none;
    border-radius: var(--r-sm);
    padding: var(--s-3) var(--s-5);
    font-weight: var(--w-bold);
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
