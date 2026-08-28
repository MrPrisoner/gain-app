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

- **Expired sessions are purged only at process start** (`hooks.server.ts:29`, guarded by
  `started`), so a container running for months never purges again. Not a security hole —
  expiry is checked on use — but every retained row still holds its plaintext refresh
  token, which makes the purge the only thing that ever removes stored credentials.

- **Exports are written to `users/<id>/exports/` forever** — no retention, no cap, and no
  route anywhere lists, reads or deletes them, so the user cannot see or manage files that
  reach 1.6 MB each at three years of history. Decide what the archive is for: give it a UI
  and a retention window, or stop writing it. The `try {} catch {}` around the write is
  correct and should stay either way.

- **`syncBatchSchema` caps ops at 500 but nothing caps request size**, and `/api/sync`
  replays a batch in one synchronous transaction. A batch-size bound belongs in the app
  rather than the proxy, because only the app knows what a plausible batch looks like.

- **`ORIGIN` is not required to be HTTPS and `SESSION_SECRET` has no strength check.**
  `SESSION_SECRET=x` starts and serves in production; `ORIGIN=http://…` starts cleanly and
  logs a plaintext OIDC redirect URI while the cookie is still issued `Secure`, so the two
  silently disagree and login fails with no diagnostic. Also worth a line in `.env.example`:
  rotating `SESSION_SECRET` signs every user out at once, because `verifySessionCookie`
  computes one MAC from one secret with no previous-secret fallback.
