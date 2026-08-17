<!-- src/routes/plan/[slug]/progress/exercises/+page.svelte -->
<script lang="ts">
  import BackLink from "$lib/components/BackLink.svelte";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
</script>

<h1>Exercise progress</h1>

{#if data.rows.length === 0}
  <p class="muted">Nothing logged yet.</p>
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

<BackLink href={`/plan/${data.planSlug}/progress`} label="Back to progress" />

<style>
  .muted {
    color: var(--muted);
  }
  .occurrence-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }
  .occurrence-list a {
    display: grid;
    gap: 0.15rem;
    padding: 0.85rem 1rem;
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--line-soft);
    color: var(--text);
  }
  .exercise-name {
    font-weight: 700;
  }
  .session-name,
  .summary {
    font-size: 0.85rem;
    color: var(--muted);
  }
</style>
