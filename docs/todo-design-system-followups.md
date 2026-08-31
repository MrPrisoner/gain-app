# UI design-system pass — final-review follow-ups (deferred)

Temporary tracking doc. Delete it once these are picked up and any durable half is folded
into `docs/UI.md` (or wherever it lands) — see CLAUDE.md's "Tracking work, and folding it
back in". This is a **separate** list from `docs/todo-phase-3-screen-polish.md`, which
tracks an earlier, differently-scoped set of screen-level judgement calls carried forward
from before this pass. Don't merge the two files or their items — they came from different
reviews at different times, and a future reader should be able to tell which is which.

These are findings from the final whole-branch review of the 14-task UI design-system pass
(branch `ui/design-system`), recorded rather than fixed because the reviewer's verdict was
"ready to merge with fixes" and these are not part of the fix wave — each is real,
already-verified, and worth picking up, but none of them was worth holding the merge for.

- [ ] **Third button vocabulary still exists.** `src/routes/import/ImportPlanForm.svelte`,
  `src/routes/plan/[slug]/versions/[n]/+page.svelte`, and `src/routes/+page.svelte`
  (first-run/no-plans view) each hand-roll their own `button`/`.primary`/`.secondary` CSS
  instead of using the `Button` primitive — disagreeing with it on background (`--raised`
  vs `--surface`), border (`--line` vs `--line-strong`), weight (`--w-bold` vs `--w-semi`),
  and missing the 44px `min-height` floor (currently passes only because padding happens
  to clear it). The same copy/download button pair renders three visually different ways
  across `/export`, `/plan/.../versions/[n]`, and first-run home.
- [ ] **`--line-strong` sweep outstanding.** ~26 tappable controls (textareas, `<select>`s,
  tappable pills/rows — e.g. `ImportPlanForm.svelte`'s paste textarea,
  `versions/[n]/+page.svelte`'s `.doc` textarea, both progress window `<select>`s,
  `DeviationSheet.svelte`'s substitute select and reason chips, `MetricRow.svelte`'s scale
  cells, `BlockSection.svelte`'s warm-up pills, `RestTimer.svelte`'s buttons) still use
  `--line` instead of `--line-strong`, measuring 1.2–1.7:1 against their surfaces — below
  the WCAG 3:1 non-text contrast floor the token exists to satisfy. `docs/UI.md` §10 now
  states the rule as the standard for new code rather than as something already applied;
  this item is the sweep that would make it true everywhere.
- [ ] **Palette-copy guard-test gap.** `tests/design-tokens.test.ts` only asserts the two
  `[data-theme="..."]` palette blocks in `app.css`; the bare `:root` / `@media
  (prefers-color-scheme)` pair — the actual default path for a user who has never touched
  the theme toggle — is unasserted. They currently agree on all 21 colour tokens, but
  nothing keeps them agreeing. Cheap fix: assert `bare :root ≡ [data-theme="dark"]` and
  `media light ≡ [data-theme="light"]`.
- [ ] **Several primitive props are unused everywhere.** `Button`: `href`, `size`,
  `pending`, `pendingLabel` have zero call sites (plus dead `.btn.lg` CSS); the runner
  doesn't use `Button` at all despite it existing partly for the runner's own
  `?/start`-race concern. `Card`: `elevation` and `padded` unused across all 14 call
  sites. `EmptyState`: `body` and `children` unused across all 3. `Field`: `hint` and
  `error` unused across both call sites, and their `{id}-hint`/`{id}-error` generated ids
  have no `aria-describedby` consumer anywhere, so that wiring is currently inert.
- [ ] **`Card` has no spacing story.** Three files (`import/+page.svelte`, home's
  `+page.svelte`, `export/+page.svelte`) each wrap `<Card>` in their own
  `<div class="card">` just to get `margin-top: 1.25rem` — a sixth adopting route would
  likely copy this pattern rather than find a clean built-in way to space a `Card`.
- [ ] **Motion tokens mostly unused, and some transitions bypass them entirely.**
  `--dur-base`, `--dur-slow`, and `--ease-out` have zero consumers. Four hand-written
  transitions bypass the token system — the chevron rotations in `NextSessionCard.svelte`
  and `SessionOverrideList.svelte` (`transition: transform 0.15s ease`, two sites), and
  `RestTimer.svelte`'s `width 0.2s linear` — meaning `prefers-reduced-motion: reduce`
  (which works by collapsing `--dur-*` at `:root`) does not reach them, contradicting
  §10's framing that it does.
- [ ] **`--shadow-2` is effectively dead.** Only two `box-shadow` declarations exist in the
  whole app, both in `Card.svelte`, and nothing currently passes `elevation={2}` — so
  `--shadow-2` (documented as being for "sheets, the log strip, sticky chrome") has no
  actual consumer yet. (§10 already discloses `--shadow-3` has zero consumers; this is the
  same situation one level up.)
- [ ] **The wordmark's literal colour fails contrast in most combinations.**
  `src/routes/+layout.svelte`'s wordmark "AI" span uses a literal `#6a8098` (not a token),
  measuring 4.07:1 / 3.76:1 on light surfaces and 4.32:1 on dark `--surface` — below the
  4.5:1 AA floor in 3 of 4 combinations. Likely defensible as a logotype (WCAG 1.4.3
  exempts brand marks) but sits outside every contrast guard this pass added, since the
  guard test only inspects tokens.
- [ ] **`/admin` and `/account` hand-roll the exact shape `Field` exists for.** Both have a
  `<label for>` + `<input>` + separate error `<p>` pattern in files that already adopted
  `Button` and `Card` — a natural next `Field` adoption site.
- [ ] **`Button`'s `href` + `inert` combination has a latent accessibility gap.** When
  `href` is set and the button is disabled/pending, it renders `pointer-events: none` +
  `aria-disabled` on an `<a>` — neither of which actually prevents keyboard (Enter/Space)
  activation of a real anchor element. Currently unreachable in practice (no call site
  uses `href` at all yet), but will be wrong the first time someone does.
