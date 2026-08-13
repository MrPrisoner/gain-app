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

### `svelte-check` warnings, standing since phase 4 (line numbers current as of phase 6)

`npm run check` reports 0 errors and 5 warnings across three files. None fail the build, and
a warning nobody ever acts on trains everyone to skim past the next one — so each of these
gets decided once, either fixed or deliberately silenced with the reason written down.

Phase 6's runner rewrite (`8f66333`) removed the `<form>` wrapping `?/logDeviation` — the
sheet is a `<div role="dialog">` now, since there is no submission left to keep it a form —
and with it two of `+page.svelte`'s five original `form?.` one-shot captures, which is why
this list is shorter than it was.

- **`DeviationSheet.svelte:103` — `<div role="dialog">` still trips two a11y rules**, now
  `a11y_interactive_supports_focus` and `a11y_click_events_have_key_events` (the rule names
  changed when the element did; the underlying tension did not). The sheet is a real modal
  on purpose: `aria-modal`, `aria-labelledby`, and `use:trapFocus` handling Tab, Escape and
  focus restoration, exactly as UI-DECISIONS §8 asks. The `onclick` the second rule objects
  to is a bare `stopPropagation` guarding the backdrop, so there is no keyboard interaction
  to add, and the first wants a `tabindex` on an element that is never meant to receive
  focus itself (`use:trapFocus` moves focus to the heading, not the dialog element). Either
  add `tabindex="-1"` and suppress both with a comment saying why, or find whatever the rest
  overlay (`a990adc`) did that avoids this — it solves the same problem and may already hold
  the answer.
- **Three `state_referenced_locally` warnings**: `RestTimer.svelte:34`,
  `DeviationSheet.svelte:60` and `+page.svelte:199`. Svelte 5 flagging a rune read outside a
  reactive context. `+page.svelte:199` (`openSlug`'s initial-exercise seed from `data.session`)
  is the same deliberate one-shot-capture-at-mount pattern the home screen documents with
  `untrack()`, and the same pattern phase 6 already applied to `+page.svelte`'s `storageKey`
  — go through the remaining three individually rather than blanket-wrapping in `$derived`,
  which would break the seeding on purpose. Anywhere the capture is intentional, say so in a
  comment the way `+page.svelte` does at
  the root, so the next reader does not have to re-derive it.

### Manual check: a container restart mid-sync loses nothing

Phase 6's survival spec (`e2e/offline-survival.spec.ts`) proves a full **browser** kill —
IndexedDB, not `sessionStorage` — survives. It does not, and cannot from Playwright alone,
prove a **container** restart while a workout is still queued: the built-server e2e project
starts a fresh `node build` process per run, which exercises "the server process restarted"
but not "the server process restarted with the previous run's SQLite file and a client
outbox still holding unacked ops," since the client and server processes are never actually
killed independently of each other in that harness.

The real guarantee here is unchanged from earlier phases — `set_log`, `workout`,
`metric_value`, `deviation` and `activity` are ordinary SQLite rows in a file under
`DATA_DIR`, which is a mounted volume, so a container restart loses nothing already synced
— but a queued-and-not-yet-synced op only lives in the browser's IndexedDB until the client
flushes it. To close this out with actual evidence rather than an inference:

1. Start a session on a real device against a running container.
2. Log a couple of sets.
3. `docker compose restart` (or equivalent) while still mid-session, before reconnecting is
   even relevant — this is testing the server side, not the offline path.
4. Confirm the session resumes cleanly and nothing already-synced was lost.
5. Repeat once more, this time going offline first (airplane mode), logging a set queued
   client-side, restarting the container while offline, then reconnecting — confirming the
   still-queued op flushes and lands once the container is back.

Delete this item once done — it's a one-time manual verification, not a recurring task.
