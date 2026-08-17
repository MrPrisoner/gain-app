<!-- src/routes/plan/[slug]/history/[workoutId]/+page.svelte -->
<script lang="ts">
  import BackLink from "$lib/components/BackLink.svelte";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
</script>

<h1>
  Session {data.workout.sessionKey}{data.workout.sessionName
    ? ` — ${data.workout.sessionName}`
    : ""}
</h1>
<p class="muted">
  {new Date(data.workout.startedAt).toISOString().slice(0, 10)} · {data.workout.status}
  {#if data.version}
    · Plan v{data.version.versionNo}, imported {data.version.importedAt.slice(0, 10)}
  {/if}
</p>
{#if data.workout.note}
  <p class="note">{data.workout.note}</p>
{/if}

<h2>Sets</h2>
{#if data.exercises.length === 0}
  <p class="muted">No sets logged.</p>
{:else}
  <ul class="exercise-list">
    {#each data.exercises as exercise (exercise.slug)}
      <li><strong>{exercise.name}</strong> — {exercise.rendered}</li>
    {/each}
  </ul>
{/if}

{#if data.metrics.length > 0}
  <h2>Metrics</h2>
  <ul class="metric-list">
    {#each data.metrics as metric (metric.id)}
      <li>
        {metric.label} ({metric.scope}{metric.exerciseName ? `, ${metric.exerciseName}` : ""}):
        {metric.value}
      </li>
    {/each}
  </ul>
{/if}

{#if data.deviations.length > 0}
  <h2>Deviations</h2>
  <ul class="deviation-list">
    {#each data.deviations as deviation, i (i)}
      <li>
        {deviation.exerciseSlug} — {deviation.kind}
        {#if deviation.substituteSlug}&rarr; {deviation.substituteSlug}{/if}
        {#if deviation.note}: {deviation.note}{/if}
      </li>
    {/each}
  </ul>
{/if}

<BackLink href={`/plan/${data.planSlug}/history`} label="Back to history" />

<style>
  .muted {
    color: var(--muted);
  }
  .note {
    font-style: italic;
  }
  .exercise-list,
  .metric-list,
  .deviation-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.4rem;
  }
</style>
