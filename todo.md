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
- **A design decision that comes out of an item goes to `CLAUDE.md`**, under Invariants.
  The list is where it was noticed; the invariant is where it has to survive.

## Items

### Home page UI tweaks

- Too many sections - combine `override` into `next-session`. Also consider combining "Import a plan" section into `plan-admin`
- `next-session` - the suggested next session name text is way bigger than the plan name. I would do this: plan name should be the main heading, with "Last session" below it, then next suggested session, then the start button, then "Choose a different session".
- Export provides both copy and download options. Import should provide paste and import. Current import only has paste, no import.

### Session runner tweaks

- The UI for adjusting a set's reps and weight is not very intuitive - I sometimes these up and adjust the wrong field. Let's add icons (for example, mdi-sync for reps and mdi-weight-kilogram - these are just ideas, align to the app's current UI design).
- Because of the above, it became apparent that users have no way to undo to change a logged set/exercise. If I adjusted the reps or weight incorrectly, or selected the wrong difficulty level, there is no recourse to change it.

### Resuming phase 7b across sessions

Phase 7b (progress, charts & history) is being implemented across multiple separate
sessions rather than one sitting. The plan is
[`docs/superpowers/plans/2026-08-16-phase-7b-progress.md`](docs/superpowers/plans/2026-08-16-phase-7b-progress.md)
(spec: [`docs/superpowers/specs/2026-08-16-phase-7b-progress-design.md`](docs/superpowers/specs/2026-08-16-phase-7b-progress-design.md)),
split into seven parts, each ending in a "**Part N done when:**" line — a real stopping
point where `npm run typecheck`/`npm run check` (and, from Part 2 on, `npm test`) are
clean and nothing is left half-wired.

| Part | Tasks | Delivers                                                   |
| ---- | ----- | ---------------------------------------------------------- |
| 1    | 1–5   | the pure `src/lib/progress/` modules, no UI                |
| 2    | 6–7   | `summary.ts` refactored onto them, `src/lib/db/history.ts` |
| 3    | 8–10  | the two chart components and the progress hub              |
| 4    | 11–12 | the per-exercise list and detail                           |
| 5    | 13–14 | the metric-trend list and detail                           |
| 6    | 15–16 | the History list and detail                                |
| 7    | 17–20 | Home links, both e2e specs, the documentation close-out    |

**To pick up a fresh session:**

1. Run `git log --oneline -20` and check which tasks' commits already exist (each task's
   commit message names the task, e.g. "feat(progress): add buildExerciseSeries") to find
   the next unchecked task. Cross-reference against the plan's own `- [ ]`/`- [x]` boxes —
   the plan file is the source of truth for what's done, not memory of a previous session.
2. Read the spec's relevant section before touching the next part's tasks if it's been a
   while — the plan argues from the spec and doesn't repeat its reasoning.
3. Resume with `superpowers:subagent-driven-development` on the next unstarted part
   (parts are independent enough to run as their own subagent-driven pass — Part 1 has no
   UI, Parts 3–6 share no code with each other beyond Parts 1–2's foundation, per the
   plan's own File Structure section).
4. Before dispatching a part's first task, re-read the real signatures the part's code
   blocks lean on. The plan quotes whole files, written against the tree as it stood on
   2026-08-16; anything landed since then (or by an earlier part of this same plan) is
   not reflected in them. Phase 7a's plan carried a written-out "pre-flight note" that
   caught two real defects before any code — this plan has none, so the scan is the
   agent's own job rather than something to look for in the file.

**Delete this item once phase 7 is fully closed** (Task 20 of the plan — ROADMAP ticked,
README/CLAUDE.md/ARCHITECTURE §12 all updated) rather than leaving it to rot as a stale
pointer to a finished plan.

### Ability to update a log

Currently, once a user has logged an exercise, there is no way to change that log. A user might make a mistake and would want to change what they logged. For example, forgetting to change the number of reps.

### `check:chars` only scans tracked files

`npm run check:chars` (and the `gain/no-control-characters` ESLint rule) exist because a
literal control character makes git treat a file as binary — no diff, nothing to review,
exactly what happened to `src/lib/export/bundle.ts` once already (CLAUDE.md). But
`check:chars` runs `git ls-files -z ... | xargs -0 grep -laP ...`, which only sees files git
already knows about. A brand-new untracked file with a literal control character in it
passes clean, and only starts being checked once `git add` has already staged it — so the
one moment the check exists to catch, a fresh file with the problem already in it, is
exactly the moment it's blind. Caught by hand while writing
`docs/superpowers/plans/2026-08-13-fixture-rebuild.md`: `grep` went silent on the file, the
tell from CLAUDE.md, and `check:chars` said nothing until the file was staged.

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
