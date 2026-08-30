<!-- src/routes/plan/[slug]/progress/metrics/+page.svelte -->
<script lang="ts">
  import EmptyState from "$lib/components/EmptyState.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
</script>

<PageHeader
  title="Metric trends"
  backHref={`/plan/${data.planSlug}/progress`}
  backLabel="Back to progress"
/>

{#if data.metrics.length === 0}
  <EmptyState title="No numeric metrics logged yet" />
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

<style>
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
