/**
 * Focus trap for the runner's modal sheets (phase-4 remediation Task 11) — the wrap-up
 * sheet in `+page.svelte` and `DeviationSheet.svelte` both need identical dialog
 * behaviour (focus moves in on open, Tab/Shift+Tab cycle without escaping, Escape
 * closes, focus is restored on close), so it lives once here rather than being
 * duplicated in both components.
 *
 * `nextTrapFocusTarget` is the trap's actual cycling decision, kept pure and separate
 * from the DOM so it is unit-testable without a browser (`tests/actions/focus-trap.test.ts`).
 * `trapFocus` itself — the Svelte action: querying the live DOM, moving real focus,
 * listening for keydown, restoring focus on destroy — is not unit-testable in this
 * repo's Vitest setup (`vitest.config.ts` runs in a plain Node environment with no DOM,
 * and no `jsdom`/`happy-dom`/`@testing-library` dependency exists to add one), so it is
 * covered instead by the e2e specs that drive a real browser
 * (`e2e/session-runner-focus.spec.ts`).
 */

// `input:not([disabled])` alone would also match `<input type="hidden">` — both
// sheets carry several (every form field the enclosing `<form>` submits), and a
// browser silently refuses to focus one (it generates no box), so treating it as a
// real Tab stop would leave focus stuck wherever it already was, one keypress that
// visibly does nothing. `:not([type="hidden"])` rules that out.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Given a dialog's focusable elements (in DOM/tab order) and whichever one is
 * currently active, decides where a Tab (or Shift+Tab) keypress should land to keep
 * focus cycling inside the dialog rather than escaping it.
 *
 * Returns `undefined` when the browser's own default Tab movement already stays inside
 * the list (stepping from a middle element to its neighbour needs no help) — only the
 * wrap-around cases need a forced target: stepping off either end, or focus having
 * drifted outside the list entirely (`active` is `null`, or not a member of `elements`
 * — e.g. the dialog's heading, which carries `tabindex="-1"` precisely so it is
 * focusable programmatically but excluded from this list).
 */
export function nextTrapFocusTarget<T>(
  elements: readonly T[],
  active: T | null,
  shiftKey: boolean,
): T | undefined {
  if (elements.length === 0) return undefined;
  const first = elements[0];
  const last = elements[elements.length - 1];
  const index = active === null ? -1 : elements.indexOf(active);
  if (shiftKey) return index <= 0 ? last : undefined;
  return index === -1 || index === elements.length - 1 ? first : undefined;
}

export type TrapFocusOptions = {
  /** Called when Escape is pressed inside the trap — the caller closes the sheet the
   * same way its own Cancel/Back button already does. */
  onEscape: () => void;
};

/**
 * Svelte action: while `node` is mounted —
 *
 * - focus moves to `node`'s own heading (an element inside `node` carrying the
 *   `data-trap-focus-heading` attribute and `tabindex="-1"`, so it is focusable but
 *   never part of the Tab cycle), or to `node` itself if no such heading is found;
 * - Tab / Shift+Tab cycle only through `node`'s focusable descendants, via
 *   `nextTrapFocusTarget`;
 * - Escape calls `options.onEscape` instead of doing anything else;
 * - on unmount, focus returns to whatever element had it immediately before the trap
 *   activated.
 */
export function trapFocus(node: HTMLElement, options: TrapFocusOptions) {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  function focusableElements(): HTMLElement[] {
    return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      options.onEscape();
      return;
    }
    if (event.key !== "Tab") return;

    const target = nextTrapFocusTarget(
      focusableElements(),
      document.activeElement as HTMLElement | null,
      event.shiftKey,
    );
    if (target) {
      event.preventDefault();
      target.focus();
    }
  }

  const heading = node.querySelector<HTMLElement>("[data-trap-focus-heading]");
  (heading ?? node).focus();

  node.addEventListener("keydown", handleKeydown);

  return {
    destroy() {
      node.removeEventListener("keydown", handleKeydown);
      previouslyFocused?.focus();
    },
  };
}
