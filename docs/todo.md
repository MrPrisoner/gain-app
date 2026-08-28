# To-do

Findings from manual testing — the inbox, not the plan. What is left to _build_ lives in
[`docs/ROADMAP.md`](ROADMAP.md); this file is for what turns up while using the app.

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

From [`REVIEW-2026-08-27.md`](REVIEW-2026-08-27.md). Everything here is a single commit or
less; the bigger findings went to [`ROADMAP.md`](ROADMAP.md) under "Post-review work".

- **Branch protection on `main`.** A settings change, not code — it makes an existing
  decision true. `ci.yml` runs nothing on a push to `main` and justifies that with "every
  commit that reaches `main` was already vetted by its PR"; nothing enforces the premise,
  and the repository reports no branch protection and no rulesets on a public forkable
  repo. Require a PR, require `check` and `e2e` green, and allow a tag to be cut only from
  an ancestor of `main`. Moved here from ROADMAP's "Before real users" on 2026-08-28
  because it is not work an agent can do in the repository.
