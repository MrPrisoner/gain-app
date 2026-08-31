# Phase 3 — screen-level polish (deferred)

Temporary tracking doc. Delete it once phase 3 is picked up and its durable half (if any)
is folded into `docs/UI.md` or wherever it lands — see CLAUDE.md's "Tracking work, and
folding it back in".

Carried forward from `docs/superpowers/specs/2026-08-30-ui-design-system-design.md` §2,
which scoped these out of the token-layer/component-primitive pass (phases 1–2, done) as
screen-level judgement calls to be re-reviewed against the finished system rather than
guessed at alongside it. Re-checked against the code on 2026-08-30, after phases 1–2
landed, rather than copied forward blind — findings below reflect what is actually true
now, not what was true when the spec was written.

- [ ] **Home's five-identical-pills nav.** `src/routes/+page.svelte`'s `.plan-links` nav
  renders "Export for review", "Progress", "History", "Plan versions" and "Import a
  revised plan" as five visually identical `.export-link` pills, with no weight given to
  the ones used more often. Untouched by phases 1–2 (a token remap, not a restructure).
  Still open.
- [ ] **Home's duplicated plan name.** A plan's name renders once in `NextSessionCard`
  (via its `planName` prop) and again immediately below, in the `plan-admin` card's own
  `<h2>{plan.name}</h2>` — the same string twice on one screen. Still open.
- [ ] **Effort keys' undersized fill segments.** `LogStrip.svelte`'s Easy/Medium/Hard fill
  indicator (`.effort-fill`) is a row of small `i` segments — still small, cosmetically
  unchanged by the token remap. Still open.
- [ ] **Native `<select>`/`<radio>` beside custom pills.** Plain `<select>` elements
  remain in `DeviationSheet.svelte` (the substitute picker), the three progress window
  pickers, and `DispositionList.svelte`, all alongside the app's custom pill/chip pattern
  used elsewhere for the same kind of choice. Still open.
- [ ] **History's "1 sets" plural bug.** `src/routes/plan/[slug]/history/+page.svelte`
  still interpolates `{workout.setCount} sets` with no singular form. Still open.
- [~] **Destructive actions styled neutral — partially resolved.** Task 10 gave
  `variant="danger"` to `/account`'s and `/admin`'s reset buttons, which covers the two
  call sites the spec's audit had in mind. But it is not the whole of the item: the sync
  banner's "Discard" control (`src/routes/+layout.svelte`, inside the quarantined-ops
  banner) permanently discards queued offline writes — a genuinely destructive, irreversible
  action — and is still styled as a plain `.linklike` button (`color: var(--muted)`), the
  same treatment as "Sign out" beside it. Worth a `Button variant="danger"` (or at least
  `--red`) pass if phase 3 revisits this item.
- [x] **Progress's chart-height empty states — resolved as originally scoped.** The spec's
  own wording (§4) was about *caller-owned* "No data yet" wells reserving full chart
  height; Task 12 replaced all three (`progress/exercises`, `progress/metrics`,
  `history`) with the compact `EmptyState` primitive. That specific item is done.
  **A related but distinct issue remains, already tracked separately rather than as
  phase-3 work:** `Sparkline.svelte` and `BarChart.svelte` render their *own* internal
  "No data yet" text inside an unconditionally-rendered, full-height SVG when a chart's
  `points`/`series` prop is empty — a chart component's own render behaviour, not a
  caller-owned empty state, and not something `EmptyState` was ever meant to reach inside
  a third-party chart. This was surfaced during Task 11's review as a pre-existing,
  latent bug in both chart components: each plotted point's hit target is a real
  `role="button"` circle (`Sparkline`) or rect (`BarChart`) sized in SVG viewBox units,
  which renders under the 44px touch-target floor on a narrow phone once the chart
  actually has data to plot — `e2e/touch-targets.spec.ts` does query these elements (they
  match its selector), but the progress fixtures used in isolation don't seed duration
  data, so the charts render their empty state and the undersized circles never appear to
  be measured. Running the full suite together, with `progress-walkthrough.spec.ts`
  seeding real data first, does reproduce it. This predates the whole design-system plan,
  is unrelated to any of its tasks, and was deliberately parked rather than fixed in
  Tasks 11–12 (fixing it needs interaction-design judgement — enlarging the hit circles
  risks overlapping neighbours on a densely-plotted chart — not a token swap). Left here
  so it isn't lost; a fix is a good candidate for its own task rather than a phase-3
  screen-polish item, since it's a chart-primitive bug rather than a layout judgement
  call.
