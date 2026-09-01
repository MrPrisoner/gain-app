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
    padding: var(--pad-card);
    margin-top: 1.25rem;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: var(--t-base);
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    min-height: 2.75rem;
    padding: var(--s-2) var(--s-4);
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--text);
    font-weight: var(--w-semi);
    text-transform: capitalize;
  }
  .chip-add {
    color: var(--accent);
    border-color: var(--accent-soft);
    text-transform: none;
  }
</style>
