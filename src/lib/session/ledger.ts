/**
 * The session runner's own client-side ledger — everything logged, added, substituted,
 * skipped or completed so far this workout — and the queries the runner needs over it:
 * what is actually being performed in a slot, how many sets it currently offers, which
 * exercises are done, and what the pinned strip should open next. Phase 4's own "done
 * when" (ARCHITECTURE §12) commits the runner's logic to being pure and living here;
 * these functions take the ledger's collections and the resolved session explicitly
 * rather than closing over component state, so they are plain functions over plain
 * data — unit-tested without a browser — and the route stays thin. `Svelte{Map,Set}`
 * instances satisfy the read-only interfaces below, so the runner's own reactive state
 * passes straight through with no copying.
 */

import {
  highestLoggedSetNo,
  nextExerciseKey,
  nextUnloggedSlot,
  setLogKey,
  setSlotsFor,
  upNextExerciseParts,
  upNextSlotParts,
  visibleSetCount,
  type LoggedSet,
  type ResolvedBlock,
  type ResolvedExercise,
  type ResolvedSession,
  type SetSlot,
  type UpNextFigure,
} from "./session-view";
import { carryForwardFromPreviousSet, type PrefillByExercise } from "./prefill";

export type SessionLedger = {
  loggedSets: ReadonlyMap<string, LoggedSet>;
  addedSets: ReadonlyMap<string, number>;
  setCountDelta: ReadonlyMap<string, number>;
  completedRounds: ReadonlyMap<string, number>;
  substitutedExercises: ReadonlyMap<string, ResolvedExercise>;
  skippedExercises: ReadonlySet<string>;
};

/**
 * The exercise actually being performed in a slot: the prescribed one, or the
 * substitute swapped in for it. Every render path that shows a name, a target, a dial
 * or a slug goes through here, which is what makes a swap real rather than cosmetic.
 */
export function performed(
  ledger: Pick<SessionLedger, "substitutedExercises">,
  blockKey: string,
  prescribed: ResolvedExercise,
): ResolvedExercise {
  return ledger.substitutedExercises.get(`${blockKey}:${prescribed.slug}`) ?? prescribed;
}

/** The current round of a `type: rounds` block — irrelevant to any other block type. */
export function currentRoundOf(
  ledger: Pick<SessionLedger, "completedRounds">,
  blockKey: string,
): number {
  return (ledger.completedRounds.get(blockKey) ?? 0) + 1;
}

/**
 * How many sets the exercise currently offers, or exactly the current round inside a
 * rounds block (where `set_no` *is* the round, so neither counter below applies).
 *
 * The two counters are deliberately separate mechanisms, not one number:
 *
 * - `addedSets` is UI §6's "Add the optional 3rd set". A ranged prescription
 *   (`sets: [2, 3]`) draws its minimum and offers the sets the plan itself already
 *   declared. Taking one is *doing the plan*, so it logs no deviation, and it can never
 *   exceed the declared max.
 * - `setCountDelta` is the deviation sheet's `add_set`/`drop_set`: a manual override of
 *   what the prescription allows at all — a 4th set on a fixed-3 exercise, or dropping
 *   that same exercise to 2 — which *is* a deviation and always writes a row.
 *
 * Collapsing them would either make taking a declared optional set look like a
 * deviation in the export, or cap a genuine deviation at the ranged max it exists to
 * exceed.
 *
 * A drop has two floors. One slot, because a drop that reached zero is a skip wearing a
 * different name and the sheet already has a Skip that records itself honestly as one.
 * And `highestLoggedSetNo`, because dropping a set must stop the *next* slot being
 * offered, never hide one that was really performed — that row is in the database and
 * will be exported whatever the ledger draws.
 */
export function shownSetsFor(
  ledger: Pick<SessionLedger, "addedSets" | "setCountDelta" | "loggedSets">,
  block: ResolvedBlock,
  prescribed: ResolvedExercise,
): number {
  if (block.type === "rounds") return 1;
  const key = `${block.key}:${prescribed.slug}`;
  const declared = visibleSetCount(prescribed.sets, ledger.addedSets.get(key) ?? 0).shown;
  return Math.max(
    1,
    highestLoggedSetNo(block.key, prescribed.slug, ledger.loggedSets.keys()),
    declared + (ledger.setCountDelta.get(key) ?? 0),
  );
}

/**
 * The slots an exercise currently offers — none at all once it has been skipped.
 *
 * The slot key stays on the **prescribed** slug even after a swap, because it names the
 * slot in the session rather than the movement filling it: session D's rounds block
 * prescribes `dead-bug` in its own right *and* offers it as a substitute for
 * `reverse-crunch` two rows below, so keying by the performed movement would collapse
 * the two exercises onto one another and mark one done by logging the other. `per_side`
 * does come from the performed movement — that is what decides whether there are L/R
 * rows to log at all. What the strip actually posts as `exercise_slug` is separate
 * again, and is always the performed movement (`LogStrip`'s `exercise` prop).
 */
export function slotsFor(
  ledger: SessionLedger,
  block: ResolvedBlock,
  prescribed: ResolvedExercise,
): SetSlot[] {
  if (ledger.skippedExercises.has(`${block.key}:${prescribed.slug}`)) return [];
  return setSlotsFor(
    block,
    { slug: prescribed.slug, perSide: performed(ledger, block.key, prescribed).perSide },
    {
      shownSets: shownSetsFor(ledger, block, prescribed),
      currentRound: currentRoundOf(ledger, block.key),
    },
  );
}

/** The block/prescribed/performed trio `exerciseAt` resolves a key to. */
export type ExerciseAt = {
  block: ResolvedBlock;
  prescribed: ResolvedExercise;
  exercise: ResolvedExercise;
};

/**
 * The block/prescribed/performed trio for any `${block.key}:${slug}` key the session
 * offers, or `undefined` for a checkoff block (never opened) or an unknown key. Used to
 * look up an exercise the runner is not currently *at* — the rest overlay's up-next
 * card needs to describe the exercise auto-advance is about to open, one step ahead of
 * `resolveOpenContext`, which only ever describes the currently open slug.
 */
export function exerciseAt(
  session: ResolvedSession,
  ledger: SessionLedger,
  key: string | undefined,
): ExerciseAt | undefined {
  if (!key) return undefined;
  for (const block of session.blocks) {
    if (block.tracking === "checkoff") continue;
    for (const prescribed of block.exercises) {
      if (`${block.key}:${prescribed.slug}` !== key) continue;
      return { block, prescribed, exercise: performed(ledger, block.key, prescribed) };
    }
  }
  return undefined;
}

/**
 * Every exercise that needs nothing more from the user — each offered slot logged, or
 * the whole exercise skipped. Drives both the collapsed row's completion state
 * (UI §1) and where auto-advance goes next.
 */
export function computeDoneExercises(session: ResolvedSession, ledger: SessionLedger): Set<string> {
  const done = new Set<string>();
  for (const block of session.blocks) {
    if (block.tracking === "checkoff") continue;
    for (const prescribed of block.exercises) {
      const key = `${block.key}:${prescribed.slug}`;
      if (ledger.skippedExercises.has(key)) {
        done.add(key);
        continue;
      }
      const slots = slotsFor(ledger, block, prescribed);
      if (slots.length > 0 && nextUnloggedSlot(slots, ledger.loggedSets) === undefined)
        done.add(key);
    }
  }
  return done;
}

/**
 * Whether a whole block needs nothing more from the user — what draws the block head's
 * completion mark. `doneExercises` is the set `computeDoneExercises` already derives once
 * per render, passed in rather than recomputed per block.
 *
 * Each block type answers this differently, and the differences are not cosmetic:
 *
 * - **checkoff** is excluded from `doneExercises` entirely (it has no slots to log), so
 *   it is read straight off `loggedSets` — every pill toggled on, using the same
 *   `setLogKey(block, slug, 1)` the pill itself writes.
 * - **sequence** is every exercise done, which includes the skipped ones: a skip is a
 *   recorded decision that this block is finished with, not an omission, and
 *   `computeDoneExercises` has always treated it that way.
 * - **rounds** is the round counter alone, and deliberately ignores `doneExercises`. A
 *   rounds block only ever offers the *current* round's slots, so every exercise in it
 *   reads as done at the end of round 1 of 3 — the moment the block is least finished.
 *   Trusting the exercises there would mark a circuit complete two thirds early.
 *
 * A block with no exercises is never complete: `every` over an empty list is vacuously
 * true, and a completion mark against nothing is a lie the user has no way to read.
 */
export function blockIsComplete(
  block: ResolvedBlock,
  ledger: SessionLedger,
  doneExercises: ReadonlySet<string>,
): boolean {
  if (block.exercises.length === 0) return false;
  if (block.tracking === "checkoff") {
    return block.exercises.every((e) => ledger.loggedSets.has(setLogKey(block.key, e.slug, 1)));
  }
  if (block.type === "rounds") {
    const rounds = block.rounds ?? 0;
    return rounds > 0 && (ledger.completedRounds.get(block.key) ?? 0) >= rounds;
  }
  return block.exercises.every((e) => doneExercises.has(`${block.key}:${e.slug}`));
}

/**
 * Everything the pinned strip needs about the one open exercise (UI §1: one
 * exercise open, §2: the strip logs exactly one set). `next` is `undefined` once every
 * offered set is logged — the strip then shows its finished state rather than
 * vanishing, so the ledger's reserved bottom padding stays honest.
 *
 * `prescribed` is the session's own exercise (the thing every map is keyed by);
 * `exercise` is what is actually being performed, which is what gets logged.
 */
export type OpenContext = {
  key: string;
  block: ResolvedBlock;
  prescribed: ResolvedExercise;
  exercise: ResolvedExercise;
  shownSets: number;
  next: SetSlot | undefined;
};

export function resolveOpenContext(
  session: ResolvedSession,
  ledger: SessionLedger,
  openSlug: string | undefined,
): OpenContext | undefined {
  if (!openSlug) return undefined;
  for (const block of session.blocks) {
    if (block.tracking === "checkoff") continue;
    for (const prescribed of block.exercises) {
      const key = `${block.key}:${prescribed.slug}`;
      if (key !== openSlug) continue;
      return {
        key,
        block,
        prescribed,
        exercise: performed(ledger, block.key, prescribed),
        shownSets: shownSetsFor(ledger, block, prescribed),
        next: nextUnloggedSlot(slotsFor(ledger, block, prescribed), ledger.loggedSets),
      };
    }
  }
  return undefined;
}

/** UI §4's up-next card: a name, a pre-formatted two-line body (`context` then
 * icon-tagged `figures`), following the same pattern as `LogStrip`'s
 * `context`/`lastPerformance` props — `RestTimer` itself does no formatting, only
 * rendering. `isLast` tells `RestTimer` whether its dismiss button is starting something
 * or just closing the overlay, so the button's own label can agree with "Nothing left"
 * instead of offering to start a set that isn't coming. */
export type UpNext = {
  label: string;
  context: string;
  figures: readonly UpNextFigure[];
  isLast: boolean;
};

/** Nothing else is scheduled — the rest overlay still needs an up-next card even when
 * this was the session's very last set or round. */
export const UP_NEXT_FALLBACK: UpNext = {
  label: "Nothing left",
  context: "Finish up when you're ready",
  figures: [],
  isLast: true,
};

/**
 * `blockKey`/`prescribedSlug` are the slot's identity (same as `setLogKey`), used to
 * look up whatever this session already logged for the *previous* set of the same slot
 * — the pre-fill's outermost rung (`carryForwardFromPreviousSet`): a set bumped from
 * 6 kg to 8 kg mid-exercise should not reset to 6 kg on the next set. `exerciseSlug` is
 * the *performed* movement (post-substitution), which is what history is keyed by.
 *
 * `slot` is `undefined` when every slot the exercise offers is already logged — the
 * strip's "All sets logged" state, and the up-next card for an exercise that has nothing
 * left to open. There is no next set then, so there is no side either, and a per-side
 * exercise pre-fills nothing rather than picking a side arbitrarily: `left` and `right`
 * carry genuinely different loads, so naming one of them would name a load for a set
 * that isn't coming.
 */
export function prefillFor(
  ledger: Pick<SessionLedger, "loggedSets">,
  prefillByExercise: PrefillByExercise,
  blockKey: string,
  prescribedSlug: string,
  exerciseSlug: string,
  perSide: boolean,
  slot: SetSlot | undefined,
): { reps?: number; weightKg?: number; durationS?: number } {
  const entry = prefillByExercise[exerciseSlug];
  const sided = slot === undefined ? undefined : slot.side === "left" ? entry?.left : entry?.right;
  const base = (perSide ? sided : entry?.none) ?? {};
  if (!slot || slot.setNo <= 1) return base;
  const previous = ledger.loggedSets.get(
    setLogKey(blockKey, prescribedSlug, slot.setNo - 1, slot.side),
  );
  return carryForwardFromPreviousSet(base, previous);
}

/**
 * The up-next card for a resolved exercise, or the fallback when there isn't one —
 * shared by `upNextForSetLogged`'s finished-exercise branch and `startNextRound`.
 *
 * It resolves that exercise's own next unlogged slot to read the load off it, so the
 * card carries the weight the log strip is about to offer — `context: "3 sets"`,
 * `figures: [8–12 reps, 8 kg]` — the same way the same-exercise branch already did.
 * Without it, crossing from one exercise to the next was the one moment the overlay went
 * quiet about load: the user saw a bare `3 sets, 8–12 reps`, and the number they were
 * about to lift only appeared once they had logged set one and the *other* branch took
 * over.
 *
 * The sets count is the right context for a *sequence* block, where nothing of the
 * coming movement has been logged yet. A rounds block is the other way round: this is
 * the function that builds the between-rounds card (`startNextRound`), where "1 set" is
 * both useless and false — the user is starting round 2 of a circuit, which is exactly
 * what the strip behind the overlay will say the moment it is dismissed. So a rounds
 * block borrows `upNextSlotParts` and its already-resolved slot to say "Round 2 of 2",
 * and the overlay can never name the coming set differently than the strip it hands off
 * to.
 */
export function upNextForExerciseAt(
  ledger: SessionLedger,
  prefillByExercise: PrefillByExercise,
  next: ExerciseAt | undefined,
): UpNext {
  if (!next) return UP_NEXT_FALLBACK;
  const shownSets = shownSetsFor(ledger, next.block, next.prescribed);
  const slot = nextUnloggedSlot(slotsFor(ledger, next.block, next.prescribed), ledger.loggedSets);
  const weight = prefillFor(
    ledger,
    prefillByExercise,
    next.block.key,
    next.prescribed.slug,
    next.exercise.slug,
    next.exercise.perSide,
    slot,
  ).weightKg;
  return {
    label: next.exercise.name,
    ...(next.block.type === "rounds" && slot
      ? upNextSlotParts(next.block, slot, shownSets, next.exercise, weight)
      : upNextExerciseParts(next.exercise, weight)),
    isLast: false,
  };
}

/**
 * The rest overlay's up-next card (UI §4) after a set is logged. Two cases:
 *
 * - The exercise isn't finished — "next" is the next slot of the *same* exercise, its
 *   context formatted the same way `LogStrip`'s own context line is, plus the reps/time
 *   and load figures for that slot.
 * - The exercise IS finished — "next" is whatever auto-advance (`nextExerciseKey`)
 *   would open once this rest is dismissed, named by `upNextForExerciseAt`'s sets count
 *   (or round, in a rounds block) and the same figures. Scoped from `context.key`
 *   exactly like the runner's own `advance()`, so the preview can never name a
 *   different exercise than the one that actually opens.
 */
export function upNextForSetLogged(
  session: ResolvedSession,
  ledger: SessionLedger,
  done: { has(key: string): boolean },
  prefillByExercise: PrefillByExercise,
  context: {
    block: ResolvedBlock;
    prescribed: ResolvedExercise;
    exercise: ResolvedExercise;
    key: string;
    shownSets: number;
  },
  nextSlot: SetSlot | undefined,
): UpNext {
  if (nextSlot) {
    const weight = prefillFor(
      ledger,
      prefillByExercise,
      context.block.key,
      context.prescribed.slug,
      context.exercise.slug,
      context.exercise.perSide,
      nextSlot,
    ).weightKg;
    return {
      label: context.exercise.name,
      ...upNextSlotParts(context.block, nextSlot, context.shownSets, context.exercise, weight),
      isLast: false,
    };
  }
  return upNextForExerciseAt(
    ledger,
    prefillByExercise,
    exerciseAt(session, ledger, nextExerciseKey(session, done, context.key)),
  );
}
