# Discard a session someone only opened to look at

Temporary scoping doc — no code written yet. Delete it when the feature lands, folding the
decision into `docs/UI.md` §2/§8 and, if the offline half needs it, `docs/ARCHITECTURE.md`
§9. Carried out of `docs/todo-ui-followups.md` when that doc's own items closed; it was
never a UI follow-up, it is a feature that needs its own design pass.

## The problem

Opening a session in the runner (`?/start`, or the queued offline equivalent) immediately
creates a `workout` row — the session is "started" and becomes part of history the moment
the screen opens, whether or not the user logs a single set. There is no way back out:
someone who opens a session to check what is in it, or to show it to someone else, has
logged a workout they never did.

## Open questions to resolve before writing code

- **What "discard" means for a workout with zero sets logged** is probably a real delete
  of the `workout` row (and, if offline, dropping its queued `start` op rather than ever
  syncing it) — no history was created, so there is nothing to preserve.
- **What it means once at least one set has been logged** is genuinely a judgement call:
  discard the whole workout including the logged sets (surprising if the user only wanted
  to bail on the *rest* of the session), or refuse/hide the option once any set exists
  (forces "finish" as the only way out, even for a session someone regrets starting), or
  something else. `docs/UI.md` §2 and §8 (effort-as-commit, the celebration moment) are
  the places this decision has to sit alongside.
- **Offline implications.** A workout started offline is a queued `start` op with a
  client-generated ULID (`src/lib/sync/ops.ts`); if the device never reconnects before the
  user discards, the discard has to cancel the *queued op*, not just delete a row that was
  never written server-side. `$lib/sync/queue.ts` and the outbox model (ARCHITECTURE §9)
  are the modules this touches.
- **Where the control lives.** Likely session-runner chrome (near where the session is
  opened, or reachable throughout via the same header that holds the sync banner), styled
  as a genuinely destructive action per the `--red` guidance in CLAUDE.md's
  completion-mark invariant — not a `.linklike`.
- **Interaction with resume.** `$lib/session/resume.ts` reconstructs an in-progress
  workout from server + local state on reload; a discard needs to leave no ghost for
  resume to reconstruct.
