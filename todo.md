# To-do

Findings from manual testing — the inbox, not the plan. What is left to _build_ lives in
[`docs/ROADMAP.md`](docs/ROADMAP.md); this file is for what turns up while using the app.

## Instructions to AI agents (Claude, Cline)

Work from top to bottom. Evaluate each item and decide whether my input is needed before
you act on it. Where two items are obviously one job — say, two notes about spacing on the
same screen — combine them into one commit. Otherwise, one item, one commit.

Then clear it up behind you:

- **Delete the item once it is done.** No strikethrough. The commit history is the record
  of what was fixed; a list of struck-through lines is just a longer file to read.
- **Anything bigger than a single commit moves to the roadmap**, into the phase it belongs
  to, rather than growing here.
- **A design decision that comes out of an item goes to `AGENTS.md`**, under Invariants.
  The list is where it was noticed; the invariant is where it has to survive.

## Items

### `svelte-check` warnings, standing since phase 4

`npm run check` reports 0 errors and 9 warnings across three files. None fail the build, and
a warning nobody ever acts on trains everyone to skim past the next one — so each of these
gets decided once, either fixed or deliberately silenced with the reason written down.

- **`DeviationSheet.svelte:69` — `<form role="dialog">` trips two a11y rules**
  (`a11y_no_noninteractive_element_to_interactive_role` and `a11y_click_events_have_key_events`).
  The sheet is a real modal on purpose: `aria-modal`, `aria-labelledby`, and `use:trapFocus`
  handling Tab, Escape and focus restoration, exactly as UI-DECISIONS §8 asks. The `onclick`
  the second rule objects to is a bare `stopPropagation` guarding the backdrop, so there is
  no keyboard interaction to add. Either wrap the form in a `<div role="dialog">` and leave
  the form a form, or suppress both with a comment saying why. Check the rest overlay
  (`a990adc`) first — it solved the same problem and may already hold the answer.
- **Seven `state_referenced_locally` warnings** in `+page.svelte` (51, 57, 74, 121),
  `RestTimer.svelte:34` and `DeviationSheet.svelte:59`. Svelte 5 flagging a rune read outside
  a reactive context. Some are certainly deliberate — a one-shot seed from `data` or `form`
  at mount is the same pattern the home screen documents with `untrack()`. Go through them
  individually; a blanket "wrap it in `$derived`" would break the seeding on purpose.
  Anywhere the capture is intentional, say so in a comment the way `+page.svelte` does at
  the root, so the next reader does not have to re-derive it.
