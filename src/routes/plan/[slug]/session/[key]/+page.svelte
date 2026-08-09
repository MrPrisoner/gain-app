<script lang="ts">
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import { ulid } from "ulidx";
  import { applyAction, enhance } from "$app/forms";
  import type { ActionResult } from "@sveltejs/kit";
  import type { ActionData, PageData } from "./$types";
  import {
    formatLoggedSet,
    formatRepsOrDuration,
    formatSlotContext,
    formatSlotLabel,
    formatTarget,
    nextUnloggedSlot,
    restForSet,
    restBetweenRounds,
    setLogKey,
    setSlotsFor,
    visibleSetCount,
    type LoggedSet,
    type ResolvedBlock,
    type ResolvedExercise,
    type SetSlot,
  } from "$lib/session/session-view";
  import { formatLastPerformance } from "$lib/session/prefill";
  import RestTimer from "./RestTimer.svelte";
  import DeviationSheet from "./DeviationSheet.svelte";
  import LogStrip from "./LogStrip.svelte";
  import { restSpecFrom, type RestSpec } from "$lib/session/rest-timer";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // The workout row is created once per session attempt and kept in sessionStorage so
  // a reload resumes the same row via its client_id instead of starting a new one
  // (Global Constraints: phase 4 has no IndexedDB, so surviving a full browser kill is
  // out of scope — surviving a reload is not).
  const storageKey = `gain:workout:${data.planSlug}:${data.session.key}`;
  let workoutClientId = $state(
    typeof sessionStorage !== "undefined"
      ? (sessionStorage.getItem(storageKey) ?? mintAndStore())
      : ulid(),
  );
  let workoutId = $state<string | undefined>(form?.workoutId);

  // The one action-error surface for the whole runner (phase-4 remediation Task 2) — every
  // enhanced form on this page, and `DeviationSheet` via its `onError` prop, funnels into
  // this single piece of state so there is exactly one place an action error renders, one
  // visual treatment, one dismiss control.
  let actionError = $state<string | undefined>(form?.actionError);

  function afterAction(result: ActionResult): void {
    if (result.type === "failure") {
      const data = result.data as { actionError?: string } | undefined;
      actionError =
        typeof data?.actionError === "string" ? data.actionError : "Something went wrong.";
    } else if (result.type === "success") {
      actionError = undefined;
    }
  }

  function mintAndStore(): string {
    const id = ulid();
    sessionStorage.setItem(storageKey, id);
    return id;
  }

  let startForm: HTMLFormElement | undefined = $state();

  $effect(() => {
    if (!workoutId) startForm?.requestSubmit();
  });

  // A red-flag stop (DeviationSheet, `kind: stop_red_flag`) immediately finishes the
  // workout with `status=stopped` — the plan's own design says a red flag ends the
  // workout, it doesn't just log a deviation and leave `status='partial'` forever.
  let redFlagFinishForm: HTMLFormElement | undefined = $state();
  let redFlagNote = $state<string | undefined>(undefined);
  let redFlagTriggered = $state(false);

  $effect(() => {
    if (redFlagTriggered) redFlagFinishForm?.requestSubmit();
  });

  function onRedFlagStop(note: string | undefined) {
    redFlagNote = note;
    deviationFor = undefined;
    redFlagTriggered = true;
  }

  // Which exercise is expanded — UI-DECISIONS §1: exactly one, the others collapse.
  // Keyed by `${block.key}:${slug}` since the same exercise slug can appear in more
  // than one block within a session (e.g. a warm-up checkoff and a working block) and
  // expanding one must not affect the other.
  let openSlug = $state<string | undefined>(firstTrackedExerciseKey());
  function firstTrackedExerciseKey(): string | undefined {
    for (const block of data.session.blocks) {
      if (block.tracking === "checkoff") continue;
      const first = block.exercises[0];
      if (first) return `${block.key}:${first.slug}`;
    }
    return undefined;
  }

  // Logged sets this workout, keyed by `setLogKey`, holding what was actually submitted
  // (never the pre-fill it started from — the ledger reads from this). Keys are the
  // shape a resumed workout would rebuild from persisted `set_log` rows.
  const loggedSets = new SvelteMap<string, LoggedSet>();

  // Optional sets added beyond a ranged prescription's minimum, keyed by `${block.key}:${slug}`.
  const addedSets = new SvelteMap<string, number>();

  // Rounds completed so far for a `type: rounds` block, keyed by block key.
  const completedRounds = new SvelteMap<string, number>();

  // A conditional exercise's active substitute (UI-DECISIONS §6), keyed by
  // `${block.key}:${slug}`; once set the swap chips stop rendering for that exercise.
  const substitutedExercises = new SvelteMap<string, string>();
  // Conditional exercises whose condition prompt was dismissed via "Do it" — the
  // prescribed movement is being done as-is, so no deviation is logged.
  const dismissedConditions = new SvelteSet<string>();

  // The rest timer overlay's spec, or undefined when no rest is active.
  let activeRest = $state<RestSpec | undefined>(undefined);
  // The exercise slug the deviation sheet is open for, or undefined when closed.
  let deviationFor = $state<string | undefined>(undefined);

  // Whether the end-of-session wrap-up sheet is showing.
  let showWrapUp = $state(false);
  // Tap-to-select values for session-scope metrics, keyed by metric key — held here for
  // display only; each tap fires its own `?/logMetric` submission (UI-DECISIONS §8).
  const sessionMetricValues = new SvelteMap<string, number | string>();

  function prefillFor(
    slug: string,
    perSide: boolean,
    side?: "left" | "right",
  ): { reps?: number; weightKg?: number; durationS?: number } {
    const entry = data.prefillByExercise[slug];
    if (!entry) return {};
    if (perSide) return (side === "left" ? entry.left : entry.right) ?? {};
    return entry.none ?? {};
  }

  /** How many sets the exercise currently offers — its ranged minimum plus any optional
   * set the user has added, or exactly the current round inside a rounds block. */
  function shownSetsFor(block: ResolvedBlock, exercise: ResolvedExercise): number {
    if (block.type === "rounds") return 1;
    return visibleSetCount(exercise.sets, addedSets.get(`${block.key}:${exercise.slug}`) ?? 0)
      .shown;
  }

  function currentRoundOf(blockKey: string): number {
    return (completedRounds.get(blockKey) ?? 0) + 1;
  }

  /**
   * Everything the pinned strip needs about the one open exercise (UI-DECISIONS §1: one
   * exercise open, §2: the strip logs exactly one set). `next` is `undefined` once every
   * offered set is logged — the strip then shows its finished state rather than
   * vanishing, so the ledger's reserved bottom padding stays honest.
   */
  const openContext = $derived.by(() => {
    if (!openSlug) return undefined;
    for (const block of data.session.blocks) {
      if (block.tracking === "checkoff") continue;
      for (const exercise of block.exercises) {
        if (`${block.key}:${exercise.slug}` !== openSlug) continue;
        const shownSets = shownSetsFor(block, exercise);
        const slots = setSlotsFor(block, exercise, {
          shownSets,
          currentRound: currentRoundOf(block.key),
        });
        return { block, exercise, shownSets, next: nextUnloggedSlot(slots, loggedSets) };
      }
    }
    return undefined;
  });

  /** The strip's real rendered height, so `.blocks` can reserve exactly that much
   * scroll padding — the last block must never be trapped underneath it. */
  let stripHeight = $state(0);

  function onSetLogged(slot: SetSlot, logged: LoggedSet): void {
    loggedSets.set(slot.key, logged);
    const context = openContext;
    if (!context) return;
    const rest = restForSet(context.block, context.exercise);
    if (rest) activeRest = restSpecFrom(rest);
  }
</script>

<svelte:head>
  <title>{data.session.name} — GAIN</title>
</svelte:head>

<form
  bind:this={startForm}
  method="POST"
  action="?/start"
  use:enhance={() => {
    return async ({ result }) => {
      await applyAction(result);
      afterAction(result);
      if (result.type === "success" && result.data?.workoutId) {
        workoutId = result.data.workoutId as string;
      }
    };
  }}
  hidden
>
  <input type="hidden" name="client_id" value={workoutClientId} />
</form>

<form
  bind:this={redFlagFinishForm}
  method="POST"
  action="?/finish"
  use:enhance={() => {
    return async ({ result }) => {
      await applyAction(result);
      afterAction(result);
      if (result.type === "success") {
        sessionStorage.removeItem(storageKey);
        window.location.href = "/";
      }
    };
  }}
  hidden
>
  <input type="hidden" name="workout_id" value={workoutId ?? ""} />
  <input type="hidden" name="status" value="stopped" />
  <input type="hidden" name="note" value={redFlagNote ?? ""} />
</form>

<header class="runner-head">
  <h1>{data.session.name}</h1>
  {#if data.session.note}<p class="note">{data.session.note}</p>{/if}
  <button type="button" class="end-session" onclick={() => (showWrapUp = true)}>End session</button>
</header>

{#if actionError}
  <div class="action-error" role="alert">
    <p>{actionError}</p>
    <button
      type="button"
      class="dismiss"
      onclick={() => (actionError = undefined)}
      aria-label="Dismiss error"
    >
      &times;
    </button>
  </div>
{/if}

{#if !workoutId}
  <!-- Task 2 (phase-4 remediation): nothing below posts a real workout_id until the
       async `?/start` round-trip resolves, so no logging control renders until then —
       a quiet "starting" state beats a live-looking strip that 400s on every tap. -->
  <p class="starting">Starting your session…</p>
{:else}
  <!-- The strip is `position: fixed`, so the scroll area has to reserve its measured
       height or the last block sits underneath it forever. -->
  <div
    class="blocks"
    style:padding-bottom={stripHeight > 0 ? `calc(${stripHeight}px + 1rem)` : undefined}
  >
    {#each data.session.blocks as block (block.key)}
      <section class="block">
        <div class="block-head">
          <span class="block-name">{block.name}</span>
          {#if block.tracking === "checkoff"}<span class="tag">Check off</span>{/if}
          {#if block.type === "rounds"}<span class="tag">Rounds × {block.rounds}</span>{/if}
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
            {#each block.exercises as exercise (exercise.slug)}
              {@const exerciseKey = `${block.key}:${exercise.slug}`}
              {@const isOpen = openSlug === exerciseKey}
              {@const isRounds = block.type === "rounds"}
              {@const visible = isRounds
                ? { shown: 1, canAddMore: false }
                : visibleSetCount(exercise.sets, addedSets.get(exerciseKey) ?? 0)}
              <li class="exercise" class:open={isOpen}>
                <button
                  type="button"
                  class="exercise-head"
                  onclick={() => (openSlug = exerciseKey)}
                >
                  <span class="exercise-name">{exercise.name}</span>
                  <span class="exercise-meta tabular">
                    {formatTarget(exercise)}
                  </span>
                </button>

                {#if isOpen}
                  {@const slots = setSlotsFor(block, exercise, {
                    shownSets: visible.shown,
                    currentRound: currentRoundOf(block.key),
                  })}
                  {@const nextSlot = nextUnloggedSlot(slots, loggedSets)}
                  <div class="exercise-body">
                    {#if exercise.conditional && !dismissedConditions.has(exerciseKey)}
                      {@const substitutedWith = substitutedExercises.get(exerciseKey)}
                      <p class="condition">{exercise.condition}</p>
                      {#if substitutedWith}
                        <p class="cue">Swapped for: {substitutedWith}</p>
                      {:else if exercise.substitutes.length > 0}
                        <div class="substitute-row">
                          {#each exercise.substitutes as sub (sub)}
                            <form
                              method="POST"
                              action="?/logDeviation"
                              use:enhance={() => {
                                return async ({ result }) => {
                                  await applyAction(result);
                                  afterAction(result);
                                  if (result.type === "success") {
                                    substitutedExercises.set(exerciseKey, sub);
                                  }
                                };
                              }}
                            >
                              <input type="hidden" name="workout_id" value={workoutId ?? ""} />
                              <input type="hidden" name="exercise_slug" value={exercise.slug} />
                              <input type="hidden" name="kind" value="substitute" />
                              <input type="hidden" name="reason_code" value="other" />
                              <input type="hidden" name="substitute_exercise_slug" value={sub} />
                              <input type="hidden" name="client_id" value={ulid()} />
                              <button type="submit" class="chip">Swap: {sub}</button>
                            </form>
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
                    {#if exercise.note}<p class="cue">{exercise.note}</p>{/if}
                    {#if exercise.load?.note}<p class="cue">{exercise.load.note}</p>{/if}

                    <!-- The read-only set ledger. Every input that used to live here is
                         now in the pinned strip, which logs one set at a time — so these
                         rows are text, and text reflows at 360px where a four-track input
                         grid could not. -->
                    <ul class="ledger">
                      {#each slots as slot (slot.key)}
                        {@const logged = loggedSets.get(slot.key)}
                        <li
                          class="ledger-row"
                          class:logged={!!logged}
                          class:next={slot.key === nextSlot?.key}
                        >
                          <span class="led-set tabular">{formatSlotLabel(block, slot)}</span>
                          <span class="led-target tabular">{formatRepsOrDuration(exercise)}</span>
                          {#if logged}
                            <span class="led-actual tabular">{formatLoggedSet(logged)}</span>
                            {#if logged.difficulty}
                              {@const filled =
                                logged.difficulty === "easy"
                                  ? 1
                                  : logged.difficulty === "medium"
                                    ? 2
                                    : 3}
                              <span class="led-effort" aria-label="Felt {logged.difficulty}">
                                {#each [1, 2, 3] as seg (seg)}
                                  <i class:on={seg <= filled}></i>
                                {/each}
                              </span>
                            {/if}
                          {:else}
                            <span class="led-actual led-pending"
                              >{slot.key === nextSlot?.key ? "Up next" : "Not logged"}</span
                            >
                          {/if}
                        </li>
                      {/each}
                    </ul>

                    {#if visible.canAddMore}
                      <button
                        type="button"
                        class="add-set"
                        onclick={() =>
                          addedSets.set(exerciseKey, (addedSets.get(exerciseKey) ?? 0) + 1)}
                      >
                        Add the optional set
                      </button>
                    {/if}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>

          {#if block.type === "rounds"}
            <button
              type="button"
              class="add-set"
              onclick={() => {
                const round = (completedRounds.get(block.key) ?? 0) + 1;
                completedRounds.set(block.key, round);
                const rest = restBetweenRounds(block, round);
                if (rest) activeRest = restSpecFrom(rest);
              }}
            >
              Round {(completedRounds.get(block.key) ?? 0) + 1} of {block.rounds} done
            </button>
          {/if}
        {/if}
      </section>
    {/each}
  </div>
{/if}

{#if workoutId && openContext}
  {@const ctx = openContext}
  {@const slot = ctx.next}
  {@const fill = prefillFor(ctx.exercise.slug, ctx.exercise.perSide, slot?.side)}
  <LogStrip
    bind:height={stripHeight}
    {workoutId}
    exercise={ctx.exercise}
    {slot}
    context={slot ? formatSlotContext(ctx.block, slot, ctx.shownSets) : "All sets logged"}
    lastPerformance={formatLastPerformance(fill, ctx.exercise.type)}
    prefill={fill}
    onLogged={onSetLogged}
    onResult={afterAction}
    onDeviate={() => (deviationFor = ctx.exercise.slug)}
  />
{/if}

{#if activeRest}
  <RestTimer
    spec={activeRest}
    onDone={() => (activeRest = undefined)}
    onSkip={() => (activeRest = undefined)}
  />
{/if}

{#if deviationFor && workoutId}
  <DeviationSheet
    exerciseSlug={deviationFor}
    substitutes={data.session.blocks
      .flatMap((b) => b.exercises)
      .find((e) => e.slug === deviationFor)?.substitutes ?? []}
    {workoutId}
    onClose={() => (deviationFor = undefined)}
    {onRedFlagStop}
    onError={(message) => (actionError = message)}
  />
{/if}

{#if showWrapUp && workoutId}
  <div class="sheet-backdrop" role="presentation">
    <div class="sheet">
      <h3>How did it go?</h3>

      {#each data.endMetrics as metric (metric.key)}
        {#if metric.type === "scale" || metric.type === "number"}
          <label>
            {metric.label}
            <div class="scale-row">
              {#each Array.from({ length: (metric.max ?? 0) - (metric.min ?? 0) + 1 }, (_, i) => (metric.min ?? 0) + i) as value (value)}
                <form
                  method="POST"
                  action="?/logMetric"
                  use:enhance={() => {
                    return async ({ result }) => {
                      await applyAction(result);
                      afterAction(result);
                      if (result.type === "success") sessionMetricValues.set(metric.key, value);
                    };
                  }}
                >
                  <input type="hidden" name="scope" value="session" />
                  <input type="hidden" name="workout_id" value={workoutId ?? ""} />
                  <input type="hidden" name="metric_key" value={metric.key} />
                  <input type="hidden" name="value_num" {value} />
                  <input type="hidden" name="client_id" value={ulid()} />
                  <button
                    type="submit"
                    class="scale-cell"
                    class:selected={sessionMetricValues.get(metric.key) === value}
                  >
                    {value}
                  </button>
                </form>
              {/each}
            </div>
          </label>
        {:else if metric.type === "enum"}
          <label>
            {metric.label}
            <div class="scale-row">
              {#each metric.options ?? [] as option (option)}
                <form
                  method="POST"
                  action="?/logMetric"
                  use:enhance={() => {
                    return async ({ result }) => {
                      await applyAction(result);
                      afterAction(result);
                      if (result.type === "success") sessionMetricValues.set(metric.key, option);
                    };
                  }}
                >
                  <input type="hidden" name="scope" value="session" />
                  <input type="hidden" name="workout_id" value={workoutId ?? ""} />
                  <input type="hidden" name="metric_key" value={metric.key} />
                  <input type="hidden" name="value_text" value={option} />
                  <input type="hidden" name="client_id" value={ulid()} />
                  <button
                    type="submit"
                    class="scale-cell"
                    class:selected={sessionMetricValues.get(metric.key) === option}
                  >
                    {option}
                  </button>
                </form>
              {/each}
            </div>
          </label>
        {/if}
      {/each}

      <form
        method="POST"
        action="?/finish"
        use:enhance={() => {
          return async ({ result }) => {
            await applyAction(result);
            afterAction(result);
            if (result.type === "success") {
              sessionStorage.removeItem(storageKey);
              window.location.href = "/";
            }
          };
        }}
      >
        <input type="hidden" name="workout_id" value={workoutId} />
        <input type="hidden" name="status" value="completed" />
        <div class="sheet-actions">
          <button type="button" class="secondary" onclick={() => (showWrapUp = false)}>Back</button>
          <button type="submit" class="primary">Finish session</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .runner-head {
    padding: 1rem 0 0.5rem;
  }
  .runner-head h1 {
    margin: 0;
    font-size: 1.25rem;
  }
  .note {
    color: var(--muted);
    font-size: 0.9rem;
    margin: 0.25rem 0 0;
  }
  .blocks {
    display: grid;
    gap: 1rem;
    /* Replaced at runtime by the strip's measured height (see the `style:` binding
       above); this is only what SSR renders before the measurement lands. */
    padding-bottom: 15rem;
  }
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
  .checkoff-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .pill {
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
    background: none;
    border: none;
    padding: 0.85rem 1rem;
    text-align: left;
  }
  .exercise-meta {
    color: var(--muted);
    font-size: 0.85rem;
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
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--line-soft);
    font-size: 0.9rem;
  }
  .ledger-row:last-child {
    border-bottom: none;
  }
  .led-set {
    flex: none;
    font-weight: 600;
    color: var(--muted);
  }
  /* Three states, by luminance and the one accent hue only (UI-DECISIONS §5): a logged
     row reads at full strength, the row the strip is about to write is accented, and a
     set still to come stays quiet. */
  .ledger-row.logged .led-set {
    color: var(--text);
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
    align-self: center;
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
  .add-set {
    justify-self: start;
    border: 1px dashed var(--line);
    background: none;
    color: var(--accent);
    border-radius: var(--r-xs);
    padding: 0.4rem 0.8rem;
  }
  .action-error {
    position: sticky;
    top: 0;
    z-index: 70;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    background: var(--raised);
    color: var(--text);
    font-weight: 700;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: 0.75rem 1rem;
    margin: 0.75rem 0;
  }
  .action-error p {
    margin: 0;
  }
  .action-error .dismiss {
    border: none;
    background: none;
    color: inherit;
    font-weight: 700;
    font-size: 1.2rem;
    line-height: 1;
    padding: 0;
  }
  .starting {
    color: var(--muted);
    text-align: center;
    padding: 3rem 0;
  }
  .end-session {
    margin-top: 0.5rem;
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    border-radius: var(--r-sm);
    padding: 0.5rem 1rem;
  }
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
  .scale-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.3rem;
  }
  .scale-cell {
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    border-radius: var(--r-xs);
    padding: 0.4rem 0.7rem;
    min-width: 2.5rem;
  }
  .scale-cell.selected {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
</style>
