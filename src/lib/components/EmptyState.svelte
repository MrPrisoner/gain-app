<script lang="ts">
  let { title }: { title: string } = $props();
</script>

<div class="empty">
  <p class="title">{title}</p>
</div>

<style>
  /* Compact by construction. `/progress` previously drew four full chart wells to say
     "No data yet" four times, which is most of a phone screen spent on absence. */
  .empty {
    display: grid;
    gap: var(--s-2);
    justify-items: start;
    padding: var(--s-4) 0;
    color: var(--muted);
  }

  .title {
    margin: 0;
    font-size: var(--t-sm);
    font-weight: var(--w-semi);
  }
</style>
