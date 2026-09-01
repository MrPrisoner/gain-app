<script lang="ts">
  /**
   * What a session contains: the plan's own note, then each block and the movements in
   * it. Shared by the Home card's suggested session and every row of the "choose a
   * different session" list, so the two cannot drift into showing different things about
   * the same session.
   *
   * Content only — no disclosure control, no start button, no card of its own. Both
   * callers already own an expander and a way into the session, and they place them
   * differently; a component that brought its own would have to be talked out of them.
   */
  let {
    id,
    note,
    blocks,
  }: {
    id: string;
    note: string | undefined;
    blocks: readonly { key: string; name: string; exercises: readonly string[] }[];
  } = $props();
</script>

<div class="session-summary" {id}>
  {#if note}
    <p class="note">{note}</p>
  {/if}
  {#each blocks as block (block.key)}
    <div class="block-summary">
      <h3>{block.name}</h3>
      <p>{block.exercises.join(", ")}</p>
    </div>
  {/each}
</div>

<style>
  .session-summary {
    padding: var(--s-4) var(--s-4) var(--s-1);
    display: grid;
    gap: var(--s-3);
  }
  .note {
    color: var(--muted);
    font-size: var(--t-sm);
    margin: 0 0 0.1rem;
  }
  .block-summary h3 {
    margin: 0 0 0.15rem;
    font-size: var(--t-sm);
    color: var(--muted);
  }
  .block-summary p {
    margin: 0;
    font-size: var(--t-sm);
  }
</style>
