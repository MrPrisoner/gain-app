<script lang="ts">
  import { ulid } from "ulidx";
  import { enhance } from "$app/forms";

  let {
    exerciseSlug,
    substitutes,
    workoutId,
    onClose,
  }: { exerciseSlug: string; substitutes: string[]; workoutId: string; onClose: () => void } =
    $props();

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
</script>

<div class="sheet-backdrop" onclick={onClose} role="presentation">
  <form
    method="POST"
    action="?/logDeviation"
    class="sheet"
    onclick={(e) => e.stopPropagation()}
    use:enhance={() => {
      return ({ result }) => {
        if (result.type === "success") onClose();
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
      <label><input type="radio" name="kind" value="add_set" bind:group={kind} /> Add a set</label>
      <label><input type="radio" name="kind" value="drop_set" bind:group={kind} /> Drop a set</label
      >
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

    <textarea name="note" placeholder="Optional note — exported as signal for the revising AI."
    ></textarea>

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
