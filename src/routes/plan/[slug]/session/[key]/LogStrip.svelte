<script lang="ts">
  /**
   * The log strip (UI §2): pinned to the bottom of the viewport, in the thumb
   * zone, logging exactly one set — the next unlogged slot of the open exercise. A reps
   * (or duration) stepper, a load stepper unless the resolved load is bodyweight, and
   * three effort keys. **Tapping an effort key logs the set**; there is no save button,
   * so when the pre-fill is right the whole interaction is one tap.
   *
   * This replaces the per-set input row that used to live inside the exercise body. That
   * row could not fit a phone: `3rem | 1fr | 1fr | auto` with two `<input type=number>`
   * (min-content ≈ 170px each in Chromium) and three 2.75rem effort keys needs ~380px of
   * track inside a card that has ~254px at 360px wide, so it overflowed the viewport
   * instead of shrinking. One set's controls, once, at the bottom of the screen is the
   * only layout that both fits and is usable one-handed mid-set.
   */

  import { SvelteMap } from "svelte/reactivity";
  import { parseNumericField, stepValue } from "$lib/session/stepper";
  import type { LoggedSet, ResolvedExercise, SetSlot } from "$lib/session/session-view";
  import { newOpId } from "$lib/sync/ops";
  import { logWrite } from "$lib/sync/client.svelte";
  import FigureIcon from "./FigureIcon.svelte";

  let {
    planSlug,
    workoutClientId,
    exercise,
    slot,
    context,
    lastPerformance,
    prefill,
    onLogged,
    onError,
    onDeviate,
    onCancel,
    height = $bindable(0),
  }: {
    planSlug: string;
    workoutClientId: string;
    exercise: ResolvedExercise;
    /** The slot the next tap writes, or `undefined` once every offered set is logged. */
    slot: SetSlot | undefined;
    /** "Set 2 of 3", "Round 1 of 2 — right" (`formatSlotContext`). */
    context: string;
    /** "Last time 11 at 12 kg" (`formatLastPerformance`). */
    lastPerformance: string;
    prefill: { reps?: number; weightKg?: number; durationS?: number };
    /** Reports what was *actually submitted* — read straight off the op this component
     * built, never off the pre-fill the steppers happened to start at. */
    onLogged: (slot: SetSlot, logged: LoggedSet) => void;
    /** The page's single error surface. */
    onError: (message: string | undefined) => void;
    onDeviate: () => void;
    /** Present only when the strip is re-showing an already-logged slot for correction
     * (a tap on a logged ledger row) rather than the next unlogged one — swaps "Change"
     * for a "Cancel" that backs out without writing anything, and hides the last-time
     * line, which names history irrelevant to a value already on screen. */
    onCancel?: () => void;
    /** Measured, so the ledger can reserve exactly this much scroll padding. */
    height?: number;
  } = $props();

  type Field = "reps" | "weightKg" | "durationS";

  /**
   * Stepper values the user has moved off the pre-fill, keyed by slot — held as the raw
   * strings the inputs carry so a half-typed "1" never snaps back to the pre-fill
   * mid-keystroke. Keying by slot (rather than resetting on change) means the strip
   * needs no effect to follow the cursor, and an adjustment survives looking at another
   * exercise and coming back.
   *
   * A draft *shadows* the pre-fill, so it has to be dropped the moment it stops
   * describing something unsubmitted — on a successful log, and on a cancelled
   * correction. Without that, correcting a logged row to 99, cancelling, and tapping the
   * row again re-offered 99: a number that was never logged, presented as the current
   * value, one effort tap from being committed. CLAUDE.md's rule is that client state is
   * what was submitted, never what was pre-filled; a surviving draft is a third thing
   * that is neither.
   */
  const edits = new SvelteMap<string, Partial<Record<Field, string>>>();

  function clearDraft(key: string): void {
    edits.delete(key);
  }

  const draft = $derived(slot ? (edits.get(slot.key) ?? {}) : {});
  const repsValue = $derived(draft.reps ?? asText(prefill.reps));
  const weightValue = $derived(draft.weightKg ?? asText(prefill.weightKg));
  const durationValue = $derived(draft.durationS ?? asText(prefill.durationS));
  const showLoadDial = $derived(exercise.type !== "time" && exercise.load?.isBodyweight !== true);

  function asText(value: number | undefined): string {
    return value === undefined ? "" : String(value);
  }

  function setField(field: Field, value: string): void {
    if (!slot) return;
    edits.set(slot.key, { ...draft, [field]: value });
  }

  /**
   * UI §3: the load dial steps 1 kg, with no per-load-configuration increment
   * and no new contract field. Duration steps 5 sec, the granularity a held position is
   * actually timed at. The arithmetic itself is `$lib/session/stepper.ts`, where it is
   * unit-tested — it produces `weight_kg`, and a stepper that drifts reaches the export.
   */
  function step(field: Field, delta: number): void {
    const current =
      field === "reps" ? repsValue : field === "weightKg" ? weightValue : durationValue;
    setField(field, stepValue(current, delta));
  }

  /**
   * UI §2: tapping an effort key logs the set — and *only* tapping an effort
   * key does. Kept for the same reason it existed under a `<form>`: Enter dismisses the
   * keyboard rather than doing anything else, which is what it should do regardless of
   * how the tap is wired up.
   */
  function onDialKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.blur();
  }

  /**
   * True from the moment an effort key is tapped until `logWrite` resolves, success or
   * failure. Without it a second tap inside that window lands *after* `onLogged` has
   * advanced the cursor, writing a real set against N+1 that the user never performed —
   * and with a fresh op id for a genuinely different slot, so idempotency on the id alone
   * cannot catch it. The old per-set rows got this for free by disabling themselves once
   * logged; one shared strip has to hold the flag itself.
   */
  let submitting = $state(false);

  /**
   * `logWrite` writes to IndexedDB, which either succeeds or throws atomically — unlike
   * the network round trip this replaces, there is no "it might have landed, we just
   * lost the response" ambiguity, so a retry after a failure needs no stable op id to
   * stay idempotent against: nothing was written the first time. A fresh id per tap is
   * exactly as safe here as a reused one, and simpler.
   */
  async function submitEffort(difficulty: "easy" | "medium" | "hard"): Promise<void> {
    if (submitting || !slot) return;
    const loggedSlot = slot;

    const submitted: LoggedSet = {
      reps: exercise.type === "time" ? undefined : parseNumericField(repsValue),
      weightKg:
        exercise.type === "time" || !showLoadDial ? undefined : parseNumericField(weightValue),
      durationS: exercise.type === "time" ? parseNumericField(durationValue) : undefined,
      difficulty,
    };

    submitting = true;
    try {
      await logWrite(planSlug, {
        kind: "set",
        id: newOpId(),
        workoutClientId,
        exerciseSlug: exercise.slug,
        setNo: loggedSlot.setNo,
        side: loggedSlot.side,
        reps: submitted.reps,
        weightKg: submitted.weightKg,
        durationS: submitted.durationS,
        difficulty: submitted.difficulty,
        // `onCancel` is only ever supplied when the strip is re-showing an already-logged
        // row for correction (see the prop's own doc comment) — the server must not infer
        // this from a reference match on its own (`$lib/db/workout.ts`'s `logSet`).
        isCorrection: !!onCancel,
      });
      clearDraft(loggedSlot.key);
      onLogged(loggedSlot, submitted);
      onError(undefined);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      submitting = false;
    }
  }

  /**
   * Backing out of a correction has to drop the draft as well as close the strip — the
   * value the user typed and then abandoned must not be waiting for them the next time
   * they tap the same row (see `edits`). `onCancel` is only ever supplied in correction
   * mode, so this is only ever reachable there.
   */
  function cancel(): void {
    if (slot) clearDraft(slot.key);
    onCancel?.();
  }

  const efforts = [
    { level: "easy", label: "Easy" },
    { level: "medium", label: "Medium" },
    { level: "hard", label: "Hard" },
  ] as const;
</script>

<div class="log-strip" bind:clientHeight={height}>
  <div class="strip-top">
    <span class="strip-context">
      <span class="strip-exercise">{exercise.name}</span>
      <span class="strip-set tabular">{context}</span>
    </span>
    {#if onCancel}
      <button type="button" class="strip-change" onclick={cancel}>Cancel</button>
    {:else}
      <!-- UI §7: deviating must never be slower than lying, so skip/swap/add
           live one tap away here, not at the bottom of the exercise body. -->
      <button type="button" class="strip-change" onclick={onDeviate}>Change</button>
    {/if}
  </div>

  {#if slot}
    {#if !onCancel}
      <p class="strip-last">{lastPerformance}</p>
    {/if}

    <div class="log-fields">
      <div class="dials" class:dials--single={!showLoadDial}>
        {#if exercise.type === "time"}
          <div class="dial">
            <button
              type="button"
              class="dial-btn"
              onclick={() => step("durationS", -5)}
              aria-label="5 seconds fewer">−</button
            >
            <span class="dial-val">
              <input
                type="text"
                inputmode="numeric"
                class="dial-n tabular"
                aria-label="Seconds held"
                value={durationValue}
                oninput={(event) => setField("durationS", event.currentTarget.value)}
                onkeydown={onDialKeydown}
              />
              <span class="dial-u"><FigureIcon kind="time" /> sec</span>
            </span>
            <button
              type="button"
              class="dial-btn"
              onclick={() => step("durationS", 5)}
              aria-label="5 seconds more">+</button
            >
          </div>
        {:else}
          <div class="dial">
            <button
              type="button"
              class="dial-btn"
              onclick={() => step("reps", -1)}
              aria-label="One rep fewer">−</button
            >
            <span class="dial-val">
              <input
                type="text"
                inputmode="numeric"
                class="dial-n tabular"
                aria-label="Reps"
                value={repsValue}
                oninput={(event) => setField("reps", event.currentTarget.value)}
                onkeydown={onDialKeydown}
              />
              <span class="dial-u"><FigureIcon kind="reps" /> reps</span>
            </span>
            <button
              type="button"
              class="dial-btn"
              onclick={() => step("reps", 1)}
              aria-label="One rep more">+</button
            >
          </div>

          {#if showLoadDial}
            <div class="dial">
              <button
                type="button"
                class="dial-btn"
                onclick={() => step("weightKg", -1)}
                aria-label="One kilogram less">−</button
              >
              <span class="dial-val">
                <input
                  type="text"
                  inputmode="numeric"
                  class="dial-n tabular"
                  aria-label="Load in total kilograms"
                  value={weightValue}
                  oninput={(event) => setField("weightKg", event.currentTarget.value)}
                  onkeydown={onDialKeydown}
                />
                <span class="dial-u"><FigureIcon kind="load" /> kg total</span>
              </span>
              <button
                type="button"
                class="dial-btn"
                onclick={() => step("weightKg", 1)}
                aria-label="One kilogram more">+</button
              >
            </div>
          {/if}
        {/if}
      </div>

      <!-- UI §5: one, two or three filled segments in the accent. Never a
           traffic light — colouring "Hard" red would say *stop* about the outcome the
           plan is usually trying to produce. -->
      <div class="efforts">
        {#each efforts as effort, i (effort.level)}
          <button
            type="button"
            class="effort-key"
            data-difficulty={effort.level}
            disabled={submitting}
            onclick={() => submitEffort(effort.level)}
          >
            <span class="effort-name">{effort.label}</span>
            <span class="effort-fill">
              {#each [0, 1, 2] as seg (seg)}
                <i class:on={seg <= i}></i>
              {/each}
            </span>
          </button>
        {/each}
      </div>
    </div>
  {:else}
    <p class="strip-done">Nice — every set's logged. Open the next exercise.</p>
  {/if}
</div>

<style>
  .log-strip {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    /* Above the ledger it covers, below the rest overlay (50) and the sheets (60) — a
       sheet must never have this poking through it. */
    z-index: 40;
    background: var(--surface);
    border-top: 1px solid var(--line);
    padding: var(--s-3) var(--s-4);
    padding-bottom: calc(var(--s-3) + env(safe-area-inset-bottom));
  }
  .strip-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
  }
  .strip-context {
    min-width: 0;
    font-size: var(--t-sm);
  }
  .strip-exercise {
    font-weight: var(--w-bold);
  }
  .strip-set {
    color: var(--muted);
  }
  .strip-set::before {
    content: " · ";
  }
  .strip-change {
    flex: none;
    min-height: 2.75rem;
    border: none;
    background: var(--raised);
    color: var(--muted);
    border-radius: var(--r-lg);
    padding: 0 var(--s-4);
    font-size: var(--t-sm);
    font-weight: var(--w-semi);
  }
  .strip-last {
    margin: 0.1rem 0 0.5rem;
    color: var(--dim);
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
  }
  .strip-done {
    margin: 0.4rem 0 0.2rem;
    color: var(--muted);
    font-size: var(--t-sm);
  }
  .dials {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-2);
  }
  .dials--single {
    grid-template-columns: 1fr;
  }
  .dial {
    display: grid;
    /* `minmax(0, 1fr)` on the value track, not `1fr`: an input's `min-width: auto` floor
       is what made the old set row unshrinkable, and this is the same shape. */
    grid-template-columns: 2.75rem minmax(0, 1fr) 2.75rem;
    align-items: center;
    background: var(--raised);
    border-radius: var(--r-md);
    height: 4.25rem;
  }
  .dial-btn {
    height: 100%;
    border: none;
    background: none;
    color: var(--muted);
    font-size: var(--t-xl);
    line-height: 1;
    border-radius: var(--r-md);
    padding: 0;
  }
  .dial-val {
    display: grid;
    justify-items: center;
    gap: var(--s-1);
    min-width: 0;
  }
  .dial-n {
    width: 100%;
    min-width: 0;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--t-xl);
    font-weight: var(--w-bold);
    line-height: 1;
    text-align: center;
    padding: 0;
  }
  .dial-u {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    font-size: var(--t-xs);
    font-weight: var(--w-semi);
    color: var(--dim);
    line-height: 1;
    text-align: center;
  }
  .efforts {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--s-2);
    margin-top: 0.5rem;
  }
  .effort-key {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    min-height: 3.5rem;
    border: 1px solid var(--line);
    background: var(--raised);
    border-radius: var(--r-md);
    padding: var(--s-2) var(--s-1);
  }
  .effort-key:disabled {
    opacity: 0.55;
  }
  .effort-name {
    font-size: var(--t-sm);
    font-weight: var(--w-semi);
  }
  .effort-fill {
    display: flex;
    gap: var(--s-1);
  }
  .effort-fill i {
    display: block;
    width: 18px;
    height: 6px;
    border-radius: 3px;
    background: var(--line);
  }
  .effort-fill i.on {
    background: var(--accent);
  }
</style>
