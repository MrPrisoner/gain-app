<script lang="ts">
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import { ulid } from "ulidx";
  import { applyAction, enhance } from "$app/forms";
  import type { ActionResult } from "@sveltejs/kit";
  import type { ActionData, PageData } from "./$types";
  import {
    formatSlotContext,
    nextExerciseKey,
    nextUnloggedSlot,
    resolveSubstitute,
    restForSet,
    restBetweenRounds,
    trackedExerciseKeys,
    type LoggedSet,
    type ResolvedBlock,
    type ResolvedExercise,
    type SetSlot,
  } from "$lib/session/session-view";
  import {
    computeDoneExercises,
    exerciseAt,
    performed,
    prefillFor,
    resolveOpenContext,
    slotsFor,
    upNextForExerciseAt,
    upNextForSetLogged,
    type SessionLedger,
    type UpNext,
  } from "$lib/session/ledger";
  import type { SessionHydration } from "$lib/session/resume";
  import type { DeviationKind } from "$lib/logs/types";
  import { formatLastPerformance } from "$lib/session/prefill";
  import RestTimer from "./RestTimer.svelte";
  import DeviationSheet from "./DeviationSheet.svelte";
  import LogStrip from "./LogStrip.svelte";
  import MetricRow from "./MetricRow.svelte";
  import BlockSection from "./BlockSection.svelte";
  import WrapUpSheet from "./WrapUpSheet.svelte";
  import { restSpecFrom, type RestSpec } from "$lib/session/rest-timer";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // The workout row is created once per session attempt and kept in sessionStorage so
  // a reload resumes the same row via its client_id instead of starting a new one
  // (Global Constraints: phase 4 has no IndexedDB, so surviving a full browser kill is
  // out of scope — surviving a reload is not). The `?/start` action below answers that
  // same idempotent lookup with everything the workout has already written, which
  // `applyHydration` pours back into the maps declared here — so a reload keeps the
  // ledger, the cursor, the skips, the swaps and the wrap-up's answers, not just the row.
  const storageKey = `gain:workout:${data.planSlug}:${data.session.key}`;
  let workoutClientId = $state(
    typeof sessionStorage !== "undefined"
      ? (sessionStorage.getItem(storageKey) ?? mintAndStore())
      : ulid(),
  );
  let workoutId = $state<string | undefined>(form?.workoutId);

  // Pre-session metrics (ARCHITECTURE §9, UI-DECISIONS §8): a genuinely fresh
  // start gates the runner behind `data.startMetrics` until "Continue to session" is
  // tapped — asking "how do you feel before you start" makes no sense on a workout
  // already in progress, so a *resumed* workout (the `?/start` response carries
  // `hydration`) skips this gate entirely and never sets it true. Set once, in the
  // `?/start` handler below, from the same `hydration` signal the resume path already threads
  // back — never re-derived anywhere else. If the plan declares no `start` metrics at
  // all there is nothing to show, so the gate is skipped rather than surfacing an empty
  // sheet with only a Continue button.
  let showPreSession = $state(false);

  // The one action-error surface for the whole runner (UI-DECISIONS §2) — every
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
  // expanding one must not affect the other. Always the *prescribed* slug, never a
  // substitute's — the key identifies the slot in the session, not the movement
  // currently filling it.
  let openSlug = $state<string | undefined>(trackedExerciseKeys(data.session)[0]);

  // Logged sets this workout, keyed by `setLogKey`, holding what was actually submitted
  // (never the pre-fill it started from — the ledger reads from this). Keys are the
  // shape a resumed workout would rebuild from persisted `set_log` rows.
  const loggedSets = new SvelteMap<string, LoggedSet>();

  // Optional sets added beyond a ranged prescription's minimum, keyed by
  // `${block.key}:${slug}` — see `shownSetsFor` for why this is not the same counter as
  // `setCountDelta`.
  const addedSets = new SvelteMap<string, number>();

  // Sets added or dropped by the deviation sheet's `add_set`/`drop_set`, as a signed
  // delta keyed `${block.key}:${slug}` — again, see `shownSetsFor`.
  const setCountDelta = new SvelteMap<string, number>();

  // Rounds completed so far for a `type: rounds` block, keyed by block key.
  const completedRounds = new SvelteMap<string, number>();

  // The substitute actually swapped in for a prescribed exercise (UI-DECISIONS §6),
  // keyed `${block.key}:${slug}` by the *prescribed* slug, holding the substitute
  // resolved through the plan's catalogue (`resolveSubstitute`) rather than its bare
  // slug: everything downstream — the strip's `exercise_slug`, the ledger's target, the
  // reps-vs-duration dial, the L/R rows — has to come from the movement being performed,
  // not the one it replaced.
  const substitutedExercises = new SvelteMap<string, ResolvedExercise>();

  // Exercises skipped via the deviation sheet, keyed `${block.key}:${slug}`. A skip is
  // not just a logged row: the exercise stops offering slots, collapses with that state,
  // and counts as finished for auto-advance.
  const skippedExercises = new SvelteSet<string>();

  // Conditional exercises whose condition prompt was dismissed via "Do it" — the
  // prescribed movement is being done as-is, so no deviation is logged.
  const dismissedConditions = new SvelteSet<string>();

  // Groups the six maps/sets above behind the shape `$lib/session/ledger`'s functions
  // take explicitly rather than close over — see that module's own doc comment. The
  // object is a plain wrapper around the same reactive collections, so reading through
  // it inside a `$derived.by` still tracks each collection's own reactivity.
  const ledger: SessionLedger = {
    loggedSets,
    addedSets,
    setCountDelta,
    completedRounds,
    substitutedExercises,
    skippedExercises,
  };

  // The rest timer overlay's spec and up-next card, or undefined when no rest is active.
  let activeRest = $state<{ spec: RestSpec; upNext: UpNext } | undefined>(undefined);
  // Which exercise the deviation sheet is open for, or undefined when closed. Block-keyed
  // like every other map here: a bare slug picks the wrong prescription when the same
  // movement appears in two blocks with different overrides.
  let deviationFor = $state<{ blockKey: string; slug: string } | undefined>(undefined);

  // Whether the end-of-session wrap-up sheet is showing.
  let showWrapUp = $state(false);
  // Tap-to-select values for session-scope metrics, keyed by metric key — held here for
  // display only; each tap fires its own `?/logMetric` submission (UI-DECISIONS §8).
  const sessionMetricValues = new SvelteMap<string, number | string>();

  /**
   * Everything the pinned strip needs about the one open exercise (UI-DECISIONS §1: one
   * exercise open, §2: the strip logs exactly one set). `next` is `undefined` once every
   * offered set is logged — the strip then shows its finished state rather than
   * vanishing, so the ledger's reserved bottom padding stays honest. See
   * `$lib/session/ledger`'s `resolveOpenContext` for the resolution itself.
   */
  const openContext = $derived.by(() => resolveOpenContext(data.session, ledger, openSlug));

  /**
   * Every exercise that needs nothing more from the user — each offered slot logged, or
   * the whole exercise skipped. Drives both the collapsed row's completion state
   * (UI-DECISIONS §1) and where auto-advance goes next. See `$lib/session/ledger`'s
   * `computeDoneExercises` for the resolution itself.
   */
  const doneExercises = $derived.by(() => computeDoneExercises(data.session, ledger));

  /** The strip's real rendered height, so `.blocks` can reserve exactly that much
   * scroll padding — the last block must never be trapped underneath it. */
  let stripHeight = $state(0);

  /**
   * Set when an exercise finished while its rest was still counting down: advancing then
   * would swap the strip's context out from under a timer the user is still watching, so
   * the move waits until the rest is dismissed — always by the user tapping "start next
   * set early" (`onSkip`/`onRestDismissed`; UI-DECISIONS §4's rest has no auto-dismiss).
   */
  let advanceAfterRest = $state(false);

  /** Auto-advance (UI-DECISIONS §1): open the next exercise that still needs something.
   * Nothing left means nothing moves — the finished exercise stays open showing its
   * finished strip rather than the list snapping somewhere arbitrary. */
  function advance(): void {
    advanceAfterRest = false;
    const next = nextExerciseKey(data.session, doneExercises, openSlug);
    if (next) openSlug = next;
  }

  /** Manual selection always wins over auto-advance — including over an advance a
   * running rest timer has not released yet, which would otherwise yank the user off the
   * row they just deliberately tapped. */
  function openExercise(key: string): void {
    advanceAfterRest = false;
    openSlug = key;
  }

  function onSetLogged(slot: SetSlot, logged: LoggedSet): void {
    loggedSets.set(slot.key, logged);
    const context = openContext;
    if (!context) return;

    // Recomputed from the map rather than read off `openContext.next`, so this does not
    // depend on when the derived happens to be re-pulled.
    const nextSlot = nextUnloggedSlot(
      slotsFor(ledger, context.block, context.prescribed),
      loggedSets,
    );
    const finished = nextSlot === undefined;
    const rest = restForSet(context.block, context.exercise);

    if (rest) {
      activeRest = {
        spec: restSpecFrom(rest),
        upNext: upNextForSetLogged(
          data.session,
          ledger,
          doneExercises,
          data.prefillByExercise,
          context,
          nextSlot,
        ),
      };
      advanceAfterRest = finished;
    } else if (finished) {
      advance();
    }
  }

  function onRestDismissed(): void {
    activeRest = undefined;
    if (advanceAfterRest) advance();
  }

  /**
   * A rounds block is a circuit, so finishing a round restarts it at the top rather than
   * carrying on where the generic advance left the cursor — which is the *last* exercise
   * of the block, since that is what completing the round means. `nextExerciseKey` scoped
   * to this one block does the picking, so a skipped first exercise is stepped over the
   * same way it is everywhere else; incrementing the round has already made every
   * unskipped exercise in the block un-done again.
   *
   * Without this, round 2 would start at position 4 of 4, and a rounds block followed by
   * another block would advance straight *out* of the circuit after round 1, abandoning
   * the remaining rounds with no prompt (UI-DECISIONS §6 — rounds are a primitive the
   * design commits to handling).
   */
  function startNextRound(block: ResolvedBlock): void {
    const round = (completedRounds.get(block.key) ?? 0) + 1;
    completedRounds.set(block.key, round);

    const top = nextExerciseKey({ blocks: [block] }, doneExercises);

    const rest = restBetweenRounds(block, round);
    if (rest) {
      const upNext: UpNext = upNextForExerciseAt(exerciseAt(data.session, ledger, top));
      activeRest = { spec: restSpecFrom(rest), upNext };
    }

    if (top) openExercise(top);
  }

  /** The exercise the deviation sheet is acting on, looked up by `${block.key}:${slug}`
   * — a bare-slug `find` across every block returns the wrong prescription (and so the
   * wrong `substitutes` list) whenever a movement appears in two blocks. */
  const deviationTarget = $derived.by(() => {
    const target = deviationFor;
    if (!target) return undefined;
    const block = data.session.blocks.find((b) => b.key === target.blockKey);
    const prescribed = block?.exercises.find((e) => e.slug === target.slug);
    if (!block || !prescribed) return undefined;
    return {
      key: `${block.key}:${prescribed.slug}`,
      block,
      prescribed,
      exercise: performed(ledger, block.key, prescribed),
    };
  });

  /** Resolve a declared substitute through the plan's catalogue and swap it in for the
   * prescribed exercise. */
  function applySubstitute(
    blockKey: string,
    prescribed: ResolvedExercise,
    substituteSlug: string,
  ): void {
    const substitute = resolveSubstitute(data.catalogue, data.loads, prescribed, substituteSlug);
    if (!substitute) {
      // CONTRACT requires every substitute to be declared in the catalogue, so this is
      // unreachable for a valid plan — but the deviation row has already been written, so
      // say so rather than leaving the runner logging the original in silence.
      actionError = `\`${substituteSlug}\` is not in this plan's exercise catalogue, so the swap could not be applied — the deviation was recorded.`;
      return;
    }
    substitutedExercises.set(`${blockKey}:${prescribed.slug}`, substitute);
  }

  /** A deviation the server accepted, made true in the runner (see `DeviationSheet`'s
   * `onApplied`). Keyed by the prescribed slug, always — a swapped exercise is still the
   * same slot of the same session. */
  function onDeviationApplied(
    kind: Exclude<DeviationKind, "stop_red_flag">,
    substituteSlug: string | undefined,
  ): void {
    const target = deviationTarget;
    if (!target) return;

    if (kind === "skip") {
      skippedExercises.add(target.key);
      advance();
    } else if (kind === "substitute") {
      if (substituteSlug) applySubstitute(target.block.key, target.prescribed, substituteSlug);
    } else {
      setCountDelta.set(
        target.key,
        (setCountDelta.get(target.key) ?? 0) + (kind === "add_set" ? 1 : -1),
      );
    }
  }

  /**
   * A resumed workout's own rows, reconstructed server-side (`$lib/session/resume`) and
   * poured into the very same maps the live interactive paths above fill — so nothing
   * downstream (the ledger, `openContext`'s cursor, `doneExercises`, the wrap-up sheet)
   * needs to know whether a workout was resumed or started fresh.
   *
   * Substitutes arrive as bare slugs and go through `applySubstitute`, the same function a
   * live swap uses, rather than as pre-resolved exercises from the server: `resolveSubstitute`
   * is pure and the catalogue is already here (`data.catalogue`/`data.loads`), so resolving
   * it twice in two places is how the two copies drift.
   */
  function applyHydration(hydration: SessionHydration): void {
    for (const { key, logged } of hydration.loggedSets) loggedSets.set(key, logged);
    for (const key of hydration.skipped) skippedExercises.add(key);
    for (const { key, delta } of hydration.setCountDelta) setCountDelta.set(key, delta);
    for (const { blockKey, rounds } of hydration.completedRounds) {
      completedRounds.set(blockKey, rounds);
    }
    for (const { key, value } of hydration.sessionMetrics) sessionMetricValues.set(key, value);

    for (const { blockKey, prescribedSlug, substituteSlug } of hydration.substitutes) {
      const prescribed = data.session.blocks
        .find((block) => block.key === blockKey)
        ?.exercises.find((exercise) => exercise.slug === prescribedSlug);
      if (prescribed) applySubstitute(blockKey, prescribed, substituteSlug);
    }

    // Resuming onto a finished first exercise and showing its "every set logged" strip
    // would make the user hunt for where they were — the same thing auto-advance exists to
    // prevent. Search from the top rather than from `openSlug`, which is still the default
    // first exercise at this point.
    const next = nextExerciseKey(data.session, doneExercises);
    if (next) openSlug = next;
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
        // Only ever present when the idempotent lookup resumed an existing workout.
        const hydration = result.data.hydration as SessionHydration | undefined;
        if (hydration) {
          applyHydration(hydration);
        } else if (data.startMetrics.length > 0) {
          showPreSession = true;
        }
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
  <!-- UI-DECISIONS §2: nothing below posts a real workout_id until the
       async `?/start` round-trip resolves, so no logging control renders until then —
       a quiet "starting" state beats a live-looking strip that 400s on every tap. -->
  <p class="starting">Starting your session…</p>
{:else if showPreSession}
  <!-- Pre-session metrics (ARCHITECTURE §9): a genuine gate, following the same "quiet placeholder
       until satisfied" precedent as the `!workoutId` branch above — the runner itself
       does not render underneath, rather than a dismissible overlay on top of it, so
       nothing here can be tapped before the pre-session prompt is dealt with. -->
  <div class="pre-session">
    <h2>Before you start</h2>
    {#each data.startMetrics as metric (metric.key)}
      <MetricRow
        {metric}
        {workoutId}
        selected={sessionMetricValues.get(metric.key)}
        onSelected={(value) => sessionMetricValues.set(metric.key, value)}
        onResult={afterAction}
      />
    {/each}
    <div class="sheet-actions">
      <button type="button" class="primary" onclick={() => (showPreSession = false)}>
        Continue to session
      </button>
    </div>
  </div>
{:else}
  <!-- The strip is `position: fixed`, so the scroll area has to reserve its measured
       height or the last block sits underneath it forever. -->
  <div
    class="blocks"
    style:padding-bottom={stripHeight > 0 ? `calc(${stripHeight}px + 1rem)` : undefined}
  >
    {#each data.session.blocks as block (block.key)}
      <BlockSection
        {block}
        {ledger}
        {loggedSets}
        {doneExercises}
        {openSlug}
        {addedSets}
        {dismissedConditions}
        {workoutId}
        onOpen={openExercise}
        {applySubstitute}
        onResult={afterAction}
        onStartNextRound={startNextRound}
      />
    {/each}

    <button type="button" class="end-session" onclick={() => (showWrapUp = true)}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          d="M5 3v18M5 4h11l-2.5 4L16 12H5"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      End session
    </button>
  </div>
{/if}

{#if workoutId && !showPreSession && openContext}
  {@const ctx = openContext}
  {@const slot = ctx.next}
  {@const fill = prefillFor(
    ledger,
    data.prefillByExercise,
    ctx.block.key,
    ctx.prescribed.slug,
    ctx.exercise.slug,
    ctx.exercise.perSide,
    slot,
  )}
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
    onDeviate={() => (deviationFor = { blockKey: ctx.block.key, slug: ctx.prescribed.slug })}
  />
{/if}

{#if activeRest}
  {@const rest = activeRest}
  <!-- UI-DECISIONS §4: both escapes stay user-initiated — +30s and "start the next set
       early" (`onSkip`, wired to the same dismissal `advanceAfterRest` reads). There is
       no auto-dismiss: rest never ends on its own, only on a deliberate tap, so
       `onRestDismissed` has exactly one caller. -->
  <RestTimer spec={rest.spec} upNext={rest.upNext} onSkip={onRestDismissed} />
{/if}

{#if deviationTarget && workoutId}
  {@const target = deviationTarget}
  <!-- `exercise_slug` is the movement actually being performed (the substitute, after a
       swap) — that is what is being skipped, added to or dropped. `substitutes` comes
       from the *prescription*, block-keyed, because that is what the plan declared for
       this occasion. -->
  <DeviationSheet
    exerciseSlug={target.exercise.slug}
    substitutes={target.prescribed.substitutes}
    canChangeSetCount={target.block.type !== "rounds"}
    {workoutId}
    onClose={() => (deviationFor = undefined)}
    onApplied={onDeviationApplied}
    {onRedFlagStop}
    onError={(message) => (actionError = message)}
  />
{/if}

{#if showWrapUp && workoutId}
  <WrapUpSheet
    {workoutId}
    endMetrics={data.endMetrics}
    nextMorningMetrics={data.nextMorningMetrics}
    {sessionMetricValues}
    {storageKey}
    onClose={() => (showWrapUp = false)}
    onResult={afterAction}
  />
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
    flex: none;
    min-height: 2.75rem;
    min-width: 2.75rem;
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
  /* The pre-session gate (UI-DECISIONS §8): styled like `.sheet` below, but in-flow rather than a
     fixed backdrop overlay — it stands in for the runner entirely until dismissed, the
     same "quiet placeholder" precedent as `.starting`, so nothing underneath it is ever
     reachable before "Continue to session" is tapped. */
  .pre-session {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: 1.25rem;
    margin-top: 1rem;
    display: grid;
    gap: 0.75rem;
  }
  .pre-session h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  .end-session {
    justify-self: start;
    min-height: 2.75rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    border: none;
    background: var(--accent);
    color: var(--accent-in);
    font-weight: 700;
    border-radius: var(--r-sm);
    padding: 0.5rem 1rem;
  }
  /* Shared visually with `WrapUpSheet`'s own finish/back buttons — scoped styles don't
     cross component boundaries, so this is a deliberate duplicate of that rule rather
     than an import. Still needed here for the pre-session gate's "Continue" button. */
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
</style>
