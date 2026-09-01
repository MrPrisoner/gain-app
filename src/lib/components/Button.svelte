<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    variant?: "primary" | "secondary" | "quiet" | "danger";
    type?: "button" | "submit";
    disabled?: boolean;
    pending?: boolean;
    pendingLabel?: string;
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
    icon?: Snippet;
  };

  let {
    variant = "secondary",
    type = "button",
    disabled = false,
    pending = false,
    pendingLabel,
    onclick,
    children,
    icon,
  }: Props = $props();

  // A control that can post before its precondition exists must be disabled — the
  // account reset flow's own `?/reset` round-trip is exactly this concern.
  const inert = $derived(disabled || pending);
</script>

<button class="btn {variant}" {type} disabled={inert} {onclick}>
  {#if icon}{@render icon()}{/if}
  {#if pending && pendingLabel}{pendingLabel}{:else}{@render children()}{/if}
</button>

<style>
  /* The 44px floor lives here and nowhere else. Before this it was applied in eleven
     files and absent in five, which is why `e2e/touch-targets.spec.ts` could not pass. */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    min-height: 2.75rem;
    min-width: 2.75rem;
    padding: var(--s-2) var(--s-4);
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    font-size: var(--t-sm);
    font-weight: var(--w-semi);
    text-decoration: none;
    cursor: pointer;
    /* Never `transform` — a scale on a control inside a flex row shifts its neighbours. */
    transition:
      background-color var(--dur-fast) var(--ease),
      border-color var(--dur-fast) var(--ease),
      opacity var(--dur-fast) var(--ease);
  }

  .btn:hover {
    text-decoration: none;
  }

  .primary {
    background: var(--accent);
    color: var(--accent-in);
  }

  .secondary {
    background: var(--surface);
    color: var(--text);
    border-color: var(--line);
  }

  .quiet {
    background: transparent;
    color: var(--accent);
  }

  .danger {
    background: transparent;
    color: var(--red);
    border-color: var(--red);
  }

  .secondary:hover:not(:disabled),
  .quiet:hover:not(:disabled) {
    background: var(--hover);
  }

  .primary:active:not(:disabled),
  .secondary:active:not(:disabled),
  .quiet:active:not(:disabled),
  .danger:active:not(:disabled) {
    opacity: 0.85;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
    pointer-events: none;
  }
</style>
