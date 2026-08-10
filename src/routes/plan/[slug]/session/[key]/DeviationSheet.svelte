<script lang="ts">
  import { ulid } from "ulidx";
  import { applyAction, enhance } from "$app/forms";
  import type { ActionResult } from "@sveltejs/kit";
  import type { DeviationKind } from "$lib/logs/types";

  let {
    exerciseSlug,
    substitutes,
    canChangeSetCount,
    workoutId,
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
    workoutId: string;
    onClose: () => void;
    /**
     * Reports a deviation that the server actually accepted, so the runner can make it
     * *true* rather than only recorded — a skip has to collapse the exercise, a swap has
     * to change what the strip logs against, an add/drop has to change the ledger. Fired
     * before `onClose`, and never for `stop_red_flag` (that path ends the workout through
     * `onRedFlagStop` instead).
     */
    onApplied: (
      kind: Exclude<DeviationKind, "stop_red_flag">,
      substituteSlug: string | undefined,
    ) => void;
    onRedFlagStop: (note: string | undefined) => void;
    /** Reports a failed `?/logDeviation` submission (or clears a prior one on success) into
     * the parent page's single shared action-error surface — this sheet has no error UI of
     * its own (phase-4 remediation Task 2 unifies the two former error mechanisms). */
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
</script>

<div class="sheet-backdrop" onclick={onClose} role="presentation">
  <form
    method="POST"
    action="?/logDeviation"
    class="sheet"
    onclick={(e) => e.stopPropagation()}
    use:enhance={() => {
      return async ({ result }: { result: ActionResult }) => {
        await applyAction(result);
        if (result.type === "success") {
          onError(undefined);
          if (kind === "stop_red_flag") {
            onRedFlagStop(note || undefined);
          } else {
            // The row is written; now make it true. `onApplied` runs before `onClose` so
            // the runner's state has already moved (skipped / swapped / ledger resized)
            // by the time this sheet unmounts.
            onApplied(kind, kind === "substitute" ? substituteSlug : undefined);
            onClose();
          }
        } else if (result.type === "failure") {
          const data = result.data as { actionError?: string } | undefined;
          onError(
            typeof data?.actionError === "string" ? data.actionError : "Something went wrong.",
          );
        }
      };
    }}
  >
    <input type="hidden" name="workout_id" value={workoutId} />
    <input type="hidden" name="exercise_slug" value={exerciseSlug} />
    <input type="hidden" name="client_id" value={ulid()} />
    {#if kind === "substitute" && substituteSlug}
      <input type="hidden" name="substitute_exercise_slug" value={substituteSlug} />
    {/if}

    <h3>Change this set</h3>

    <div class="kind-row">
      <label><input type="radio" name="kind" value="skip" bind:group={kind} /> Skip</label>
      {#if substitutes.length > 0}
        <label><input type="radio" name="kind" value="substitute" bind:group={kind} /> Swap</label>
      {/if}
      {#if canChangeSetCount}
        <label
          ><input type="radio" name="kind" value="add_set" bind:group={kind} /> Add a set</label
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
      name="note"
      placeholder="Optional note — exported as signal for the revising AI."
      bind:value={note}></textarea>

    <div class="sheet-actions">
      <button type="button" class="secondary" onclick={onClose}>Cancel</button>
      <button type="submit" class="primary">Save</button>
    </div>
  </form>
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
    background: var(--surface);
    border-top-left-radius: var(--r-lg);
    border-top-right-radius: var(--r-lg);
    padding: 1.25rem;
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
  select,
  textarea {
    width: 100%;
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
