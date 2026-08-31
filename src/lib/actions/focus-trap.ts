/**
 * Focus trap for the runner's modal sheets (UI §8) — the wrap-up
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

/**
 * What the trap treats as a Tab stop.
 *
 * `input:not([disabled])` alone would also match `<input type="hidden">` — the sheets
 * carry several (every form field the enclosing `<form>` submits), and a browser
 * silently refuses to focus one (it generates no box), so treating it as a real Tab stop
 * would leave focus stuck wherever it already was, one keypress that visibly does
 * nothing. `:not([type="hidden"])` rules that out.
 *
 * Exported because `e2e/session-runner-focus.spec.ts` counts a dialog's Tab stops to
 * decide how many presses prove the cycle wraps. It used to keep its own copy of this
 * string, which defeats the test: a wrong selector in the app would still pass as long
 * as the test's copy drifted the same way. The test must measure the real constant.
 */
export const FOCUSABLE_SELECTOR =
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
 *
 * Both the keydown handling and a defensive `focusin` reclaim listen on `document`,
 * not `node` — a review finding on the first version of this action caught that a
 * `node`-scoped listener goes silent the moment focus leaves `node`, and on a phone a
 * tap anywhere on the sheet that isn't itself focusable (a paragraph, a metric label,
 * padding between controls) blurs `document.activeElement` to `<body>`: from there Tab
 * would fall through to the browser's own document-wide default (escaping to the page
 * behind the modal) and Escape would stop doing anything at all. This is a mobile-first
 * runner whose own brief says "assume sweaty hands and a phone propped on the floor" —
 * a stray tap on sheet text is the common case, not an edge case. Listening on
 * `document` means Tab and Escape both keep working no matter where a tap left focus;
 * `nextTrapFocusTarget` already treats "active is outside `node`'s focusable elements"
 * (including `<body>`) the same way it treats the heading — as an escaped position to
 * pull back from, forward or backward. The `focusin` listener is belt-and-braces on top
 * of that: it reclaims focus the instant it drifts outside `node`, by any means,
 * without waiting for a Tab press to notice.
 */
export function trapFocus(node: HTMLElement, options: TrapFocusOptions) {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  function focusableElements(): HTMLElement[] {
    return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }

  function focusHeadingOrNode(): void {
    const heading = node.querySelector<HTMLElement>("[data-trap-focus-heading]");
    (heading ?? node).focus();
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

  function handleFocusIn(event: FocusEvent): void {
    const target = event.target;
    if (target instanceof Node && node.contains(target)) return;
    focusHeadingOrNode();
  }

  focusHeadingOrNode();

  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("focusin", handleFocusIn);

  return {
    destroy() {
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("focusin", handleFocusIn);
      previouslyFocused?.focus();
    },
  };
}
