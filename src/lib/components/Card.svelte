<script lang="ts">
  import type { Snippet } from "svelte";
  /**
   * `spaced` is the card's own answer to "how far below the previous section" — before
   * this, every route stacking more than one card wrapped each in its own
   * `<div class="card">` just to get `margin-top`, which is the spacing gap a sixth
   * adopting route would have had to rediscover rather than reach for. Default `false`:
   * a card that opens a screen, or one already inside a container that supplies its own
   * gap (a grid of cards, a flex column), does not want a margin fighting that layout.
   */
  let { spaced = false, children }: { spaced?: boolean; children: Snippet } = $props();
</script>

<div class="card" class:spaced>{@render children()}</div>

<style>
  /* Light conveys depth by shadow; dark by a lighter surface plus a hairline highlight,
     because a shadow on a near-black ground reads as nothing. `--edge-top` is `none` in
     light and an inset highlight in dark, so one rule serves both. */
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    padding: var(--pad-card);
    box-shadow: var(--shadow-1), var(--edge-top);
  }

  /* The site-wide de-facto section-separator rhythm (UI §10 records why the rest of the
     app's literal `margin`/`padding` values were never swept onto the `--s-N` scale) —
     kept as the same literal here rather than rounded to `--s-5`, so a route mixing a
     spaced `Card` with its own non-`Card` sections (`import/+page.svelte`'s
     `.report-card`/`.block`, for one) does not read as two different rhythms side by
     side. */
  .spaced {
    margin-top: 1.25rem;
  }
</style>
