<script lang="ts">
  /**
   * The log strip (UI-DECISIONS §2): pinned to the bottom of the viewport, in the thumb
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

  import { ulid } from "ulidx";
  import { applyAction, enhance } from "$app/forms";
  import type { ActionResult } from "@sveltejs/kit";
  import { SvelteMap } from "svelte/reactivity";
  import type { LoggedSet, ResolvedExercise, SetSlot } from "$lib/session/session-view";

  let {
    workoutId,
    exercise,
    slot,
    context,
    lastPerformance,
    prefill,
    onLogged,
    onResult,
    onDeviate,
    height = $bindable(0),
  }: {
    workoutId: string;
    exercise: ResolvedExercise;
    /** The slot the next tap writes, or `undefined` once every offered set is logged. */
    slot: SetSlot | undefined;
    /** "Set 2 of 3", "Round 1 of 2 — right" (`formatSlotContext`). */
    context: string;
    /** "Last time 11 at 12 kg" (`formatLastPerformance`). */
    lastPerformance: string;
    prefill: { reps?: number; weightKg?: number; durationS?: number };
    /** Reports what was *actually submitted*, read back off the outgoing `FormData`. */
    onLogged: (slot: SetSlot, logged: LoggedSet) => void;
    /** The page's single action-error surface. */
    onResult: (result: ActionResult) => void;
    onDeviate: () => void;
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
   */
  const edits = new SvelteMap<string, Partial<Record<Field, string>>>();

  /**
   * One ULID per slot, minted lazily and reused for every retry of that same set —
   * `logSet` is idempotent on `client_id`, so a double tap, or a retry after a failed
   * submission, can never write the set twice. Deliberately a plain object rather than
   * reactive state: it is filled during render, and a `SvelteMap` here would invalidate
   * the very render that filled it.
   */
  const clientIds: Record<string, string> = {};
  function clientIdFor(key: string): string {
    const existing = clientIds[key];
    if (existing) return existing;
    const minted = ulid();
    clientIds[key] = minted;
    return minted;
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
   * UI-DECISIONS §3: the load dial steps 1 kg, with no per-load-configuration increment
   * and no new contract field. Duration steps 5 sec, the granularity a held position is
   * actually timed at. Nothing goes below zero.
   */
  function step(field: Field, delta: number): void {
    const current =
      field === "reps" ? repsValue : field === "weightKg" ? weightValue : durationValue;
    const parsed = Number.parseFloat(current);
    const base = Number.isFinite(parsed) ? parsed : 0;
    const next = Math.max(0, base + delta);
    // Pre-fills can carry halves (an odd total on a paired lift is what 1.25 kg plates
    // produce), so round the float noise off rather than the value.
    setField(field, String(Math.round(next * 100) / 100));
  }

  function numberFrom(form: FormData, name: string): number | undefined {
    const raw = form.get(name);
    if (typeof raw !== "string" || raw.trim() === "") return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }

  function difficultyFrom(form: FormData): LoggedSet["difficulty"] {
    const raw = form.get("difficulty");
    return raw === "easy" || raw === "medium" || raw === "hard" ? raw : undefined;
  }

  /**
   * UI-DECISIONS §2: tapping an effort key logs the set — and *only* tapping an effort
   * key does. HTML implicit submission would otherwise break that: pressing Go/Enter on a
   * phone keyboard while a dial input has focus fires a click at the form's default
   * button, which is the first submit button in tree order — the Easy key. The set would
   * log at an effort the user never chose, and the ledger is read-only with no delete, so
   * there is no undoing it. Enter dismisses the keyboard instead, which is what it should
   * have done anyway.
   */
  function onDialKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.blur();
  }

  /**
   * True from the moment an effort key is tapped until that submission resolves, success
   * or failure. Without it a second tap inside the round trip lands *after* `onLogged`
   * has advanced the cursor, writing a real set against N+1 that the user never
   * performed — and with a fresh `client_id` for a genuinely different slot, so `logSet`'s
   * idempotency cannot catch it. The old per-set rows got this for free by disabling
   * themselves once logged; one shared strip has to hold the flag itself.
   */
  let submitting = $state(false);

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
    <!-- UI-DECISIONS §7: deviating must never be slower than lying, so skip/swap/add
         live one tap away here, not at the bottom of the exercise body. -->
    <button type="button" class="strip-change" onclick={onDeviate}>Change</button>
  </div>

  {#if slot}
    <p class="strip-last">{lastPerformance}</p>

    <form
      method="POST"
      action="?/logSet"
      use:enhance={({ formData, cancel }) => {
        // Bug 9: the ledger renders from what was submitted, read straight off the
        // outgoing FormData — not from the pre-fill the steppers happened to start at.
        const submitted: LoggedSet = {
          reps: numberFrom(formData, "reps"),
          weightKg: numberFrom(formData, "weight_kg"),
          durationS: numberFrom(formData, "duration_s"),
          difficulty: difficultyFrom(formData),
        };
        const loggedSlot = slot;

        // Nothing writes a set without an effort on it (§2), and nothing writes a second
        // one while the first is still in flight — the `disabled` below closes the second
        // window a frame later than the tap does, so it is re-checked here.
        if (submitting || submitted.difficulty === undefined || !loggedSlot) {
          cancel();
          return;
        }
        submitting = true;

        return async ({ result }: { result: ActionResult }) => {
          try {
            await applyAction(result);
            onResult(result);
            if (result.type === "success") onLogged(loggedSlot, submitted);
          } finally {
            submitting = false;
          }
        };
      }}
    >
      <input type="hidden" name="workout_id" value={workoutId} />
      <input type="hidden" name="exercise_slug" value={exercise.slug} />
      <input type="hidden" name="set_no" value={slot.setNo} />
      {#if slot.side}<input type="hidden" name="side" value={slot.side} />{/if}
      <input type="hidden" name="client_id" value={clientIdFor(slot.key)} />

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
                name="duration_s"
                class="dial-n tabular"
                aria-label="Seconds held"
                value={durationValue}
                oninput={(event) => setField("durationS", event.currentTarget.value)}
                onkeydown={onDialKeydown}
              />
              <span class="dial-u">sec</span>
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
                name="reps"
                class="dial-n tabular"
                aria-label="Reps"
                value={repsValue}
                oninput={(event) => setField("reps", event.currentTarget.value)}
                onkeydown={onDialKeydown}
              />
              <span class="dial-u">reps</span>
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
                  name="weight_kg"
                  class="dial-n tabular"
                  aria-label="Load in total kilograms"
                  value={weightValue}
                  oninput={(event) => setField("weightKg", event.currentTarget.value)}
                  onkeydown={onDialKeydown}
                />
                <span class="dial-u">kg total</span>
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

      <!-- UI-DECISIONS §5: one, two or three filled segments in the accent. Never a
           traffic light — colouring "Hard" red would say *stop* about the outcome the
           plan is usually trying to produce. -->
      <div class="efforts">
        {#each efforts as effort, i (effort.level)}
          <button
            type="submit"
            name="difficulty"
            value={effort.level}
            class="effort-key"
            disabled={submitting}
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
    </form>
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
    padding: 0.7rem 1rem;
    padding-bottom: calc(0.7rem + env(safe-area-inset-bottom));
  }
  .strip-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .strip-context {
    min-width: 0;
    font-size: 0.85rem;
  }
  .strip-exercise {
    font-weight: 700;
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
    padding: 0 1rem;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .strip-last {
    margin: 0.1rem 0 0.5rem;
    color: var(--dim);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  .strip-done {
    margin: 0.4rem 0 0.2rem;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .dials {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
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
    font-size: 1.5rem;
    line-height: 1;
    border-radius: var(--r-md);
    padding: 0;
  }
  .dial-val {
    display: grid;
    justify-items: center;
    gap: 0.15rem;
    min-width: 0;
  }
  .dial-n {
    width: 100%;
    min-width: 0;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 1.6rem;
    font-weight: 750;
    line-height: 1;
    text-align: center;
    padding: 0;
  }
  .dial-u {
    font-size: 0.7rem;
    color: var(--dim);
    line-height: 1;
    text-align: center;
  }
  .efforts {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .effort-key {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    min-height: 3.5rem;
    border: 1px solid var(--line);
    background: var(--raised);
    border-radius: var(--r-md);
    padding: 0.4rem 0.2rem;
  }
  .effort-key:disabled {
    opacity: 0.55;
  }
  .effort-name {
    font-size: 0.85rem;
    font-weight: 600;
  }
  .effort-fill {
    display: flex;
    gap: 3px;
  }
  .effort-fill i {
    display: block;
    width: 12px;
    height: 4px;
    border-radius: 2px;
    background: var(--line);
  }
  .effort-fill i.on {
    background: var(--accent);
  }
</style>
