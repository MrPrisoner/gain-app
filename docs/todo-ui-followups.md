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

- [x] **Third button vocabulary, gone.** `ImportPlanForm.svelte`, `versions/[n]/+page.svelte`
  and home's first-run view now use `Button` for every action they render, matching the
  `variant="primary"`/`variant="secondary"` + icon-snippet pattern already established on
  `/export`. The same copy/download button pair now renders identically across `/export`,
  `/plan/.../versions/[n]` and first-run home. `.primary-link` (home's two "Paste the plan"
  navigation links, styled as a button) is left as a plain anchor — `Button` has no `href`
  and adding one back for two call sites isn't worth reopening the gap that prop closed.
- [x] **`Card` now has a spacing story: a `spaced` prop.** `import/+page.svelte`, home's
  `+page.svelte` and `export/+page.svelte` no longer wrap `<Card>` in a `<div class="card">`
  just for `margin-top: 1.25rem` — `<Card spaced>` carries the same margin itself. Each
  route's now-dead `.card { margin-top }` rule is removed; `.card h2` (or `.report-card
  h2`, where one coexisted) is merged into a plain `h2` rule per file, since every `<h2>`
  on these routes lives inside a `Card` and the two were byte-identical.
- [x] **`/admin` and `/account` now use `Field` for their reset-confirmation input.** Both
  wrapped a `<label for>` + `<input>` + separate error `<p>` pattern; both now wrap the
  input in `<Field label=... id=... error=...>`, wiring `aria-describedby` on the input to
  reference both the existing warning paragraph and Field's new `{id}-error` — the first
  real consumer of that generated id (see the `EmptyState`/`Field` props bullet above). One
  visible side effect, and a correct one per CLAUDE.md's colour rule: the error text was
  `color: var(--text)` by hand-rolled accident; `Field`'s own `.error` rule uses `--red`,
  which is `/account`'s and `/admin`'s sanctioned meaning for a blocking error.
- [x] **`Button`'s `href` and `size` had zero call sites** (plus dead `.btn.lg` CSS) and
  `href` combined with `disabled`/`pending` into a real accessibility gap (an `<a>` with
  `pointer-events: none` + `aria-disabled`, neither of which blocks keyboard Enter/Space
  activation). Removed rather than hardened, since nothing depended on either. Correcting
  the record while here: `pending`/`pendingLabel` were never actually unused — this bullet
  previously missed `account/+page.svelte`'s reset flow, which uses both for its own
  `?/reset` race — so they stay.
- [x] **`Card`'s `elevation`/`padded` resolved: deleted, not adopted.** The Card-adoption
  sweep (spacing-story item below) confirmed neither prop had a real use waiting on it —
  every call site wanted the default shadow and padding — so both are gone; `Card` now
  applies `--shadow-1` and `--pad-card` unconditionally, and `spaced` is its one prop.
- [ ] **`EmptyState`'s `body`/`children` are still unused everywhere**, across all 3 call
  sites. `Field`'s `error` found its first real call site in the `/admin`/`/account`
  adoption above (with `aria-describedby` now actually wired to `{id}-error`); `hint`
  remains unused and its `{id}-hint` id remains unreferenced. Resolve `EmptyState` and
  `hint` against whether a later change gives either a real call site, rather than
  deleting on sight.
- [x] **`--shadow-2` removed rather than left aspirational.** It had exactly one
  consumer — `Card`'s `elevation` prop — which nothing ever set away from its default, and
  the Card-adoption sweep resolved `elevation` by deleting it (see the primitive-props
  bullet above). Rather than leave a documented-but-unreached token sitting next to
  `--shadow-3` (still zero consumers, still disclosed in `docs/UI.md` §10 — that one is
  untouched, since nothing in this pass gave it or took away its reason to exist),
  `--shadow-2` itself is gone from `app.css`; add it back the day something genuinely
  wants a level between a card and a full-screen overlay.
- [x] **Motion tokens: the four bypassing transitions now use them; `--dur-slow` stays
  genuinely unused.** The chevron rotations in `NextSessionCard.svelte` and
  `SessionOverrideList.svelte` (two sites) and `RestTimer.svelte`'s rest-fill width all
  read `var(--dur-base)` now (with `var(--ease)` on the chevrons, `linear` kept explicit
  on the fill since it has to track elapsed time proportionally, not ease), so
  `prefers-reduced-motion: reduce` actually reaches them.
  `CelebrationOverlay.svelte`'s `rise` animation reads `var(--ease-out)` instead of the
  bare CSS keyword (a close but not identical curve — `cubic-bezier(0, 0, 0.2, 1)` vs the
  browser's `cubic-bezier(0, 0, 0.58, 1)` — accepted as the point of having one token
  rather than each transition picking its own "ease-out"). `--dur-slow` is left alone:
  nothing in the app currently animates a sheet's entrance, so giving it a first consumer
  would mean inventing that entrance rather than wiring an existing one onto the token —
  its own design decision, not one to fold into a token cleanup.
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
