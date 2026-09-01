<!-- src/routes/plan/[slug]/progress/exercises/+page.svelte -->
<script lang="ts">
  import EmptyState from "$lib/components/EmptyState.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
</script>

<PageHeader
  title="Exercise progress"
  backHref={`/plan/${data.planSlug}/progress`}
  backLabel="Back to progress"
/>

{#if data.rows.length === 0}
  <EmptyState title="Nothing logged yet" />
{:else}
  <ul class="occurrence-list">
    {#each data.rows as row (row.sessionKey + ":" + row.exerciseSlug)}
      <li>
        <a href={`/plan/${data.planSlug}/progress/exercises/${row.sessionKey}/${row.exerciseSlug}`}>
          <span class="exercise-name">{row.exerciseName}</span>
          <span class="session-name">{row.sessionName}</span>
          <span class="summary">{row.summary}</span>
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .occurrence-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--s-3);
  }
  .occurrence-list a {
    display: grid;
    gap: var(--s-1);
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--line-soft);
    color: var(--text);
  }
  .exercise-name {
    font-weight: var(--w-bold);
  }
  .session-name,
  .summary {
    font-size: var(--t-sm);
    color: var(--muted);
  }
</style>
