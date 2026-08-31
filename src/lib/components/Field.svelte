<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    label,
    id,
    hint,
    error,
    asGroup = false,
    children,
  }: {
    label: string;
    id: string;
    hint?: string;
    error?: string;
    asGroup?: boolean;
    children: Snippet;
  } = $props();
</script>

<div class="field">
  <!-- `asGroup` is for a wrapped `<fieldset>`: its own legend/`aria-label` already gives
       it an accessible name, so a `<label for>` here would point at no element (a
       fieldset has no value of its own to associate with) and double-announce the name.
       Field's job for a group is the same visual label, not the for/id association. -->
  {#if asGroup}
    <span class="label">{label}</span>
  {:else}
    <label for={id}>{label}</label>
  {/if}
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

  label,
  .label {
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
