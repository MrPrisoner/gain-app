<script lang="ts">
  import { untrack } from "svelte";
  import type { Disposition } from "$lib/diff/present";

  let {
    dispositions,
    choices = $bindable(),
  }: { dispositions: readonly Disposition[]; choices: Record<string, string> } = $props();

  // Seeds the engine's own suggestion into `choices`, once, right here rather than in
  // `+page.svelte`. `+page.svelte` never remounts across a `use:enhance` form response —
  // SvelteKit updates its `form` prop in place — so a `$state` initializer up there reading
  // `form?.revision` only ever sees the value `form` held at the very first page load
  // (confirmed by Svelte's own `state_referenced_locally` compiler warning, and by a review
  // screenshot where a slug with a matched rename still opened on "Choose…"). This component,
  // by contrast, sits inside the parent's `{#if form?.revision}` block, which SvelteKit *does*
  // tear down and rebuild on every action response (`applyAction` sets `form` to `null`, ticks,
  // then sets the real result) — so a plain top-level statement here runs fresh exactly when a
  // genuinely new revision arrives. `untrack` is the same fix `+page.svelte`'s own `pasted`
  // uses for the identical warning: this deliberately reads `dispositions` once, not
  // reactively, so it needs to say so rather than let the compiler assume otherwise. `??=`
  // only fills a slug the caller hasn't already answered, so this can never overwrite a
  // manual choice — and it is not an `$effect`, so it can never re-run mid-review and stamp
  // over one either.
  for (const d of untrack(() => dispositions)) {
    choices[d.slug] ??= d.suggested ? `rename:${d.suggested}` : "";
  }
</script>

{#each dispositions as d (d.slug)}
  <div class="row">
    <p class="name">{d.name}</p>
    {#if d.reason}<p class="reason">{d.reason}</p>{/if}
    <select
      name={`disposition:${d.slug}`}
      bind:value={choices[d.slug]}
      aria-label={`What happened to ${d.name}?`}
    >
      <option value="">Choose…</option>
      <option value="removed">Removed on purpose</option>
      {#each d.options as option (option.slug)}
        <option value={`rename:${option.slug}`}>Renamed to {option.name}</option>
      {/each}
    </select>
  </div>
{/each}

<style>
  .row {
    padding: 0.85rem 0;
    border-top: 1px solid var(--line-soft);
  }

  .row:first-child {
    border-top: none;
    padding-top: 0;
  }

  .name {
    margin: 0 0 0.25rem;
    font-weight: 700;
  }

  .reason {
    margin: 0 0 0.5rem;
    color: var(--muted);
    font-size: 0.85rem;
  }

  select {
    width: 100%;
    min-width: 0;
    padding: 0.65rem 0.75rem;
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
  }
</style>
