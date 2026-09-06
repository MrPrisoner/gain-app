<!-- src/lib/components/WindowPills.svelte -->
<script lang="ts">
  /**
   * The Progress time control: a small fixed set of spans, rendered as links because the
   * window is a URL parameter. UI's "native <select> stays native" note defends a
   * <select> for picking one of many values by name — a whole exercise catalogue — and
   * this is the opposite case: four toggle-like states, which is what the pill pattern is
   * for everywhere else in the app.
   *
   * `caption` states the window's sample size beside it. A calendar window silently lies
   * about density when someone trains fortnightly, and saying "19 sessions" is the
   * cheapest possible correction.
   */
  let {
    options,
    selected,
    hrefFor,
    caption,
  }: {
    options: { id: string; label: string }[];
    selected: string;
    hrefFor: (id: string) => string;
    caption?: string;
  } = $props();
</script>

<nav class="window-pills" aria-label="Time window">
  {#each options as option (option.id)}
    <a
      class="pill"
      class:selected={option.id === selected}
      href={hrefFor(option.id)}
      aria-current={option.id === selected ? "true" : undefined}
      data-window={option.id}>{option.label}</a
    >
  {/each}
  {#if caption}<span class="caption">{caption}</span>{/if}
</nav>

<style>
  .window-pills {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
    margin: 1rem 0;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* The app's 44px floor; touch-targets.spec.ts sweeps this route. */
    min-height: 2.75rem;
    min-width: 2.75rem;
    padding: var(--s-2) var(--s-4);
    border-radius: var(--r-sm);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font-size: var(--t-sm);
    font-weight: var(--w-semi);
    text-decoration: none;
  }
  .pill.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, var(--raised));
  }
  .caption {
    color: var(--muted);
    font-size: var(--t-sm);
  }
</style>
