<script lang="ts">
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import type { ActionResult } from "@sveltejs/kit";
  import {
    formatRepsOrDuration,
    setLogKey,
    type LoggedSet,
    type ResolvedBlock,
    type ResolvedExercise,
  } from "$lib/session/session-view";
  import type { SessionLedger } from "$lib/session/ledger";
  import ExerciseCard from "./ExerciseCard.svelte";

  /**
   * One session block: checkoff (pills, no set rows, UI-DECISIONS §9), sequence (a list
   * of `ExerciseCard`s) or rounds (the same list plus the round-advance button and its
   * indicator). `ledger` is passed straight through to every `ExerciseCard` — see that
   * component's own doc comment for why it and `addedSets`/`dismissedConditions` are
   * shared by reference rather than copied. `loggedSets` is the same `SvelteMap` as
   * `ledger.loggedSets`, passed separately and typed mutable: `ledger.loggedSets` is a
   * `ReadonlyMap` (the contract every pure `$lib/session/ledger` query relies on), but
   * the checkoff toggle below is a direct write.
   */
  let {
    block,
    ledger,
    loggedSets,
    doneExercises,
    openSlug,
    addedSets,
    dismissedConditions,
    workoutId,
    onOpen,
    applySubstitute,
    onResult,
    onStartNextRound,
  }: {
    block: ResolvedBlock;
    ledger: SessionLedger;
    loggedSets: SvelteMap<string, LoggedSet>;
    doneExercises: ReadonlySet<string>;
    openSlug: string | undefined;
    addedSets: SvelteMap<string, number>;
    dismissedConditions: SvelteSet<string>;
    workoutId: string | undefined;
    onOpen: (key: string) => void;
    applySubstitute: (
      blockKey: string,
      prescribed: ResolvedExercise,
      substituteSlug: string,
    ) => void;
    onResult: (result: ActionResult) => void;
    onStartNextRound: (block: ResolvedBlock) => void;
  } = $props();

  const completed = $derived(ledger.completedRounds.get(block.key) ?? 0);
</script>

<section class="block">
  <div class="block-head">
    <span class="block-name">{block.name}</span>
    {#if block.tracking === "checkoff"}<span class="tag">Check off</span>{/if}
    {#if block.type === "rounds"}
      <span class="tag">Rounds × {block.rounds}</span>
      {#if block.rounds}
        <!-- `role="img"` is what makes the `aria-label` stick: a bare `<span>` maps to
             the generic role, which most screen readers refuse to name, so the dots
             would be silently unlabelled. The role is honest here — this is a picture
             of a count, and its parts carry no meaning on their own. -->
        <span
          class="rounds-indicator"
          role="img"
          aria-label="{completed} of {block.rounds} rounds complete"
        >
          {#each Array.from({ length: block.rounds }).keys() as i (i)}
            <i class:on={i < completed}></i>
          {/each}
        </span>
      {/if}
    {/if}
  </div>
  {#if block.note}<p class="block-note">{block.note}</p>{/if}

  {#if block.tracking === "checkoff"}
    <!-- UI-DECISIONS §9: pills, no set rows, excluded from progression. -->
    <div class="checkoff-pills">
      {#each block.exercises as exercise (exercise.slug)}
        {@const key = setLogKey(block.key, exercise.slug, 1)}
        <button
          type="button"
          class="pill"
          class:done={loggedSets.has(key)}
          onclick={() => {
            if (loggedSets.has(key)) loggedSets.delete(key);
            else loggedSets.set(key, {});
          }}
        >
          {exercise.name}
          <span class="pill-target tabular">{formatRepsOrDuration(exercise)}</span>
        </button>
      {/each}
    </div>
  {:else}
    <ul class="exercises">
      {#each block.exercises as prescribed (prescribed.slug)}
        <ExerciseCard
          {block}
          {prescribed}
          {ledger}
          {doneExercises}
          {openSlug}
          {addedSets}
          {dismissedConditions}
          {workoutId}
          {onOpen}
          {applySubstitute}
          {onResult}
        />
      {/each}
    </ul>

    {#if block.type === "rounds"}
      <button type="button" class="add-set" onclick={() => onStartNextRound(block)}>
        Round {completed + 1} of {block.rounds} done
      </button>
    {/if}
  {/if}
</section>

<style>
  .block {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: 1rem;
  }
  .block-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .block-name {
    font-weight: 700;
  }
  .tag {
    font-size: 0.75rem;
    color: var(--muted);
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: var(--r-xs);
    padding: 0.1rem 0.5rem;
  }
  .block-note {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .rounds-indicator {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .rounds-indicator i {
    display: block;
    width: 5px;
    height: 0.75rem;
    border-radius: 2px;
    background: var(--line);
  }
  .rounds-indicator i.on {
    background: var(--accent);
  }
  .checkoff-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .pill {
    min-height: 2.75rem;
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    border-radius: var(--r-lg);
    padding: 0.5rem 0.9rem;
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .pill.done {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .pill-target {
    color: var(--muted);
  }
  .exercises {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  /* Shared visually with `ExerciseCard`'s "Add the optional set" button — scoped styles
     don't cross component boundaries, so this is a deliberate duplicate of that rule
     rather than an import. */
  .add-set {
    justify-self: start;
    margin-top: 0.75rem;
    min-height: 2.75rem;
    border: 1px dashed var(--line);
    background: none;
    color: var(--accent);
    border-radius: var(--r-xs);
    padding: 0.4rem 0.8rem;
  }
</style>
