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

### Admin section

Admin page with basic functionality:

- See a list of users registered with stats per user (last active, plan count, session count, etc.), no plan or exercise details.
- Ability to delete all data for a specific user. Would be especially useful during alpha testing so that users can start fresh if they want to.
- Might even be worth it to give users a way to wipe their own data, should they want to.
- Should only be available to an admin user, which can be specified using env var. The env var value is a unique identifier of the user, provided by oidc, such as email address.

Previous recorded decisions stated that users' data should be isolated. This still stands for normal users. The admin user is typically the owner of the self-hosted app, and needs a way to manage the data they host. Admin user should still not see sensitive information such as full plan details or detailed session logs. So, for all intents and purposes, a user's data is still only seen by that user; the admin user can see basic stats as mentioned in above list, and can delete data.
