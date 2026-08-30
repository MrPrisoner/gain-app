<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    label,
    id,
    hint,
    error,
    children,
  }: { label: string; id: string; hint?: string; error?: string; children: Snippet } = $props();
</script>

<div class="field">
  <label for={id}>{label}</label>
  {#if hint}<p class="hint" id="{id}-hint">{hint}</p>{/if}
  {@render children()}
  <!-- An error the user cannot see is worse than a crash: it belongs next to the control
       that failed, not at the bottom of the document in muted grey. -->
  {#if error}<p class="error" id="{id}-error" role="alert">{error}</p>{/if}
</div>

<style>
  .field {
    display: grid;
    gap: var(--s-2);
  }

  label {
    font-size: var(--t-sm);
    font-weight: var(--w-semi);
  }

  .hint {
    margin: 0;
    color: var(--muted);
    font-size: var(--t-sm);
  }

  .error {
    margin: 0;
    color: var(--red);
    font-size: var(--t-sm);
    font-weight: var(--w-medium);
  }
</style>
