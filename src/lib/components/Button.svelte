<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    variant?: "primary" | "secondary" | "quiet" | "danger";
    size?: "md" | "lg";
    href?: string;
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
    size = "md",
    href,
    type = "button",
    disabled = false,
    pending = false,
    pendingLabel,
    onclick,
    children,
    icon,
  }: Props = $props();

  // A control that can post before its precondition exists must be disabled — the runner
  // once rendered every logging control while `?/start` was still in flight, and a fast
  // tap posted an empty workout id straight into a 500.
  const inert = $derived(disabled || pending);
</script>

{#if href}
  <a class="btn {variant} {size}" class:inert {href} aria-disabled={inert || undefined}>
    {#if icon}{@render icon()}{/if}
    {@render children()}
  </a>
{:else}
  <button class="btn {variant} {size}" {type} disabled={inert} {onclick}>
    {#if icon}{@render icon()}{/if}
    {#if pending && pendingLabel}{pendingLabel}{:else}{@render children()}{/if}
  </button>
{/if}

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

  .btn.lg {
    min-height: 3.25rem;
    padding: var(--s-3) var(--s-5);
    font-size: var(--t-base);
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
    border-color: var(--line-strong);
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

  .btn:disabled,
  .btn.inert {
    opacity: 0.5;
    cursor: default;
    pointer-events: none;
  }
</style>
