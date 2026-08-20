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

- Some actions like selecting a symptom feedback (1-10) will cause a "Syncing workout" message to be displayed at the top, but only for a fraction of a second, then it goes away. This seems like weird UI jumping but is actually the message showing and hiding very quickly. What can we do about this so it does not feel like weird UI jumpiness? Is this message needed?
- Finishing a session: celebration popup shows, click continue to home, land on home page. User is typically now done with the app, press Back button to quit, but this takes the user back to the celebration popup, which is wrong. Should not be able to navigate back into the completed session. What can we do?
