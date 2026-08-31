# UI follow-ups (deferred)

Temporary tracking doc. Delete it once these are picked up and any durable half is folded
into `docs/UI.md` or `docs/ARCHITECTURE.md` — see CLAUDE.md's "Tracking work, and folding
it back in".

Merged from two review-cadence lists that had drifted into overlap (the design-system
pass's final review, and an older phase-3 screen-polish carryover) — see `git log -p` on
this path for that history if the provenance ever matters. Grouped by theme below rather
than by which review found them, since a reader picking up one item doesn't care which
pass surfaced it.

## Primitive adoption

- [ ] **Third button vocabulary still exists.** `src/routes/import/ImportPlanForm.svelte`,
  `src/routes/plan/[slug]/versions/[n]/+page.svelte`, and `src/routes/+page.svelte`
  (first-run/no-plans view) each hand-roll their own `button`/`.primary`/`.secondary` CSS
  instead of using the `Button` primitive — disagreeing with it on background (`--raised`
  vs `--surface`), border (`--line` vs `--line-strong`), weight (`--w-bold` vs `--w-semi`),
  and missing the 44px `min-height` floor (currently passes only because padding happens
  to clear it). The same copy/download button pair renders three visually different ways
  across `/export`, `/plan/.../versions/[n]`, and first-run home.
- [ ] **`Card` has no spacing story.** Three files (`import/+page.svelte`, home's
  `+page.svelte`, `export/+page.svelte`) each wrap `<Card>` in their own
  `<div class="card">` just to get `margin-top: 1.25rem` — a sixth adopting route would
  likely copy this pattern rather than find a clean built-in way to space a `Card`.
- [ ] **`/admin` and `/account` hand-roll the exact shape `Field` exists for.** Both have a
  `<label for>` + `<input>` + separate error `<p>` pattern in files that already adopted
  `Button` and `Card` — a natural next `Field` adoption site.
- [x] **`Button`'s `href` and `size` had zero call sites** (plus dead `.btn.lg` CSS) and
  `href` combined with `disabled`/`pending` into a real accessibility gap (an `<a>` with
  `pointer-events: none` + `aria-disabled`, neither of which blocks keyboard Enter/Space
  activation). Removed rather than hardened, since nothing depended on either. Correcting
  the record while here: `pending`/`pendingLabel` were never actually unused — this bullet
  previously missed `account/+page.svelte`'s reset flow, which uses both for its own
  `?/reset` race — so they stay.
- [ ] **`Card`'s `elevation`/`padded`, `EmptyState`'s `body`/`children`, and `Field`'s
  `hint`/`error` are still unused everywhere.** `Card`: unused across all 14 call sites.
  `EmptyState`: `body` and `children` unused across all 3. `Field`: `hint` and `error`
  unused across both call sites, and their `{id}-hint`/`{id}-error` generated ids have no
  `aria-describedby` consumer anywhere, so that wiring is currently inert. Resolve each
  against whether the primitive-adoption items below end up giving it a real call site
  (Field's `hint`/`error` on `/admin` and `/account`, say) rather than deleting on sight.
- [ ] **`--shadow-2` is effectively dead.** Only two `box-shadow` declarations exist in
  the whole app, both in `Card.svelte`, and nothing currently passes `elevation={2}` — so
  `--shadow-2` (documented as being for "sheets, the log strip, sticky chrome") has no
  actual consumer yet. `docs/UI.md` §10 already discloses `--shadow-3` has zero
  consumers; this is the same situation one level up.
- [ ] **Motion tokens mostly unused, and some transitions bypass them entirely.**
  `--dur-base`, `--dur-slow`, and `--ease-out` have zero consumers (the one `ease-out` in
  the tree, `CelebrationOverlay.svelte`'s `rise` animation, is a literal, not the token).
  Four hand-written transitions bypass the token system — the chevron rotations in
  `NextSessionCard.svelte` and `SessionOverrideList.svelte` (`transition: transform 0.15s
  ease`, two sites), and `RestTimer.svelte`'s `width 0.2s linear` — meaning
  `prefers-reduced-motion: reduce` (which works by collapsing `--dur-*` at `:root`) does
  not reach them, contradicting §10's framing that it does.
- [ ] **Literal `margin`/`padding` residue never got the `--s-N` sweep `gap` got.**
  `docs/UI.md` §10 already discloses this (its own reference to a tracking doc had gone
  stale — a leftover from before the two backlog lists were merged into this one, now
  fixed to point here instead): 109 literal `margin`/`padding` declarations across 33
  files, 79 of which already equal a token's value but are spelled out longhand rather
  than as `var(--s-N)`, and 37 genuinely off-scale — the largest single pattern being
  `1.25rem` (12 sites across 9 files) as a de-facto, uncatalogued section-separator step.
  `tests/design-scale.test.ts`'s own header comment explains why `gap` got a mechanical
  guard and padding/margin didn't: a multi-value shorthand (`padding: 0.75rem 1rem`) can't
  be checked against a single-value scale without an exemption list nobody has built yet.

## Accessibility

- [x] **`--line-strong` sweep, done.** Every tappable control across ~21 files (textareas,
  `<select>`s, tappable pills/rows/chips, scale cells, buttons hand-rolling their own
  border) now carries `--line-strong` instead of `--line`. Left on `--line` deliberately:
  a container's own edge (`Card`, static alert/report panels, decorative fill indicators
  like `.rounds-indicator i`/`.effort-fill i`/`.led-effort i`, and static labels like
  `BlockSection`'s `.tag`) — none of those are themselves a control. `docs/UI.md` §10
  updated to describe this as done rather than outstanding.
- [x] **Wordmark contrast, fixed.** `+layout.svelte`'s "AI" span now reads `var(--wordmark)`,
  a new per-theme token (`#7e98b4` dark, `#5c6f84` light) clearing 4.5:1 on every surface
  in both themes, added to the design-tokens guard test's `TEXT_ON_EVERY_SURFACE` list so
  it can't silently regress.
- [x] **`Button`'s `href`/`inert` gap, closed by removing `href`.** `href` and `size` had
  zero call sites anywhere, so the branch was hardened against nothing — removed instead,
  which closes the gap outright rather than patching code nothing exercises.
  `pending`/`pendingLabel` stay (`account/+page.svelte`'s reset flow uses them).

## Test coverage

- [x] **Palette-copy guard-test gap, closed.** `design-tokens.test.ts` now also asserts
  the bare `:root` block token-for-token against `[data-theme="dark"]`, and the
  `@media (prefers-color-scheme: light)` block against `[data-theme="light"]` — the two
  pairs a user who never touches the theme toggle actually sees.
- [x] **`.linklike`'s 44px floor, the reasonable next step taken.** Added an
  admin-authenticated pass (`x-gain-e2e-user: e2e-admin`) to `touch-targets.spec.ts`
  covering "Users" — the case this item called out as reasonable to close. Sign out and
  the sync banner's Discard remain untested for the reasons already given above (no real
  OIDC session in the e2e harness; no touch-target route currently quarantines an op) —
  those are gaps in what can be tested here, not gaps left undone.

## Screen-level polish

Carried forward from `docs/superpowers/specs/2026-08-30-ui-design-system-design.md` §2's
original scope-out (that path no longer exists in the tree; recorded here so a future
reader doesn't go looking for it). Re-checked against the code as of this merge, not
copied forward blind.

- [ ] **Home's five-identical-pills nav.** `src/routes/+page.svelte`'s `.plan-links` nav
  renders "Export for review", "Progress", "History", "Plan versions" and "Import a
  revised plan" as five visually identical `.export-link` pills, with no weight given to
  the ones used more often.
- [ ] **Home's duplicated plan name.** A plan's name renders once in `NextSessionCard`
  (via its `planName` prop) and again immediately below, in the `plan-admin` card's own
  `<h2>{plan.name}</h2>` — the same string twice on one screen.
- [ ] **Effort keys' undersized fill segments.** `LogStrip.svelte`'s Easy/Medium/Hard fill
  indicator (`.effort-fill`) is a row of small `i` segments — still small.
- [x] **Native `<select>`/`<radio>` beside custom pills — kept native, deliberately.**
  Converting `DeviationSheet.svelte`'s substitute picker, the three progress window
  pickers, or `DispositionList.svelte` to the app's pill/chip pattern would trade a free
  OS picker sheet and free ARIA listbox semantics for a hand-rolled roving-tabindex
  widget, for no accessibility gain — worse, for the substitute picker, whose option list
  runs to the whole exercise catalogue. Reasoning folded into `docs/UI.md` §12.
- [ ] **History's "1 sets" plural bug.** `src/routes/plan/[slug]/history/+page.svelte`
  still interpolates `{workout.setCount} sets` with no singular form.
- [ ] **The sync banner's Discard control still reads as a neutral link, not a
  destructive one.** Task 10 (design-system pass) gave `variant="danger"` to `/account`'s
  and `/admin`'s reset buttons, covering the two call sites that review had in mind. The
  sync banner's "Discard" (`src/routes/+layout.svelte`, inside the quarantined-ops
  banner) permanently discards queued offline writes — genuinely destructive and
  irreversible — and is still styled as a plain `.linklike` button (`color:
  var(--muted)`), the same treatment as "Sign out" beside it. Worth a `Button
  variant="danger"` (or at least `--red`) pass.

## New: let a user discard a session they only opened to look at

Currently, opening a session in the runner (`?/start`, or the queued offline equivalent)
immediately creates a `workout` row — the session is "started" and becomes part of
history the moment the screen opens, whether or not the user logs a single set. There is
no way back out: someone who opens a session to check what's in it, or to show it to
someone else, has logged a workout they never did.

This needs its own design pass rather than a quick patch — open questions a fresh session
should resolve before writing code:

- **What "discard" means for a workout with zero sets logged** is probably a real
  delete of the `workout` row (and, if offline, dropping its queued `start` op rather
  than ever syncing it) — no history was created, so there's nothing to preserve.
- **What it means once at least one set has been logged** is genuinely a judgement call:
  discard the whole workout including the logged sets (surprising if the user only
  wanted to bail on the *rest* of the session), or refuse/hide the option once any set
  exists (forces "finish" as the only way out, even for a session someone regrets
  starting), or something else. `docs/UI.md` §2 and §8 (effort-as-commit, the celebration
  moment) are the places this decision has to sit alongside.
- **Offline implications.** A workout started offline is a queued `start` op with a
  client-generated ULID (`src/lib/sync/ops.ts`); if the device never reconnects before
  the user discards, the discard has to cancel the *queued op*, not just delete a row
  that was never written server-side. `$lib/sync/queue.ts` and the outbox model
  (ARCHITECTURE §9) are the modules this touches.
- **Where the control lives.** Likely session-runner chrome (near where the session is
  opened, or reachable throughout via the same header that holds the sync banner), styled
  as a genuinely destructive action per the `--red` guidance in CLAUDE.md's completion-mark
  invariant — not a `.linklike`, per the item above.
- **Interaction with resume.** `$lib/session/resume.ts` reconstructs an in-progress
  workout from server + local state on reload; a discard needs to leave no ghost for
  resume to reconstruct.

No code written yet — this is scoping only.
