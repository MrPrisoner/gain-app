<!-- src/routes/plan/[slug]/progress/metrics/[scope]/[key]/+page.svelte -->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import Sparkline from "$lib/components/Sparkline.svelte";
  import BackLink from "$lib/components/BackLink.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<h1>{data.label}</h1>

<label class="window-picker">
  Window
  <select
    value={data.selectedWindow}
    onchange={(e) =>
      goto(
        resolve(`/plan/[slug]/progress/metrics/[scope]/[key]?window=${e.currentTarget.value}`, {
          slug: page.params.slug!,
          scope: page.params.scope!,
          key: page.params.key!,
        }),
        { invalidateAll: true },
      )}
  >
    {#each data.windowOptions as option (option.id)}
      <option value={option.id}>{option.label}</option>
    {/each}
  </select>
</label>

<Sparkline
  points={data.points}
  ariaLabel={`${data.label} trend chart`}
  formatPointLabel={(p, i, all) => (i === all.length - 1 ? String(p.y) : undefined)}
  formatReadout={(p) => `${p.y} on ${new Date(p.x).toISOString().slice(0, 10)}`}
/>

<BackLink href={`/plan/${data.planSlug}/progress/metrics`} label="Back to metrics" />

<style>
  .window-picker {
    display: block;
    margin-bottom: 1rem;
    font-size: var(--t-sm);
    color: var(--muted);
  }
  .window-picker select {
    display: block;
    margin-top: 0.25rem;
    width: 100%;
    padding: var(--s-3) var(--s-3);
    border-radius: var(--r-xs);
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font: inherit;
  }
</style>
