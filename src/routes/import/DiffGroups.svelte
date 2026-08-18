<script lang="ts">
  import type { ChangeGroup } from "$lib/diff/present";

  let { groups }: { groups: readonly ChangeGroup[] } = $props();
</script>

{#each groups as group (group.key)}
  <details>
    <summary>{group.title} <span class="count">{group.entries.length}</span></summary>
    <ul>
      {#each group.entries as entry, i (i)}
        <li>
          <p class="headline">{entry.headline}</p>
          {#each entry.details as detail, j (j)}<p class="detail">{detail}</p>{/each}
        </li>
      {/each}
    </ul>
  </details>
{/each}

<style>
  details {
    border-top: 1px solid var(--line-soft);
    padding: 0.6rem 0;
  }

  details:first-child {
    border-top: none;
    padding-top: 0;
  }

  summary {
    cursor: pointer;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .count {
    font-weight: 400;
    color: var(--muted);
    font-size: 0.85rem;
  }

  ul {
    list-style: none;
    margin: 0.75rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.75rem;
  }

  li {
    padding-left: 0.85rem;
    border-left: 2px solid var(--line-soft);
  }

  .headline {
    margin: 0;
    font-weight: 600;
  }

  .detail {
    margin: 0.2rem 0 0;
    color: var(--muted);
    font-size: 0.85rem;
  }
</style>
