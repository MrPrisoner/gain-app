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

- **`MetricRow`'s selection is invisible to a screen reader.** `<button class="scale-cell"
  class:selected>` carries the selected state only as `background`/`border-color`
  (`src/lib/components/MetricRow.svelte:66-71,145-148`) — no `aria-pressed`, no
  `aria-checked`. This is the 0–10 symptom scale input, used in the pre-session gate, the
  wrap-up sheet and the next-morning prompt, so "which pain score did I just record" is
  currently unanswerable without sight. `aria-pressed={selected === value}` is the fix.

- **A cancelled correction leaves a value that was never logged in the strip.**
  `LogStrip.svelte`'s `edits` map is written (`:85`) and read (`:73`) and **never cleared** —
  no `delete`, no `clear`, and the component is not in a keyed block so it never remounts.
  Tap a logged ledger row, change reps 10 → 99, tap Cancel: nothing is written and the
  ledger correctly still shows 10, but tapping that row again offers **99**, one effort tap
  from being committed. Clear the slot's entry on both submit and cancel; keep the
  deliberate cross-exercise persistence the module comment describes.

- **A vacuous chart assertion in `progress-walkthrough.spec.ts:112-114`.** It asserts only
  that the metric-detail `svg[aria-label=…]` is visible, and `Sparkline.svelte:54` renders
  that svg in both the populated and empty branches — so it passes with zero data points.
  This is the exact pattern the phase-7 review closed, and the two assertions above it in
  the same file carry comments explaining why not to do it. Assert on `.dot` like its
  siblings.

- **`DeviationSheet` has three unlabelled controls.** The substitute `<select>` (`:145`) has
  no label at all, the `<textarea>` (`:161`) is named only by its placeholder, and neither
  radio group (`:127`, `:152`) has a `<fieldset>`/`<legend>` or `role="radiogroup"`.

- **Exercise rows are disclosure controls with no `aria-expanded`/`aria-controls`**
  (`ExerciseCard.svelte:135`), so a screen-reader user cannot tell which exercise is open.
  `NextSessionCard` and `SessionOverrideList` already do this correctly and are the pattern
  to copy — though `SessionOverrideList:50` has `aria-expanded` without `aria-controls`.

- **Substitutes are shown to users as raw slugs** rather than catalogue names
  (`DeviationSheet.svelte:147`, `ExerciseCard.svelte:180`) — "seated-floor-shoulder-press"
  where the plan says "Seated floor shoulder press".

- **The import paste box is named only by its placeholder**
  (`ImportPlanForm.svelte:27-32`), and it is the app's primary input. Four read-only
  document `<textarea>`s (home, export, versions detail) are unlabelled too.

- **`RestTimer` announces roughly fifteen times per rest.** A per-second countdown is
  interpolated inside `aria-live="polite"` (`:137-139`); a fixture rest of 75–90 s
  therefore re-announces the whole band each second. The countdown wants `aria-live="off"`
  with the phase label announced separately.

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
