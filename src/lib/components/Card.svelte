<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    elevation = 1,
    padded = true,
    children,
  }: { elevation?: 1 | 2; padded?: boolean; children: Snippet } = $props();
</script>

<div class="card e{elevation}" class:padded>{@render children()}</div>

<style>
  /* Light conveys depth by shadow; dark by a lighter surface plus a hairline highlight,
     because a shadow on a near-black ground reads as nothing. `--edge-top` is `none` in
     light and an inset highlight in dark, so one rule serves both. */
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
  }

  .padded {
    padding: var(--pad-card);
  }

  .e1 {
    box-shadow: var(--shadow-1), var(--edge-top);
  }

  .e2 {
    box-shadow: var(--shadow-2), var(--edge-top);
  }
</style>
