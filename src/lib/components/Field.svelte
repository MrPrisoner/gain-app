<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    label,
    id,
    error,
    asGroup = false,
    children,
  }: {
    label: string;
    id: string;
    error?: string;
    asGroup?: boolean;
    children: Snippet;
  } = $props();
</script>

<div class="field">
  <!-- `asGroup` is for a wrapped `<fieldset>`: a fieldset has no value of its own for a
       `<label for>` to point at, so the visible label is a `<span>` instead. That span
       carries no accessible-name relationship on its own — being a DOM sibling of the
       fieldset does not associate it the way `for`/`id` does for an input. The caller's
       `<fieldset>` MUST reference this span's id via `aria-labelledby="{id}-label"`, or
       the group has no accessible name at all. -->
  {#if asGroup}
    <span class="label" id="{id}-label">{label}</span>
  {:else}
    <label for={id}>{label}</label>
  {/if}
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

  .error {
    margin: 0;
    color: var(--red);
    font-size: var(--t-sm);
    font-weight: var(--w-medium);
  }
</style>
