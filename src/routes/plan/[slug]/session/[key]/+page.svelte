<script lang="ts">
  import { SvelteMap } from "svelte/reactivity";
  import { ulid } from "ulidx";
  import { enhance } from "$app/forms";
  import type { ActionData, PageData } from "./$types";
  import { visibleSetCount } from "$lib/session/session-view";
  // `restForSet`/`restBetweenRounds` are Task 7's (rest-timer wiring) — this
  // component doesn't render rest UI yet, so they aren't imported here.

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

  function mintAndStore(): string {
    const id = ulid();
    sessionStorage.setItem(storageKey, id);
    return id;
  }

  let startForm: HTMLFormElement | undefined = $state();

  $effect(() => {
    if (!workoutId) startForm?.requestSubmit();
  });

  // Which exercise is expanded — UI-DECISIONS §1: exactly one, the others collapse.
  let openSlug = $state<string | undefined>(firstTrackedExerciseSlug());
  function firstTrackedExerciseSlug(): string | undefined {
    for (const block of data.session.blocks) {
      if (block.tracking === "checkoff") continue;
      const first = block.exercises[0];
      if (first) return first.slug;
    }
    return undefined;
  }

  // Logged sets this workout, keyed by `${slug}:${setNo}:${side ?? ""}`.
  const loggedSets = new SvelteMap<
    string,
    { reps?: number; weightKg?: number; difficulty?: string }
  >();

  // Optional sets added beyond a ranged prescription's minimum, keyed by slug.
  const addedSets = new SvelteMap<string, number>();

  function setKey(slug: string, setNo: number, side?: "left" | "right"): string {
    return `${slug}:${setNo}:${side ?? ""}`;
  }

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
</script>

<svelte:head>
  <title>{data.session.name} — GAIN</title>
</svelte:head>

<form
  bind:this={startForm}
  method="POST"
  action="?/start"
  use:enhance={() => {
    return ({ result }) => {
      if (result.type === "success" && result.data?.workoutId) {
        workoutId = result.data.workoutId as string;
      }
    };
  }}
  hidden
>
  <input type="hidden" name="client_id" value={workoutClientId} />
</form>

<header class="runner-head">
  <h1>{data.session.name}</h1>
  {#if data.session.note}<p class="note">{data.session.note}</p>{/if}
</header>

<div class="blocks">
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
            {@const key = setKey(exercise.slug, 1)}
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
              <span class="pill-target tabular"
                >{exercise.type === "time" ? `${exercise.durationSec}s` : exercise.reps}</span
              >
            </button>
          {/each}
        </div>
      {:else}
        <ul class="exercises">
          {#each block.exercises as exercise (exercise.slug)}
            {@const isOpen = openSlug === exercise.slug}
            {@const sides = exercise.perSide
              ? (["left", "right"] as const)
              : ([undefined] as const)}
            {@const visible = visibleSetCount(exercise.sets, addedSets.get(exercise.slug) ?? 0)}
            <li class="exercise" class:open={isOpen}>
              <button
                type="button"
                class="exercise-head"
                onclick={() => (openSlug = exercise.slug)}
              >
                <span class="exercise-name">{exercise.name}</span>
                <span class="exercise-meta tabular">
                  {exercise.type === "time" ? `${exercise.durationSec}s` : exercise.reps}
                  {#if exercise.perSide}· per side{/if}
                </span>
              </button>

              {#if isOpen}
                <div class="exercise-body">
                  {#if exercise.conditional}
                    <p class="condition">{exercise.condition}</p>
                    {#if exercise.substitutes.length > 0}
                      <div class="substitute-row">
                        {#each exercise.substitutes as sub (sub)}
                          <button type="button" class="chip">Swap: {sub}</button>
                        {/each}
                        <button type="button" class="chip chip--primary">Do it</button>
                      </div>
                    {/if}
                  {/if}
                  {#if exercise.note}<p class="cue">{exercise.note}</p>{/if}

                  {#each Array.from({ length: visible.shown }, (_, i) => i + 1) as setNo (setNo)}
                    {#each sides as side (side ?? "single")}
                      {@const key = setKey(exercise.slug, setNo, side)}
                      {@const logged = loggedSets.get(key)}
                      {@const fill = prefillFor(exercise.slug, exercise.perSide, side)}
                      <form
                        method="POST"
                        action="?/logSet"
                        use:enhance={() => {
                          return ({ result }) => {
                            if (result.type === "success") {
                              loggedSets.set(key, {
                                reps: fill.reps,
                                weightKg: fill.weightKg,
                              });
                            }
                          };
                        }}
                        class="set-row"
                      >
                        <input type="hidden" name="workout_id" value={workoutId ?? ""} />
                        <input type="hidden" name="exercise_slug" value={exercise.slug} />
                        <input type="hidden" name="set_no" value={setNo} />
                        {#if side}<input type="hidden" name="side" value={side} />{/if}
                        <input type="hidden" name="client_id" value={ulid()} />

                        <span class="set-no tabular">{setNo}{side ? ` (${side})` : ""}</span>

                        {#if exercise.type === "time"}
                          <input
                            type="number"
                            name="duration_s"
                            class="tabular"
                            value={fill.durationS ?? ""}
                            disabled={!!logged}
                          />
                        {:else}
                          <input
                            type="number"
                            name="reps"
                            class="tabular"
                            value={fill.reps ?? ""}
                            step="1"
                            disabled={!!logged}
                          />
                          <input
                            type="number"
                            name="weight_kg"
                            class="tabular"
                            value={fill.weightKg ?? ""}
                            step="1"
                            disabled={!!logged}
                          />
                        {/if}

                        <div class="effort">
                          {#each ["easy", "medium", "hard"] as const as level, i (level)}
                            <button
                              type="submit"
                              name="difficulty"
                              value={level}
                              class="effort-key"
                              disabled={!!logged}
                              aria-label={level}
                            >
                              {#each [0, 1, 2] as seg (seg)}
                                <i class:on={seg <= i}></i>
                              {/each}
                            </button>
                          {/each}
                        </div>
                      </form>
                    {/each}
                  {/each}

                  {#if visible.canAddMore}
                    <button
                      type="button"
                      class="add-set"
                      onclick={() =>
                        addedSets.set(exercise.slug, (addedSets.get(exercise.slug) ?? 0) + 1)}
                    >
                      Add the optional set
                    </button>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/each}
</div>

{#if form?.actionError}
  <p class="action-error">{form.actionError}</p>
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
    padding-bottom: 6rem; /* room for the pinned log strip once Task 7 adds it */
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
  .set-row {
    display: grid;
    grid-template-columns: 3rem 1fr 1fr auto;
    gap: 0.5rem;
    align-items: center;
  }
  .set-row input {
    padding: 0.5rem;
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
  }
  .set-row input:disabled {
    opacity: 0.6;
  }
  .effort {
    display: flex;
    gap: 0.3rem;
  }
  .effort-key {
    display: flex;
    gap: 2px;
    border: 1px solid var(--line);
    background: var(--raised);
    border-radius: var(--r-xs);
    padding: 0.4rem;
  }
  .effort-key i {
    width: 4px;
    height: 1rem;
    border-radius: 2px;
    background: var(--line);
    display: block;
  }
  .effort-key i.on {
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
    color: var(--red);
  }
</style>
