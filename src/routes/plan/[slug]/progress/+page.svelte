<!-- src/routes/plan/[slug]/progress/+page.svelte -->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import Sparkline from "$lib/components/Sparkline.svelte";
  import ArchivedNote from "$lib/components/ArchivedNote.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  function formatRate(rate: number | undefined): string {
    return rate === undefined ? "No finished workouts yet" : `${Math.round(rate * 100)}% completed`;
  }
</script>

<PageHeader title={`${data.planName} — progress`} backHref="/" backLabel="Back to your plans" />

{#if data.planArchived}
  <ArchivedNote />
{/if}

<label class="window-picker">
  Window
  <select
    value={data.selectedWindow}
    onchange={(e) =>
      goto(
        resolve(`/plan/[slug]/progress?window=${e.currentTarget.value}`, { slug: data.planSlug }),
        {
          invalidateAll: true,
        },
      )}
  >
    {#each data.windowOptions as option (option.id)}
      <option value={option.id}>{option.label}</option>
    {/each}
  </select>
</label>

<div class="session-cards">
  {#each data.sessions as session (session.key)}
    <section class="card">
      <h2>{session.name}</h2>
      <p class="stat">{formatRate(session.completionRate)}</p>
      <p class="stat">
        {session.deviationCount} deviation{session.deviationCount === 1 ? "" : "s"}
      </p>
      <h3>Duration</h3>
      <Sparkline
        points={session.duration}
        ariaLabel={`${session.name} duration trend chart`}
        formatPointLabel={(p, i, all) => (i === all.length - 1 ? `${p.y}m` : undefined)}
        formatReadout={(p) => `${p.y} min on ${new Date(p.x).toISOString().slice(0, 10)}`}
      />
    </section>
  {/each}
</div>

<nav class="progress-links">
  <a href={`/plan/${data.planSlug}/progress/exercises`}>Per-exercise progress</a>
  <a href={`/plan/${data.planSlug}/progress/metrics`}>Metric trends</a>
</nav>

<style>
  .window-picker {
    display: block;
    margin: 1rem 0;
    font-size: var(--t-sm);
    color: var(--muted);
  }
  .window-picker select {
    display: block;
    margin-top: 0.25rem;
    width: 100%;
    padding: var(--s-3) var(--s-3);
    border-radius: var(--r-xs);
    border: 1px solid var(--line-strong);
    background: var(--raised);
    color: var(--text);
    font: inherit;
  }
  .session-cards {
    display: grid;
    gap: var(--s-4);
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: var(--pad-card);
  }
  .card h2 {
    margin: 0 0 0.5rem;
    font-size: var(--t-base);
  }
  .stat {
    margin: 0 0 0.25rem;
    color: var(--muted);
    font-size: var(--t-sm);
  }
  .progress-links {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    margin-top: 1.25rem;
  }
  .progress-links a {
    display: inline-flex;
    padding: var(--s-3) var(--s-5);
    border-radius: var(--r-sm);
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
    font-weight: var(--w-bold);
  }
</style>
