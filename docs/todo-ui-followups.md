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
- [ ] **Several primitive props are unused everywhere.** `Button`: `href`, `size`,
  `pending`, `pendingLabel` have zero call sites (plus dead `.btn.lg` CSS); the runner
  doesn't use `Button` at all despite it existing partly for the runner's own
  `?/start`-race concern. `Card`: `elevation` and `padded` unused across all 14 call
  sites. `EmptyState`: `body` and `children` unused across all 3. `Field`: `hint` and
  `error` unused across both call sites, and their `{id}-hint`/`{id}-error` generated ids
  have no `aria-describedby` consumer anywhere, so that wiring is currently inert.
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

## Accessibility

- [ ] **`--line-strong` sweep outstanding.** ~26 tappable controls (textareas, `<select>`s,
  tappable pills/rows — e.g. `ImportPlanForm.svelte`'s paste textarea,
  `versions/[n]/+page.svelte`'s `.doc` textarea, both progress window `<select>`s,
  `DeviationSheet.svelte`'s substitute select and reason chips, `MetricRow.svelte`'s scale
  cells, `BlockSection.svelte`'s warm-up pills, `RestTimer.svelte`'s buttons) still use
  `--line` instead of `--line-strong`, measuring 1.2–1.7:1 against their surfaces — below
  the WCAG 3:1 non-text contrast floor the token exists to satisfy. `docs/UI.md` §10 now
  states the rule as the standard for new code rather than as something already applied;
  this item is the sweep that would make it true everywhere.
- [ ] **The wordmark's literal colour fails contrast in most combinations.**
  `src/routes/+layout.svelte`'s wordmark "AI" span uses a literal `#6a8098` (not a token),
  measuring 4.07:1 / 3.76:1 on light surfaces and 4.32:1 on dark `--surface` — below the
  4.5:1 AA floor in 3 of 4 combinations. Likely defensible as a logotype (WCAG 1.4.3
  exempts brand marks) but sits outside every contrast guard this pass added, since the
  guard test only inspects tokens.
- [ ] **`Button`'s `href` + `inert` combination has a latent accessibility gap.** When
  `href` is set and the button is disabled/pending, it renders `pointer-events: none` +
  `aria-disabled` on an `<a>` — neither of which actually prevents keyboard (Enter/Space)
  activation of a real anchor element. Currently unreachable in practice (no call site
  uses `href` at all yet), but will be wrong the first time someone does.

## Test coverage

- [ ] **Palette-copy guard-test gap.** `tests/design-tokens.test.ts` only asserts the two
  `[data-theme="..."]` palette blocks in `app.css`; the bare `:root` / `@media
  (prefers-color-scheme)` pair — the actual default path for a user who has never touched
  the theme toggle — is unasserted. They currently agree on all 21 colour tokens, but
  nothing keeps them agreeing. Cheap fix: assert `bare :root ≡ [data-theme="dark"]` and
  `media light ≡ [data-theme="light"]`.
- [ ] **`.linklike`'s 44px floor is untested under real conditions.** The header's Sign
  out / admin "Users" / sync-banner Discard controls were given the same `min-height` +
  `min-width` floor `Button` holds (fixed alongside this doc's merge), but
  `e2e/touch-targets.spec.ts` can't see any of them today: every e2e run goes through the
  `GAIN_DEV_USER` bypass, which always sets `data.user.bypass`, so Sign out never renders
  in any spec; "Users" only renders for `GAIN_DEV_ADMIN`, which no touch-target route
  currently authenticates as; and Discard only renders once an op is quarantined, which
  no touch-target route triggers. Extending the spec to cover at least the admin-header
  case (`x-gain-e2e-user: e2e-admin`) is a reasonable next step; Sign out is likely
  untestable without a real OIDC session, which the e2e harness deliberately doesn't run.

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
- [ ] **Native `<select>`/`<radio>` beside custom pills.** Plain `<select>` elements
  remain in `DeviationSheet.svelte` (the substitute picker), the three progress window
  pickers, and `DispositionList.svelte`, all alongside the app's custom pill/chip pattern
  used elsewhere for the same kind of choice.
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
