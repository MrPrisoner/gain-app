<script lang="ts">
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import {
    formatLoggedSet,
    formatRepsOrDurationOrDash,
    formatSlotLabel,
    formatTargetOrSets,
    nextUnloggedSlot,
    summariseLoggedSets,
    visibleSetCount,
    type LoggedSet,
    type ResolvedBlock,
    type ResolvedExercise,
    type SetSlot,
  } from "$lib/session/session-view";
  import { performed, slotsFor, type SessionLedger } from "$lib/session/ledger";
  import { newOpId } from "$lib/sync/ops";
  import { logWrite } from "$lib/sync/client.svelte";
  import IconCheck from "~icons/lucide/check";
  import IconMinus from "~icons/lucide/minus";

  /**
   * One exercise row of the runner (UI-DECISIONS §1): collapsed to name, target and
   * completion state, or expanded to its condition/substitute chips, cues and read-only
   * set ledger. The pinned strip that actually logs a set lives at the page level, driven
   * by `openSlug` — this component only ever renders the *read-only* trail of what has
   * already been logged, plus the controls that change the exercise's own state
   * (conditional swap, "Add the optional set").
   *
   * `ledger`/`addedSets`/`dismissedConditions` are the runner's own reactive collections,
   * passed by reference rather than copied — mutating `addedSets`/`dismissedConditions`
   * here is exactly as live as it was inline in the route. `applySubstitute` stays a
   * callback rather than a direct mutation: it also needs the plan's catalogue/loads and
   * the page's single `actionError` surface, both of which belong to the route.
   */
  let {
    block,
    prescribed,
    ledger,
    doneExercises,
    openSlug,
    addedSets,
    dismissedConditions,
    planSlug,
    workoutClientId,
    onOpen,
    applySubstitute,
    onError,
    onEditSlot,
    nameForSlug,
  }: {
    block: ResolvedBlock;
    prescribed: ResolvedExercise;
    ledger: SessionLedger;
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
    /** Reopens an already-logged slot in the pinned strip for correction (a tap on its
     * ledger row) rather than logging the next one. */
    onEditSlot: (slot: SetSlot) => void;
    /** Resolves a substitute's slug to its catalogue name — the swap chips offer these to
     * a user, and a bare slug is not a name (`$lib/session/session-view`). */
    nameForSlug: (slug: string) => string;
  } = $props();

  let swapping = $state(false);

  /** The condition-triggered swap chip's write. A `pain` reason code by default — see
   * the markup below for why. */
  async function submitConditionSwap(sub: string): Promise<void> {
    if (swapping) return;
    swapping = true;
    try {
      await logWrite(planSlug, {
        kind: "deviation",
        id: newOpId(),
        workoutClientId,
        exerciseSlug: prescribed.slug,
        deviationKind: "substitute",
        reasonCode: "pain",
        substituteExerciseSlug: sub,
      });
      applySubstitute(block.key, prescribed, sub);
      onError(undefined);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      swapping = false;
    }
  }

  const exerciseKey = $derived(`${block.key}:${prescribed.slug}`);
  /** The disclosure target for `aria-expanded`/`aria-controls` on the head button.
   * `exerciseKey` carries a `:` separator, which is legal in an HTML id but not in a CSS
   * selector — nothing selects this id, only `aria-controls` refers to it, so the
   * separator is replaced anyway rather than leaving that trap for a later stylesheet. */
  const bodyId = $derived(`exercise-body-${exerciseKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
  const exercise = $derived(performed(ledger, block.key, prescribed));
  const substituted = $derived(exercise.slug !== prescribed.slug);
  const isOpen = $derived(openSlug === exerciseKey);
  const isSkipped = $derived(ledger.skippedExercises.has(exerciseKey));
  const isDone = $derived(doneExercises.has(exerciseKey));
  const isRounds = $derived(block.type === "rounds");
  const visible = $derived(
    isRounds
      ? { shown: 1, canAddMore: false }
      : visibleSetCount(prescribed.sets, addedSets.get(exerciseKey) ?? 0),
  );
  const slots = $derived(slotsFor(ledger, block, prescribed));
  const nextSlot = $derived(nextUnloggedSlot(slots, ledger.loggedSets));
  // UI-DECISIONS §1: the collapsed row carries name, target *and completion state*. Done
  // collapses to what it actually was, skipped says so, and what has not been reached
  // yet recedes.
  const headline = $derived(
    isSkipped
      ? "Skipped"
      : isDone && !isOpen
        ? summariseLoggedSets(
            slots
              .map((slot) => ledger.loggedSets.get(slot.key))
              .filter((logged): logged is LoggedSet => logged !== undefined),
          )
        : formatTargetOrSets(exercise),
  );
</script>

<li
  class="exercise"
  class:open={isOpen}
  class:done={!isOpen && isDone}
  class:skipped={isSkipped}
  class:upcoming={!isOpen && !isDone}
>
  <!-- A disclosure control: the row expands the body below it rather than navigating, so
       it needs `aria-expanded` or a screen-reader user has no way to tell which exercise
       is open. `aria-controls` is set only while open, because the body is removed from
       the DOM when collapsed and a dangling reference names nothing. -->
  <button
    type="button"
    class="exercise-head"
    aria-expanded={isOpen}
    aria-controls={isOpen ? bodyId : undefined}
    onclick={() => onOpen(exerciseKey)}
  >
    <!-- The completion mark. `role="img"` for the same reason as `.led-effort` below and
         `.rounds-indicator` in BlockSection: a bare `<span>` maps to the generic role and
         most screen readers drop its label, so the state would be visual only. It carries
         a label only when there is a state to announce — an exercise not yet reached says
         nothing rather than announcing an empty box. The slot is rendered either way so
         names stay left-aligned down the list instead of jumping a character sideways the
         moment a set lands. -->
    <span
      class="exercise-status"
      role={isSkipped || isDone ? "img" : undefined}
      aria-label={isSkipped ? "Skipped" : isDone ? "Done" : undefined}
    >
      {#if isSkipped}<IconMinus />{:else if isDone}<IconCheck />{/if}
    </span>
    <span class="exercise-name">{exercise.name}</span>
    <span class="exercise-meta tabular">{headline}</span>
  </button>

  {#if isOpen}
    <div class="exercise-body" id={bodyId}>
      {#if isSkipped}
        <p class="cue">Skipped — the deviation is recorded. Nothing further will be logged here.</p>
      {:else}
        {#if prescribed.conditional && !dismissedConditions.has(exerciseKey)}
          <p class="condition">{prescribed.condition}</p>
          {#if !substituted && prescribed.substitutes.length > 0}
            <div class="substitute-row">
              {#each prescribed.substitutes as sub (sub)}
                <!-- A condition-triggered swap is symptom-driven by definition: the
                     `condition` text these chips render beside is what makes them appear
                     at all, and in this plan it reads "if it reproduces familiar back
                     symptoms, replace it". `other` said nothing, and the reason is
                     exported as signal for the revising AI (UI-DECISIONS §7), so saying
                     nothing is a real loss. `pain` is the code behind DeviationSheet's own
                     "Symptoms" chip (`submitConditionSwap`, above). Anything more precise
                     needs a reason picker in this inline row, which §7 already puts in the
                     deviation sheet — the sheet remains the way to record a swap for some
                     other reason. -->
                <button
                  type="button"
                  class="chip"
                  disabled={swapping}
                  onclick={() => submitConditionSwap(sub)}
                >
                  Swap: {nameForSlug(sub)}
                </button>
              {/each}
              <button
                type="button"
                class="chip chip--primary"
                onclick={() => dismissedConditions.add(exerciseKey)}
              >
                Do it
              </button>
            </div>
          {/if}
        {/if}
        <!-- The head now shows the substitute's own name, so the old "Swapped for:
             <slug>" cue would just repeat it. What is *not* otherwise visible once the
             row renames itself is which prescribed slot this is, so the cue points the
             other way. It lives outside the conditional block because a swap can also
             come from the deviation sheet on an exercise that was never conditional. -->
        {#if substituted}
          <p class="cue">Swapped in for {prescribed.name}.</p>
        {/if}
        {#if exercise.note}<p class="cue">{exercise.note}</p>{/if}
        {#if exercise.load?.note}<p class="cue">{exercise.load.note}</p>{/if}

        <!-- The read-only set ledger. Every input that used to live here is now in the
             pinned strip, which logs one set at a time — so these rows are text, and
             text reflows at 360px where a four-track input grid could not. -->
        <ul class="ledger">
          {#each slots as slot (slot.key)}
            {@const logged = ledger.loggedSets.get(slot.key)}
            <li class="ledger-row" class:logged={!!logged} class:next={slot.key === nextSlot?.key}>
              {#if logged}
                <!-- Tapping a logged row reopens it in the pinned strip, pre-filled with
                     what was actually logged, for a mis-tapped reps/weight/difficulty to
                     be corrected — a plain button rather than a link, since it changes
                     what the strip below shows rather than
                     navigating anywhere. No pencil hint: a captured set is the obvious
                     thing to tap. -->
                <button
                  type="button"
                  class="ledger-edit"
                  onclick={() => onEditSlot(slot)}
                  aria-label="Edit set {formatSlotLabel(block, slot)}, logged {formatLoggedSet(
                    logged,
                  )}"
                >
                  <span class="led-set tabular">{formatSlotLabel(block, slot)}</span>
                  <span class="led-target tabular">{formatRepsOrDurationOrDash(exercise)}</span>
                  <span class="led-actual tabular">{formatLoggedSet(logged)}</span>
                  {#if logged.difficulty}
                    {@const filled =
                      logged.difficulty === "easy" ? 1 : logged.difficulty === "medium" ? 2 : 3}
                    <!-- `role="img"` for the same reason as `.rounds-indicator` in
                         BlockSection: without it the generic role drops the label and the
                         three segments read as nothing at all. -->
                    <span class="led-effort" role="img" aria-label="Felt {logged.difficulty}">
                      {#each [1, 2, 3] as seg (seg)}
                        <i class:on={seg <= filled}></i>
                      {/each}
                    </span>
                  {/if}
                </button>
              {:else}
                <span class="led-set tabular">{formatSlotLabel(block, slot)}</span>
                <span class="led-target tabular">{formatRepsOrDurationOrDash(exercise)}</span>
                <span class="led-actual led-pending"
                  >{slot.key === nextSlot?.key ? "Up next" : "Not logged yet"}</span
                >
              {/if}
            </li>
          {/each}
        </ul>

        <!-- UI-DECISIONS §6's optional set, and *only* that: this offers sets the
             ranged prescription already declared, so it is not a deviation and logs
             none. The deviation sheet's add_set/drop_set is a separate mechanism
             against a separate counter — see `$lib/session/ledger`'s `shownSetsFor`. -->
        {#if visible.canAddMore}
          <button
            type="button"
            class="add-set"
            onclick={() => addedSets.set(exerciseKey, (addedSets.get(exerciseKey) ?? 0) + 1)}
          >
            Add the optional set
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</li>

<style>
  .exercise {
    border: 1px solid var(--line-soft);
    border-radius: var(--r-sm);
  }
  .exercise.open {
    border-color: var(--line);
  }
  .exercise-head {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    background: none;
    border: none;
    padding: 0.85rem 1rem;
    text-align: left;
  }
  .exercise-meta {
    color: var(--muted);
    font-size: 0.85rem;
    text-align: right;
    margin-left: auto;
  }
  /* Always laid out, even empty, so the name starts at the same x on every row — a mark
     that pushes its own row sideways turns a scannable column into a ragged one. `1.15em`
     is what `app.css` sizes an icon to, so the reserved slot and the glyph agree. */
  .exercise-status {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.15em;
    color: var(--accent);
  }
  /* A skip is finished-with, not achieved, so it gets the dash rather than the tick and
     stays neutral instead of taking the accent. */
  .exercise.skipped .exercise-status {
    color: var(--dim);
  }
  /* UI-DECISIONS §1/§5: the three states of a row are carried entirely by weight and
     luminance — no colour anywhere below, because colour in this app means symptoms and
     effort, and a list that traffic-lights "done" competes with the one scale that has
     to stay readable. The open exercise is heaviest and brightest; a finished one stays
     legible so its summary can be read at a glance; one not yet reached recedes to
     `--dim`. */
  .exercise-name {
    font-weight: 600;
  }
  .exercise.open .exercise-name {
    font-weight: 750;
  }
  .exercise.done .exercise-name {
    color: var(--muted);
    font-weight: 500;
  }
  .exercise.done .exercise-meta {
    color: var(--text);
  }
  .exercise.upcoming .exercise-name,
  .exercise.upcoming .exercise-meta {
    color: var(--dim);
    font-weight: 500;
  }
  .exercise-body {
    padding: 0 1rem 1rem;
    display: grid;
    gap: 0.6rem;
  }
  .condition {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .substitute-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .chip {
    min-height: 2.75rem;
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    border-radius: var(--r-lg);
    padding: 0.4rem 0.8rem;
    font-size: 0.85rem;
  }
  .chip--primary {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .cue {
    margin: 2px 0;
    color: var(--muted);
    font-size: 0.85rem;
  }
  /* The read-only set ledger. Flex with wrap rather than a fixed grid: at 360px the
     actual/effort pair drops to its own line instead of forcing the row wider than the
     card, which is the whole reason the inputs moved to the strip. */
  .ledger {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .ledger-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--line-soft);
    font-size: 0.9rem;
  }
  .ledger-row:last-child {
    border-bottom: none;
  }
  /* A logged row's content sits inside a button rather than the `<li>` directly, so it
     can be tapped to reopen for correction — reset to look identical to the plain rows
     beside it. `align-items: center` rather than `baseline`: the effort bars have no
     text baseline of their own, so baseline alignment left them hanging below the row's
     text instead of level with it. */
  .ledger-edit {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 0;
    min-height: 2.75rem;
  }
  .led-set {
    flex: none;
    font-weight: 600;
    color: var(--muted);
  }
  /* Three states, by luminance and the one accent hue only (UI-DECISIONS §5): a logged
     row reads at full strength, the row the strip is about to write is accented, and a
     set still to come stays quiet. The "next" row bleeds into `.exercise-body`'s side
     padding so the highlight reaches the card edges rather than sitting as an inset
     patch. */
  .ledger-row.logged .led-set {
    color: var(--text);
  }
  .ledger-row.next {
    margin: 0 -1rem;
    padding: 0.5rem 1rem;
    background: var(--accent-soft);
    border-bottom-color: transparent;
    border-radius: var(--r-md);
  }
  .ledger-row.next .led-set {
    color: var(--accent);
  }
  .led-target {
    color: var(--dim);
    font-size: 0.85rem;
  }
  .led-actual {
    margin-left: auto;
    font-weight: 600;
  }
  .led-pending {
    font-weight: 400;
    color: var(--dim);
    font-size: 0.85rem;
  }
  .led-effort {
    flex: none;
    display: inline-flex;
    gap: 3px;
  }
  .led-effort i {
    display: block;
    width: 5px;
    height: 0.75rem;
    border-radius: 2px;
    background: var(--line);
  }
  .led-effort i.on {
    background: var(--accent);
  }
  /* Shared visually with `BlockSection`'s round-advance button — scoped styles don't
     cross component boundaries, so this is a deliberate duplicate of that rule rather
     than an import. */
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
