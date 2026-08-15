<script lang="ts">
  import IconActivity from "~icons/lucide/activity";
  import IconPlus from "~icons/lucide/plus";
  import ActivitySheet from "./ActivitySheet.svelte";

  /**
   * Log activity that is not part of the plan (ARCHITECTURE §9, "Home"): one-tap
   * buttons for kinds already used, plus rest, plus a way to type a new one. GAIN
   * ships no list of sports.
   */
  let { kinds }: { kinds: readonly string[] } = $props();

  // `""` (not null) opens the sheet in "new kind" mode — distinct from "closed".
  let openKind = $state<string | null>(null);

  function log(kind: string): void {
    // No local reordering: the next full page load re-derives `kinds` from fresh data
    // via `suggestActivityKinds` — same as the rest of this route's writes, which don't
    // re-run `load` after a write either.
    openKind = null;
    void kind;
  }
</script>

<section class="card activity-strip">
  <h2><IconActivity />Log activity</h2>
  <div class="chips">
    {#each kinds as kind (kind)}
      <button type="button" class="chip" onclick={() => (openKind = kind)}>{kind}</button>
    {/each}
    <button type="button" class="chip chip-add" onclick={() => (openKind = "")}>
      <IconPlus />New
    </button>
  </div>
</section>

{#if openKind !== null}
  <ActivitySheet
    initialKind={openKind === "" ? undefined : openKind}
    onClose={() => (openKind = null)}
    onLogged={log}
  />
{/if}

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
    padding: 1.25rem;
    margin-top: 1.25rem;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1.05rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 2.75rem;
    padding: 0.5rem 0.9rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font-weight: 600;
    text-transform: capitalize;
  }
  .chip-add {
    color: var(--accent);
    border-color: var(--accent-soft);
    text-transform: none;
  }
</style>
