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

### Show session summary before start

Currently, when clicking a session button, it starts the session. What I have in mind:

- clicking the session button expands it to show a very short summary of what will be covered in the session. Consider showing the session note, plus the exercise names, grouped by block.
- button at the bottom (with icon) to start the session.

The current session button uses a blue accent colour. If we change it to an expandable section, the button should perhaps not be blue so that the new Start Session button can use the blue accent colour.

### Add version number to UI

The current flow for deploying a new version of the app to portainer is:

- create a new release on github
- wait for CI pipeline and image build to complete
- redeploy the stack on portainer

Having the release version on the UI would help testers and users when logging issues etc. Recommend ideal placement according to accepted industry standards.

### Admin section

Admin page with basic functionality:

- See which users are registered with stats (last active, plan count, session count, etc.), no plan or exercise details.
- Ability to delete user data. Would be especially useful during alpha testing so that users can start fresh if they want to. Might even be worth it to give users a way to wipe their own data, should they want to.
- Should only be available to an admin user, which can be specified using env var.

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
