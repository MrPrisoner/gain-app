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

### Ability to update a log

Currently, once a user has logged an exercise, there is no way to change that log. A user might make a mistake and would want to change what they logged. For example, forgetting to change the number of reps.

### `check:chars` only scans tracked files

`npm run check:chars` (and the `gain/no-control-characters` ESLint rule) exist because a
literal control character makes git treat a file as binary — no diff, nothing to review,
exactly what happened to `src/lib/export/bundle.ts` once already (AGENTS.md). But
`check:chars` runs `git ls-files -z ... | xargs -0 grep -laP ...`, which only sees files git
already knows about. A brand-new untracked file with a literal control character in it
passes clean, and only starts being checked once `git add` has already staged it — so the
one moment the check exists to catch, a fresh file with the problem already in it, is
exactly the moment it's blind. Caught by hand while writing
`docs/superpowers/plans/2026-08-13-fixture-rebuild.md`: `grep` went silent on the file, the
tell from AGENTS.md, and `check:chars` said nothing until the file was staged.

Fix is presumably swapping `git ls-files` for something that includes untracked-but-not-
ignored files (`git ls-files --others --exclude-standard` alongside the tracked list, or
just dropping the git-awareness and globbing the working tree directly, excluding
`node_modules` and the like by hand).

### Admin section

Admin page with basic functionality:

- See a list of users registered with stats per user (last active, plan count, session count, etc.), no plan or exercise details.
- Ability to delete all data for a specific user. Would be especially useful during alpha testing so that users can start fresh if they want to.
- Might even be worth it to give users a way to wipe their own data, should they want to.
- Should only be available to an admin user, which can be specified using env var. The env var value is a first-class identifier of the user, provided by oidc, such as email address.

Previous recorded decisions stated that users' data should be isolated. This still stands for normal users. The admin user is typically the owner of the self-hosted app, and needs a way to manage the data they host. Admin user should still not see sensitive information such as full plan details or detailed session logs. So, for all intents and purposes, a user's data is still only seen by that user; the admin user can see basic stats as mentioned in above list, and can delete data.

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
