<!-- src/routes/plan/[slug]/progress/metrics/+page.svelte -->
<script lang="ts">
  import BackLink from "$lib/components/BackLink.svelte";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
</script>

<h1>Metric trends</h1>

{#if data.metrics.length === 0}
  <p class="muted">No numeric metrics logged yet.</p>
{:else}
  <ul class="metric-list">
    {#each data.metrics as metric (metric.scope + ":" + metric.key)}
      <li>
        <a href={`/plan/${data.planSlug}/progress/metrics/${metric.scope}/${metric.key}`}>
          <span class="metric-label">{metric.label}</span>
          <span class="metric-scope">{metric.scope} scope · latest {metric.latest}</span>
        </a>
      </li>
    {/each}
  </ul>
{/if}

<BackLink href={`/plan/${data.planSlug}/progress`} label="Back to progress" />

<style>
  .muted {
    color: var(--muted);
  }
  .metric-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--s-3);
  }
  .metric-list a {
    display: grid;
    gap: var(--s-1);
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--line-soft);
    color: var(--text);
  }
  .metric-label {
    font-weight: var(--w-bold);
  }
  .metric-scope {
    font-size: var(--t-sm);
    color: var(--muted);
  }
</style>
