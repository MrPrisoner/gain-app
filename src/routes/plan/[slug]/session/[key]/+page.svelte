<script lang="ts">
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import { ulid } from "ulidx";
  import { applyAction, enhance } from "$app/forms";
  import type { ActionResult } from "@sveltejs/kit";
  import type { ActionData, PageData } from "./$types";
  import {
    formatLoggedSet,
    formatRepsOrDuration,
    formatRepsOrDurationOrDash,
    formatSlotContext,
    formatSlotLabel,
    formatTarget,
    formatTargetOrSets,
    formatUpNextSlot,
    highestLoggedSetNo,
    nextExerciseKey,
    nextUnloggedSlot,
    resolveSubstitute,
    restForSet,
    restBetweenRounds,
    setLogKey,
    setSlotsFor,
    summariseLoggedSets,
    trackedExerciseKeys,
    visibleSetCount,
    type LoggedSet,
    type ResolvedBlock,
    type ResolvedExercise,
    type SetSlot,
  } from "$lib/session/session-view";
  import type { SessionHydration } from "$lib/session/resume";
  import type { DeviationKind } from "$lib/logs/types";
  import type { MetricDef } from "$lib/contract/schema";
  import { formatLastPerformance } from "$lib/session/prefill";
  import RestTimer from "./RestTimer.svelte";
  import DeviationSheet from "./DeviationSheet.svelte";
  import LogStrip from "./LogStrip.svelte";
  import { restSpecFrom, type RestSpec } from "$lib/session/rest-timer";
  import { trapFocus } from "$lib/actions/focus-trap";

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

  /** UI-DECISIONS §4's up-next card: a name and a pre-formatted target line, following
   * the same pattern as `LogStrip`'s `context`/`lastPerformance` props — `RestTimer`
   * itself does no formatting, only rendering. */
  type UpNext = { label: string; target: string };

  /** The block/prescribed/performed trio `exerciseAt` resolves a key to. */
  type ExerciseAt = {
    block: ResolvedBlock;
    prescribed: ResolvedExercise;
    exercise: ResolvedExercise;
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

  /**
   * The exercise actually being performed in a slot: the prescribed one, or the
   * substitute swapped in for it. Every render path that shows a name, a target, a dial
   * or a slug goes through here, which is what makes a swap real rather than cosmetic.
   */
  function performed(blockKey: string, prescribed: ResolvedExercise): ResolvedExercise {
    return substitutedExercises.get(`${blockKey}:${prescribed.slug}`) ?? prescribed;
  }

  /**
   * How many sets the exercise currently offers, or exactly the current round inside a
   * rounds block (where `set_no` *is* the round, so neither counter below applies).
   *
   * The two counters are deliberately separate mechanisms, not one number:
   *
   * - `addedSets` is UI-DECISIONS §6's "Add the optional 3rd set". A ranged prescription
   *   (`sets: [2, 3]`) draws its minimum and offers the sets the plan itself already
   *   declared. Taking one is *doing the plan*, so it logs no deviation, and it can never
   *   exceed the declared max.
   * - `setCountDelta` is the deviation sheet's `add_set`/`drop_set`: a manual override of
   *   what the prescription allows at all — a 4th set on a fixed-3 exercise, or dropping
   *   that same exercise to 2 — which *is* a deviation and always writes a row.
   *
   * Collapsing them would either make taking a declared optional set look like a
   * deviation in the export, or cap a genuine deviation at the ranged max it exists to
   * exceed.
   *
   * A drop has two floors. One slot, because a drop that reached zero is a skip wearing a
   * different name and the sheet already has a Skip that records itself honestly as one.
   * And `highestLoggedSetNo`, because dropping a set must stop the *next* slot being
   * offered, never hide one that was really performed — that row is in the database and
   * will be exported whatever the ledger draws.
   */
  function shownSetsFor(block: ResolvedBlock, prescribed: ResolvedExercise): number {
    if (block.type === "rounds") return 1;
    const key = `${block.key}:${prescribed.slug}`;
    const declared = visibleSetCount(prescribed.sets, addedSets.get(key) ?? 0).shown;
    return Math.max(
      1,
      highestLoggedSetNo(block.key, prescribed.slug, loggedSets.keys()),
      declared + (setCountDelta.get(key) ?? 0),
    );
  }

  function currentRoundOf(blockKey: string): number {
    return (completedRounds.get(blockKey) ?? 0) + 1;
  }

  /**
   * The block/prescribed/performed trio for any `${block.key}:${slug}` key the session
   * offers, or `undefined` for a checkoff block (never opened) or an unknown key. Used to
   * look up an exercise the runner is not currently *at* — the rest overlay's up-next
   * card needs to describe the exercise auto-advance is about to open, one step ahead of
   * `openContext`, which only ever describes `openSlug` itself.
   */
  function exerciseAt(key: string | undefined): ExerciseAt | undefined {
    if (!key) return undefined;
    for (const block of data.session.blocks) {
      if (block.tracking === "checkoff") continue;
      for (const prescribed of block.exercises) {
        if (`${block.key}:${prescribed.slug}` !== key) continue;
        return { block, prescribed, exercise: performed(block.key, prescribed) };
      }
    }
    return undefined;
  }

  /** Nothing else is scheduled — the rest overlay still needs an up-next card even when
   * this was the session's very last set or round. */
  function upNextFallback(): UpNext {
    return { label: "Nothing left", target: "Finish up when you're ready" };
  }

  /**
   * The slots an exercise currently offers — none at all once it has been skipped.
   *
   * The slot key stays on the **prescribed** slug even after a swap, because it names the
   * slot in the session rather than the movement filling it: session D's rounds block
   * prescribes `dead-bug` in its own right *and* offers it as a substitute for
   * `reverse-crunch` two rows below, so keying by the performed movement would collapse
   * the two exercises onto one another and mark one done by logging the other. `per_side`
   * does come from the performed movement — that is what decides whether there are L/R
   * rows to log at all. What the strip actually posts as `exercise_slug` is separate
   * again, and is always the performed movement (`LogStrip`'s `exercise` prop).
   */
  function slotsFor(block: ResolvedBlock, prescribed: ResolvedExercise): SetSlot[] {
    if (skippedExercises.has(`${block.key}:${prescribed.slug}`)) return [];
    return setSlotsFor(
      block,
      { slug: prescribed.slug, perSide: performed(block.key, prescribed).perSide },
      { shownSets: shownSetsFor(block, prescribed), currentRound: currentRoundOf(block.key) },
    );
  }

  /**
   * Everything the pinned strip needs about the one open exercise (UI-DECISIONS §1: one
   * exercise open, §2: the strip logs exactly one set). `next` is `undefined` once every
   * offered set is logged — the strip then shows its finished state rather than
   * vanishing, so the ledger's reserved bottom padding stays honest.
   *
   * `prescribed` is the session's own exercise (the thing every map is keyed by);
   * `exercise` is what is actually being performed, which is what gets logged.
   */
  const openContext = $derived.by(() => {
    if (!openSlug) return undefined;
    for (const block of data.session.blocks) {
      if (block.tracking === "checkoff") continue;
      for (const prescribed of block.exercises) {
        const key = `${block.key}:${prescribed.slug}`;
        if (key !== openSlug) continue;
        return {
          key,
          block,
          prescribed,
          exercise: performed(block.key, prescribed),
          shownSets: shownSetsFor(block, prescribed),
          next: nextUnloggedSlot(slotsFor(block, prescribed), loggedSets),
        };
      }
    }
    return undefined;
  });

  /**
   * Every exercise that needs nothing more from the user — each offered slot logged, or
   * the whole exercise skipped. Drives both the collapsed row's completion state
   * (UI-DECISIONS §1) and where auto-advance goes next.
   */
  const doneExercises = $derived.by(() => {
    const done = new SvelteSet<string>();
    for (const block of data.session.blocks) {
      if (block.tracking === "checkoff") continue;
      for (const prescribed of block.exercises) {
        const key = `${block.key}:${prescribed.slug}`;
        if (skippedExercises.has(key)) {
          done.add(key);
          continue;
        }
        const slots = slotsFor(block, prescribed);
        if (slots.length > 0 && nextUnloggedSlot(slots, loggedSets) === undefined) done.add(key);
      }
    }
    return done;
  });

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
    const nextSlot = nextUnloggedSlot(slotsFor(context.block, context.prescribed), loggedSets);
    const finished = nextSlot === undefined;
    const rest = restForSet(context.block, context.exercise);

    if (rest) {
      activeRest = { spec: restSpecFrom(rest), upNext: upNextForSetLogged(context, nextSlot) };
      advanceAfterRest = finished;
    } else if (finished) {
      advance();
    }
  }

  /**
   * The rest overlay's up-next card (UI-DECISIONS §4) after a set is logged. Two cases:
   *
   * - The exercise isn't finished — "next" is the next slot of the *same* exercise,
   *   formatted the same way `LogStrip`'s own context line is, plus the weight the strip
   *   would pre-fill for that slot (already resolved here for the currently-open
   *   exercise, so reusing it costs nothing extra).
   * - The exercise IS finished — "next" is whatever auto-advance (`nextExerciseKey`)
   *   would open once this rest is dismissed, named by its own target line. Scoped from
   *   `context.key` exactly like `advance()` itself, so the preview can never name a
   *   different exercise than the one that actually opens.
   */
  function upNextForSetLogged(
    context: {
      block: ResolvedBlock;
      prescribed: ResolvedExercise;
      exercise: ResolvedExercise;
      key: string;
      shownSets: number;
    },
    nextSlot: SetSlot | undefined,
  ): UpNext {
    if (nextSlot) {
      const weight = prefillFor(
        context.exercise.slug,
        context.exercise.perSide,
        nextSlot.side,
      ).weightKg;
      return {
        label: context.exercise.name,
        target: formatUpNextSlot(
          context.block,
          nextSlot,
          context.shownSets,
          context.exercise,
          weight,
        ),
      };
    }
    const next = exerciseAt(nextExerciseKey(data.session, doneExercises, context.key));
    return next
      ? { label: next.exercise.name, target: formatTarget(next.exercise) }
      : upNextFallback();
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
      const next = exerciseAt(top);
      const upNext: UpNext = next
        ? { label: next.exercise.name, target: formatTarget(next.exercise) }
        : upNextFallback();
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
      exercise: performed(block.key, prescribed),
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

{#snippet metricRow(metric: MetricDef)}
  <!-- Shared by the pre-session prompt and the wrap-up sheet (UI-DECISIONS §8):
       a scale renders as one row of tappable cells (no slider), an enum the same way
       over its declared options. One tap both selects and submits — there is no
       separate "save" step and no per-metric skip control, since an untapped metric
       simply writes nothing.

       A `fieldset`/`legend` names the group rather than a `<label>` wrapping the whole
       row of buttons — a label associates with exactly one control, and this row is a
       group of several independent submit buttons, one per cell. The row is sized to
       its own cell count (`--cells`, set per instance below) rather than a fixed
       column count, so an 11-cell 0–10 scale and a 3-option enum each get a grid fit to
       what they actually render — UI-DECISIONS §8: "a row of tappable cells", not a
       wrap. -->
  {#if metric.type === "scale" || metric.type === "number"}
    {@const cellCount = (metric.max ?? 0) - (metric.min ?? 0) + 1}
    <fieldset class="metric-field">
      <legend>{metric.label}</legend>
      <div class="scale-row" style:--cells={cellCount}>
        {#each Array.from({ length: cellCount }, (_, i) => (metric.min ?? 0) + i) as value (value)}
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
    </fieldset>
  {:else if metric.type === "enum"}
    {@const options = metric.options ?? []}
    <fieldset class="metric-field">
      <legend>{metric.label}</legend>
      <div class="scale-row" style:--cells={options.length}>
        {#each options as option (option)}
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
    </fieldset>
  {/if}
{/snippet}

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
      {@render metricRow(metric)}
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
      <section class="block">
        <div class="block-head">
          <span class="block-name">{block.name}</span>
          {#if block.tracking === "checkoff"}<span class="tag">Check off</span>{/if}
          {#if block.type === "rounds"}
            <span class="tag">Rounds × {block.rounds}</span>
            {#if block.rounds}
              {@const completed = completedRounds.get(block.key) ?? 0}
              <!-- `role="img"` is what makes the `aria-label` stick: a bare `<span>` maps
                   to the generic role, which most screen readers refuse to name, so the
                   dots would be silently unlabelled. The role is honest here — this is a
                   picture of a count, and its parts carry no meaning on their own. -->
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
              {@const exerciseKey = `${block.key}:${prescribed.slug}`}
              {@const exercise = performed(block.key, prescribed)}
              {@const substituted = exercise.slug !== prescribed.slug}
              {@const isOpen = openSlug === exerciseKey}
              {@const isSkipped = skippedExercises.has(exerciseKey)}
              {@const isDone = doneExercises.has(exerciseKey)}
              {@const isRounds = block.type === "rounds"}
              {@const visible = isRounds
                ? { shown: 1, canAddMore: false }
                : visibleSetCount(prescribed.sets, addedSets.get(exerciseKey) ?? 0)}
              {@const slots = slotsFor(block, prescribed)}
              {@const nextSlot = nextUnloggedSlot(slots, loggedSets)}
              <!-- UI-DECISIONS §1: the collapsed row carries name, target *and completion
                   state*. Done collapses to what it actually was, skipped says so, and
                   what has not been reached yet recedes. -->
              {@const headline = isSkipped
                ? "Skipped"
                : isDone && !isOpen
                  ? summariseLoggedSets(
                      slots
                        .map((slot) => loggedSets.get(slot.key))
                        .filter((logged): logged is LoggedSet => logged !== undefined),
                    )
                  : formatTargetOrSets(exercise)}
              <li
                class="exercise"
                class:open={isOpen}
                class:done={!isOpen && isDone}
                class:upcoming={!isOpen && !isDone}
              >
                <button
                  type="button"
                  class="exercise-head"
                  onclick={() => openExercise(exerciseKey)}
                >
                  <span class="exercise-name">{exercise.name}</span>
                  <span class="exercise-meta tabular">{headline}</span>
                </button>

                {#if isOpen}
                  <div class="exercise-body">
                    {#if isSkipped}
                      <p class="cue">
                        Skipped — the deviation is recorded. Nothing further will be logged here.
                      </p>
                    {:else}
                      {#if prescribed.conditional && !dismissedConditions.has(exerciseKey)}
                        <p class="condition">{prescribed.condition}</p>
                        {#if !substituted && prescribed.substitutes.length > 0}
                          <div class="substitute-row">
                            {#each prescribed.substitutes as sub (sub)}
                              <form
                                method="POST"
                                action="?/logDeviation"
                                use:enhance={() => {
                                  return async ({ result }) => {
                                    await applyAction(result);
                                    afterAction(result);
                                    if (result.type === "success") {
                                      applySubstitute(block.key, prescribed, sub);
                                    }
                                  };
                                }}
                              >
                                <input type="hidden" name="workout_id" value={workoutId ?? ""} />
                                <input type="hidden" name="exercise_slug" value={prescribed.slug} />
                                <input type="hidden" name="kind" value="substitute" />
                                <!-- A condition-triggered swap is symptom-driven by
                                     definition: the `condition` text these chips render
                                     beside is what makes them appear at all, and in this
                                     plan it reads "if it reproduces familiar back
                                     symptoms, replace it". `other` said nothing, and the
                                     reason is exported as signal for the revising AI
                                     (UI-DECISIONS §7), so saying nothing is a real loss.
                                     `pain` is the code behind DeviationSheet's own
                                     "Symptoms" chip. Anything more precise needs a reason
                                     picker in this inline row, which §7 already puts in
                                     the deviation sheet — the sheet remains the way to
                                     record a swap for some other reason. -->
                                <input type="hidden" name="reason_code" value="pain" />
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
                      <!-- The head now shows the substitute's own name, so the old
                           "Swapped for: <slug>" cue would just repeat it. What is *not*
                           otherwise visible once the row renames itself is which
                           prescribed slot this is, so the cue points the other way. It
                           lives outside the conditional block because a swap can also
                           come from the deviation sheet on an exercise that was never
                           conditional. -->
                      {#if substituted}
                        <p class="cue">Swapped in for {prescribed.name}.</p>
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
                            <span class="led-target tabular"
                              >{formatRepsOrDurationOrDash(exercise)}</span
                            >
                            {#if logged}
                              <span class="led-actual tabular">{formatLoggedSet(logged)}</span>
                              {#if logged.difficulty}
                                {@const filled =
                                  logged.difficulty === "easy"
                                    ? 1
                                    : logged.difficulty === "medium"
                                      ? 2
                                      : 3}
                                <!-- `role="img"` for the same reason as `.rounds-indicator`
                                     above: without it the generic role drops the label and
                                     the three segments read as nothing at all. -->
                                <span
                                  class="led-effort"
                                  role="img"
                                  aria-label="Felt {logged.difficulty}"
                                >
                                  {#each [1, 2, 3] as seg (seg)}
                                    <i class:on={seg <= filled}></i>
                                  {/each}
                                </span>
                              {/if}
                            {:else}
                              <span class="led-actual led-pending"
                                >{slot.key === nextSlot?.key ? "Up next" : "Not logged yet"}</span
                              >
                            {/if}
                          </li>
                        {/each}
                      </ul>

                      <!-- UI-DECISIONS §6's optional set, and *only* that: this offers
                           sets the ranged prescription already declared, so it is not a
                           deviation and logs none. The deviation sheet's add_set/drop_set
                           is a separate mechanism against a separate counter — see
                           `shownSetsFor`. -->
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
                    {/if}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>

          {#if block.type === "rounds"}
            <button type="button" class="add-set" onclick={() => startNextRound(block)}>
              Round {(completedRounds.get(block.key) ?? 0) + 1} of {block.rounds} done
            </button>
          {/if}
        {/if}
      </section>
    {/each}
  </div>
{/if}

{#if workoutId && !showPreSession && openContext}
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
  <div class="sheet-backdrop" role="presentation">
    <!-- UI-DECISIONS §8: a real modal dialog, not just a visually
         bottom-sheeted div — `role="dialog"`/`aria-modal="true"` plus `aria-labelledby`
         pointing at the heading below announce it as such, and `use:trapFocus` (see
         `$lib/actions/focus-trap`) moves focus to that heading on open, cycles Tab
         within the sheet, restores focus to whatever had it on close, and treats
         Escape the same as the Back button. -->
    <div
      class="sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wrap-up-heading"
      use:trapFocus={{ onEscape: () => (showWrapUp = false) }}
    >
      <h3 id="wrap-up-heading" tabindex="-1" data-trap-focus-heading>How did it go?</h3>

      {#each data.endMetrics as metric (metric.key)}
        {@render metricRow(metric)}
      {/each}

      {#if data.nextMorningMetrics.length > 0}
        <!-- UI-DECISIONS §8: `next_morning` metrics are deliberately not asked here — they
             surface the following day. Say so explicitly rather than the user wondering
             whether the question was silently dropped (the nudge itself, on a future Today
             screen, is out of scope for this plan). -->
        <p class="next-morning-note">
          Not part of this wrap-up: {data.nextMorningMetrics.map((m) => m.label).join(", ")}. Asked
          again tomorrow, not now.
        </p>
      {/if}

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
    min-height: 2.75rem;
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
    margin-top: 0.5rem;
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
  /* Reset the browser's default fieldset chrome — this is a semantic grouping for the
     row of cells below (see `metricRow`'s comment), not a bordered box. */
  .metric-field {
    border: none;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  .metric-field legend {
    padding: 0;
    font: inherit;
    color: var(--text);
  }
  /* UI-DECISIONS §8: "a row of tappable cells — one tap, no slider." A grid sized to
     `--cells` (the metric's own cell count, set per instance in `metricRow`) rather than
     a fixed column count or `flex-wrap`, so an 11-cell 0–10 scale renders as one clean
     row at 320–360px instead of wrapping into ragged rows, and a metric with fewer
     cells (an enum, a narrower scale) gets a grid sized to what it actually renders
     rather than a hardcoded 11 columns. Each `<form>` is itself a grid item — there is
     no extra wrapper — so `minmax(0, 1fr)` lets a cell shrink below its button's content
     width instead of forcing the row wider than the viewport. */
  .scale-row {
    display: grid;
    grid-template-columns: repeat(var(--cells, 1), minmax(0, 1fr));
    gap: 0.3rem;
    margin-top: 0.3rem;
  }
  /* Touch-target sweep (UI-DECISIONS §12), ruled on rather than changed further: `min-height`
     alone (not `min-width`) is deliberate here. CONTRACT places no bound on a metric's
     `min`/`max`, and 0-10 scales are standard clinical convention for pain/symptom
     tracking, not test-fixture noise — real plans will keep declaring them. At 360px an
     11-cell row (`--cells: 11` from `metricRow`) leaves ~29px per cell, under the 44px
     square a lone tap target would want. Forcing every cell to a true 44×44 square would
     either force the row to wrap across lines (reopening the ragged-wrap bug UI-DECISIONS §8
     fixed) or need horizontal scroll inside an already-scrolling sheet — both worse than
     a row of adjacent cells sized to the scale's own width. Height is the tap dimension
     that matters for a row of buttons (the same reasoning `.exercise-head` and
     `.checkoff-pills .pill` already rely on) — width is intentionally left to shrink to
     fit whatever width the plan-declared scale needs in one row. */
  .scale-cell {
    width: 100%;
    min-height: 2.75rem;
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    border-radius: var(--r-xs);
    padding: 0.4rem 0.3rem;
  }
  .scale-cell.selected {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .next-morning-note {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0;
  }
</style>
