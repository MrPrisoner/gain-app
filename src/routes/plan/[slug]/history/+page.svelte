<!-- src/routes/plan/[slug]/history/+page.svelte -->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import ArchivedNote from "$lib/components/ArchivedNote.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
</script>

<PageHeader title={`${data.planName} — history`} backHref="/" backLabel="Back to your plans" />

{#if data.planArchived}
  <ArchivedNote />
{/if}

{#if data.workouts.length === 0}
  <p class="muted">No workouts logged yet.</p>
{:else}
  <ul class="workout-list">
    {#each data.workouts as workout (workout.id)}
      <li>
        <a href={`/plan/${data.planSlug}/history/${workout.id}`}>
          <span class="date">{new Date(workout.startedAt).toISOString().slice(0, 10)}</span>
          <span class="session">{workout.sessionKey} · {workout.sessionName}</span>
          <span class="detail"
            >{workout.status} · {workout.setCount} sets{workout.versionNo
              ? ` · v${workout.versionNo}`
              : ""}</span
          >
        </a>
      </li>
    {/each}
  </ul>
{/if}

<div class="pager">
  {#if data.page > 0}
    <button
      type="button"
      onclick={() =>
        goto(resolve(`/plan/[slug]/history?page=${data.page - 1}`, { slug: data.planSlug }))}
      >Newer</button
    >
  {/if}
  {#if data.hasMore}
    <button
      type="button"
      onclick={() =>
        goto(resolve(`/plan/[slug]/history?page=${data.page + 1}`, { slug: data.planSlug }))}
      >Older</button
    >
  {/if}
</div>

<style>
  .muted {
    color: var(--muted);
  }
  .workout-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--s-3);
  }
  .workout-list a {
    display: grid;
    gap: var(--s-1);
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--line-soft);
    color: var(--text);
  }
  .date {
    font-weight: var(--w-bold);
  }
  .session,
  .detail {
    font-size: var(--t-sm);
    color: var(--muted);
  }
  .pager {
    display: flex;
    gap: var(--s-3);
    margin-top: 1rem;
  }
  .pager button {
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-sm);
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
    font-weight: var(--w-bold);
  }
</style>
