<!-- src/routes/plan/[slug]/history/+page.svelte -->
<script lang="ts">
  import { goto } from "$app/navigation";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
</script>

<h1>{data.planName} — history</h1>

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
    <button type="button" onclick={() => goto(`?page=${data.page - 1}`)}>Newer</button>
  {/if}
  {#if data.hasMore}
    <button type="button" onclick={() => goto(`?page=${data.page + 1}`)}>Older</button>
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
    gap: 0.6rem;
  }
  .workout-list a {
    display: grid;
    gap: 0.15rem;
    padding: 0.85rem 1rem;
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--line-soft);
    color: var(--text);
  }
  .date {
    font-weight: 700;
  }
  .session,
  .detail {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .pager {
    display: flex;
    gap: 0.6rem;
    margin-top: 1rem;
  }
  .pager button {
    padding: 0.6rem 1.1rem;
    border-radius: var(--r-sm);
    background: var(--raised);
    border: 1px solid var(--line);
    color: var(--text);
    font-weight: 700;
  }
</style>
