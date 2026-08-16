<!-- src/routes/plan/[slug]/progress/+page.svelte -->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import Sparkline from "$lib/components/Sparkline.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  function formatRate(rate: number | undefined): string {
    return rate === undefined ? "No finished workouts yet" : `${Math.round(rate * 100)}% completed`;
  }
</script>

<h1>{data.planName} — progress</h1>

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
    font-size: 0.9rem;
    color: var(--muted);
  }
  .window-picker select {
    display: block;
    margin-top: 0.25rem;
    width: 100%;
    padding: 0.6rem 0.75rem;
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
  }
  .session-cards {
    display: grid;
    gap: 1rem;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: 1.25rem;
  }
  .card h2 {
    margin: 0 0 0.5rem;
    font-size: 1.05rem;
  }
  .stat {
    margin: 0 0 0.25rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .progress-links {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 1.25rem;
  }
  .progress-links a {
    display: inline-flex;
    padding: 0.7rem 1.25rem;
    border-radius: var(--r-sm);
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
    font-weight: 700;
  }
</style>
