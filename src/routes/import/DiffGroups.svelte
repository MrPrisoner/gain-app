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
    padding: var(--s-3) 0;
  }

  details:first-child {
    border-top: none;
    padding-top: 0;
  }

  summary {
    cursor: pointer;
    font-weight: var(--w-bold);
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }

  .count {
    font-weight: var(--w-body);
    color: var(--muted);
    font-size: var(--t-sm);
  }

  ul {
    list-style: none;
    margin: 0.75rem 0 0;
    padding: 0;
    display: grid;
    gap: var(--s-3);
  }

  li {
    padding-left: var(--s-3);
    border-left: 2px solid var(--line-soft);
  }

  .headline {
    margin: 0;
    font-weight: var(--w-semi);
  }

  .detail {
    margin: 0.2rem 0 0;
    color: var(--muted);
    font-size: var(--t-sm);
  }
</style>
