<script lang="ts">
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import {
    formatRepsOrDuration,
    setLogKey,
    type LoggedSet,
    type ResolvedBlock,
    type ResolvedExercise,
    type SetSlot,
  } from "$lib/session/session-view";
  import { blockIsComplete, type SessionLedger } from "$lib/session/ledger";
  import IconCheck from "~icons/lucide/check";
  import Card from "$lib/components/Card.svelte";
  import ExerciseCard from "./ExerciseCard.svelte";

  /**
   * One session block: checkoff (pills, no set rows, UI §9), sequence (a list
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
    planSlug,
    workoutClientId,
    onOpen,
    applySubstitute,
    onError,
    onStartNextRound,
    onEditSlot,
    nameForSlug,
  }: {
    block: ResolvedBlock;
    ledger: SessionLedger;
    loggedSets: SvelteMap<string, LoggedSet>;
    doneExercises: ReadonlySet<string>;
    openSlug: string | undefined;
    addedSets: SvelteMap<string, number>;
    dismissedConditions: SvelteSet<string>;
    planSlug: string;
    workoutClientId: string;
    onOpen: (key: string) => void;
    applySubstitute: (
      blockKey: string,
      prescribed: ResolvedExercise,
      substituteSlug: string,
    ) => void;
    onError: (message: string | undefined) => void;
    onStartNextRound: (block: ResolvedBlock) => void;
    onEditSlot: (slot: SetSlot) => void;
    /** Passed straight through to every `ExerciseCard` — see that component's prop. */
    nameForSlug: (slug: string) => string;
  } = $props();

  const completed = $derived(ledger.completedRounds.get(block.key) ?? 0);
  const isComplete = $derived(blockIsComplete(block, ledger, doneExercises));
</script>

<section class="block">
  <Card>
    <div class="block-head">
      <!-- Same mark, same reserved slot and same `role="img"` reasoning as the exercise
           row's — see `ExerciseCard`. Consistency is the point: one indicator for
           "finished", wherever finished is being shown. -->
      <span
        class="block-status"
        role={isComplete ? "img" : undefined}
        aria-label={isComplete ? "Block complete" : undefined}
      >
        {#if isComplete}<IconCheck />{/if}
      </span>
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
      <!-- UI §9: pills, no set rows, excluded from progression. -->
      <div class="checkoff-pills">
        {#each block.exercises as exercise (exercise.slug)}
          {@const key = setLogKey(block.key, exercise.slug, 1)}
          {@const isDone = loggedSets.has(key)}
          <!-- `aria-pressed` is what carries the state now that the accent fill is gone:
               the pill is a toggle, and its check icon is decorative for the same reason
               the exercise row's is not — here the button itself is announced pressed. -->
          <button
            type="button"
            class="pill"
            class:done={isDone}
            aria-pressed={isDone}
            onclick={() => {
              if (isDone) loggedSets.delete(key);
              else loggedSets.set(key, {});
            }}
          >
            <!-- Unlike the exercise row's, this slot is *not* reserved when empty. Pills
                 are a wrap layout with nothing to align down a column, so an always-present
                 1.15em bought no tidiness and cost the warm-up two extra rows at 360px —
                 against UI §9, which wants these small enough to stay out of the
                 way. -->
            {#if isDone}<IconCheck class="pill-check" />{/if}
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
            {planSlug}
            {workoutClientId}
            {onOpen}
            {applySubstitute}
            {onError}
            {onEditSlot}
            {nameForSlug}
          />
        {/each}
      </ul>

      {#if block.type === "rounds"}
        <button type="button" class="add-set" onclick={() => onStartNextRound(block)}>
          Round {completed + 1} of {block.rounds} done
        </button>
      {/if}
    {/if}
  </Card>
</section>

<style>
  .block-head {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin-bottom: 0.75rem;
  }
  .block-name {
    font-weight: var(--w-bold);
  }
  .block-status {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.15em;
    color: var(--accent);
  }
  .tag {
    font-size: var(--t-2xs);
    color: var(--muted);
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: var(--r-xs);
    padding: var(--s-1) var(--s-2);
  }
  .block-note {
    color: var(--muted);
    font-size: var(--t-sm);
  }
  .rounds-indicator {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
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
    gap: var(--s-2);
  }
  /* The check icon is the *only* completion signal in the runner, warm-up pills included.
     The accent fill and accent border a done pill used to carry were a second, unrelated
     way of saying the same thing, and a screen where a checked-off pill and a finished
     exercise announce themselves differently makes the user learn two vocabularies for
     one idea. What is left is the treatment the exercise rows already use: the mark, plus
     weight and luminance. An unchecked pill recedes; a checked one reads at full
     strength. */
  .pill {
    min-height: 2.75rem;
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--muted);
    border-radius: var(--r-lg);
    padding: var(--s-2) var(--s-4);
    display: flex;
    gap: var(--s-2);
    align-items: center;
  }
  .pill.done {
    color: var(--text);
    font-weight: var(--w-semi);
  }
  /* `:global` because the check is `~icons/lucide/check`, and Svelte's scoping hash is
     never applied to another component's markup. */
  .pill :global(.pill-check) {
    color: var(--accent);
  }
  .pill-target {
    color: var(--dim);
  }
  .pill.done .pill-target {
    color: var(--muted);
  }
  .exercises {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--s-2);
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
    padding: var(--s-2) var(--s-3);
  }
</style>
