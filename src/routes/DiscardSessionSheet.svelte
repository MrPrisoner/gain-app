<script lang="ts">
  import { trapFocus } from "$lib/actions/focus-trap";
  import Button from "$lib/components/Button.svelte";
  import type { UnfinishedSession } from "$lib/home/unfinished";

  /**
   * Confirms a permanent discard of an unfinished workout, from Home. Modelled on
   * `DeviationSheet`/`WrapUpSheet` (`src/routes/plan/[slug]/session/[key]/`): same
   * backdrop, same `use:trapFocus`, same focus-on-open/focus-returned-on-close and
   * Escape-to-close. Names what dies and says it is permanent, rather than a bare "Are
   * you sure?" — the count comes from `session.setCount`, which is `undefined` for a
   * workout only a local resume pointer knows about (nothing has synced yet), so the body
   * never claims a count the card itself does not have.
   */
  let {
    session,
    onCancel,
    onConfirm,
  }: {
    session: UnfinishedSession;
    onCancel: () => void;
    onConfirm: () => void;
  } = $props();
</script>

<!-- Close only on a click that lands on the backdrop itself, not one that bubbles up from
     inside the sheet — the same convention as `DeviationSheet`. -->
<div
  class="sheet-backdrop"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onCancel();
  }}
>
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-labelledby="discard-heading"
    use:trapFocus={{ onEscape: onCancel }}
  >
    <h3 id="discard-heading" tabindex="-1" data-trap-focus-heading>
      Discard session {session.sessionKey}?
    </h3>

    <p class="body">
      {#if session.setCount === undefined}
        This permanently deletes everything you logged in this session. It cannot be undone.
      {:else}
        This permanently deletes the {session.setCount}
        {session.setCount === 1 ? "set" : "sets"} you logged. It cannot be undone.
      {/if}
    </p>

    <div class="sheet-actions">
      <Button variant="secondary" onclick={onCancel}>Cancel</Button>
      <Button variant="danger" onclick={onConfirm}>Discard session</Button>
    </div>
  </div>
</div>

<style>
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-end;
    z-index: 60;
  }
  .sheet {
    width: 100%;
    max-height: 90dvh;
    overflow-y: auto;
    background: var(--surface);
    border-top-left-radius: var(--r-lg);
    border-top-right-radius: var(--r-lg);
    padding: var(--s-5);
    padding-bottom: calc(var(--s-5) + env(safe-area-inset-bottom));
    display: grid;
    gap: var(--s-3);
  }
  .body {
    margin: 0;
    color: var(--muted);
    font-size: var(--t-sm);
  }
  .sheet-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--s-3);
  }
</style>
