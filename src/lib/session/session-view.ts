/**
 * A session's blocks and exercises, resolved from the stored contract with every
 * prescription-level override applied over its catalogue default (CONTRACT: catalogue
 * declares defaults, a prescription's own fields override them for that occurrence
 * only). Pure — everything here operates on a `GainContract` already in memory
 * (`contractOfVersion`), no I/O.
 */

import { deriveExerciseName } from "../contract/schema";
import type {
  Block,
  ExerciseDef,
  GainContract,
  IntOrRange,
  LoadConfig,
  MetricDef,
  Prescription,
} from "../contract/schema";

export type ResolvedExercise = {
  slug: string;
  name: string;
  type: "reps" | "time";
  perSide: boolean;
  loadRef: string | undefined;
  /**
   * The resolved load configuration (CONTRACT `loads`), or `undefined` when this
   * exercise declares no `load` ref at all. UI-DECISIONS §3, Settled 2026-08-10: a
   * paired lift (e.g. floor press) would ideally show `12 kg` with a `2 × 6` sub-line
   * beneath it, but the contract has no field that means "this movement is paired" —
   * `per_side` doesn't mean it (goblet squat is single-dumbbell and not `per_side`;
   * floor press is paired and not `per_side`) — and adding a `paired` field was
   * decided not worth the `docs/CONTRACT.md`/export surface it would need. So
   * `weight_kg` is always the total being lifted and the `2 × N` sub-line is
   * intentionally not built; this is a settled decision, not a gap.
   */
  load:
    | { ref: string; label?: string; defaultKg?: number; isBodyweight: boolean; note?: string }
    | undefined;
  restSec: IntOrRange | undefined;
  conditional: boolean;
  condition: string | undefined;
  substitutes: string[];
  sets: IntOrRange;
  reps: IntOrRange | undefined;
  durationSec: IntOrRange | undefined;
  note: string | undefined;
};

export type ResolvedBlock = {
  key: string;
  name: string;
  type: "sequence" | "rounds";
  rounds: number | undefined;
  /** Rounds blocks only: rest BETWEEN rounds. */
  restSec: IntOrRange | undefined;
  tracking: "full" | "checkoff";
  note: string | undefined;
  exercises: ResolvedExercise[];
};

export type ResolvedSession = {
  key: string;
  name: string;
  order: number;
  note: string | undefined;
  blocks: ResolvedBlock[];
};

export function resolveSession(
  contract: GainContract,
  sessionKey: string,
): ResolvedSession | undefined {
  const session = contract.sessions.find((s) => s.key === sessionKey);
  if (!session) return undefined;

  const catalogue = new Map(contract.exercises.map((e) => [e.id, e]));

  return {
    key: session.key,
    name: session.name,
    order: session.order,
    note: session.note,
    blocks: session.blocks.map((block) => resolveBlock(block, catalogue, contract)),
  };
}

function resolveBlock(
  block: Block,
  catalogue: ReadonlyMap<string, ExerciseDef>,
  contract: GainContract,
): ResolvedBlock {
  return {
    key: block.key,
    name: block.name,
    type: block.type ?? "sequence",
    rounds: block.rounds,
    restSec: block.rest_sec,
    tracking: block.tracking ?? "full",
    note: block.note,
    exercises: block.exercises.map((rx) => resolveExercise(rx, catalogue, contract)),
  };
}

function resolveExercise(
  rx: Prescription,
  catalogue: ReadonlyMap<string, ExerciseDef>,
  contract: GainContract,
): ResolvedExercise {
  const def = catalogue.get(rx.id);
  if (!def) {
    throw new Error(
      `resolveSession: \`${rx.id}\` is not in the exercise catalogue — the contract validator should already have rejected this document`,
    );
  }

  return {
    ...catalogueIdentity(def, contract.loads, rx.load ?? def.load),
    restSec: rx.rest_sec ?? def.rest_sec,
    conditional: rx.conditional ?? def.conditional ?? false,
    condition: rx.condition ?? def.condition,
    substitutes: rx.substitutes ?? def.substitutes ?? [],
    sets: rx.sets ?? 1,
    reps: rx.reps,
    durationSec: rx.duration_sec,
    note: rx.note ?? def.note,
  };
}

/**
 * The display name for a bare slug, resolved through the plan's catalogue.
 *
 * Substitutes travel as slugs everywhere — CONTRACT declares them as `id` references, and
 * the runner writes `deviation.substitute_exercise_slug` as loose text — so any screen
 * offering one to a *user* has to resolve it or it shows them
 * "seated-floor-shoulder-press" where the plan says "Seated floor shoulder press".
 *
 * `deriveExerciseName` is the fallback rather than the answer: CONTRACT requires every
 * substitute to be declared in the catalogue, so the lookup normally hits, and a derived
 * name is noticeably worse (`deriveExerciseName("db-floor-press")` gives "Db floor
 * press"). The fallback exists so this can never render blank.
 */
export function exerciseNameFor(catalogue: readonly ExerciseDef[], slug: string): string {
  const def = catalogue.find((e) => e.id === slug);
  return def?.name ?? deriveExerciseName(slug);
}

/**
 * The half of a `ResolvedExercise` that belongs to the *movement* rather than to the
 * occasion it is performed on — CONTRACT: "All occurrences share one `id`, and therefore
 * one identity, one name and one set of movement properties." Shared by
 * `resolveExercise`, which layers a prescription's targets and overrides on top, and
 * `resolveSubstitute`, which layers the targets of the occasion being *replaced* on top
 * instead. Neither may re-derive load/type/per_side resolution on its own.
 */
function catalogueIdentity(
  def: ExerciseDef,
  loads: readonly LoadConfig[],
  loadRef: string | undefined,
): Pick<ResolvedExercise, "slug" | "name" | "type" | "perSide" | "loadRef" | "load"> {
  const config = findLoad(loads, loadRef);
  return {
    slug: def.id,
    name: def.name ?? deriveExerciseName(def.id),
    type: def.type ?? "reps",
    perSide: def.per_side === true,
    loadRef,
    load: config
      ? {
          ref: config.ref,
          label: config.label,
          defaultKg: config.default_kg,
          isBodyweight: config.is_bodyweight === true,
          note: config.note,
        }
      : undefined,
  };
}

function findLoad(loads: readonly LoadConfig[], ref: string | undefined): LoadConfig | undefined {
  if (ref === undefined) return undefined;
  return loads.find((l) => l.ref === ref);
}

export function resolveLoad(
  contract: GainContract,
  ref: string | undefined,
): LoadConfig | undefined {
  return findLoad(contract.loads, ref);
}

/**
 * A declared substitute (CONTRACT: "`substitutes` entries are always bare slugs declared
 * in the catalogue"), resolved into a `ResolvedExercise` that can stand in for the
 * exercise it replaces — so the log strip posts *its* slug and the ledger renders *its*
 * name, rather than the runner logging the movement the plan told you to avoid.
 *
 * The split follows CONTRACT exactly:
 *
 * - **Catalogue identity comes from the substitute** — name, `type`, `per_side`, `load`,
 *   `note`. These are properties of the movement, and a substitute is a different
 *   movement. A `per_side` substitute for a two-sided original really does want L/R
 *   ledger rows, and a bodyweight substitute for a loaded original really does want the
 *   load dial gone.
 * - **Targets come from the occasion being replaced** — `sets`, `rest_sec`, and the
 *   rep/duration target. A substitute has no prescription of its own for *this* occasion;
 *   the occasion is the one it is standing in for. (`rest_sec` too: the substitute's
 *   catalogue default describes the movement in the abstract, but what governs here is
 *   the slot in the session it has been dropped into.)
 * - **The condition does not carry over.** `conditional`/`condition`/`substitutes` are
 *   cleared: swapping *is* the answer to the condition prompt, so re-asking it — or
 *   offering the substitute's own substitutes — on the movement you just chose is noise.
 *   The prescribed exercise's condition text stays rendered by the runner alongside a
 *   "swapped in for" cue, which is where the audit trail belongs.
 *
 * When the substitute's `type` differs from the original's (the fixture's real
 * `reverse-crunch` → `front-plank` case: a reps movement replaced by a timed one) the
 * plan has simply never said how long to hold it, so the target is left `undefined` and
 * `formatTargetOrSets`/`formatRepsOrDurationOrDash` render the sets count alone rather
 * than inventing a number. Returns `undefined` when the slug is not in the catalogue —
 * the contract validator should make that unreachable, but the caller is a browser with
 * a slug it read off a form, so it gets a value it can surface rather than a throw.
 */
export function resolveSubstitute(
  catalogue: readonly ExerciseDef[],
  loads: readonly LoadConfig[],
  original: Pick<ResolvedExercise, "sets" | "reps" | "durationSec" | "restSec">,
  substituteSlug: string,
): ResolvedExercise | undefined {
  const def = catalogue.find((e) => e.id === substituteSlug);
  if (!def) return undefined;

  const identity = catalogueIdentity(def, loads, def.load);
  return {
    ...identity,
    restSec: original.restSec,
    conditional: false,
    condition: undefined,
    substitutes: [],
    sets: original.sets,
    reps: identity.type === "reps" ? original.reps : undefined,
    durationSec: identity.type === "time" ? original.durationSec : undefined,
    note: def.note,
  };
}

export function sessionMetrics(
  contract: GainContract,
  promptWhen?: "start" | "end" | "next_morning",
): MetricDef[] {
  const list = contract.metrics?.session ?? [];
  return promptWhen === undefined ? list : list.filter((m) => m.prompt_when === promptWhen);
}

export function setMetrics(contract: GainContract): MetricDef[] {
  return contract.metrics?.set ?? [];
}

export function exerciseMetrics(contract: GainContract): MetricDef[] {
  return contract.metrics?.exercise ?? [];
}

/**
 * UI-DECISIONS §6: draw the ranged-set minimum only, then offer "Add the optional Nth
 * set" up to the declared max. `addedSets` is how many optional sets the user has
 * already tapped to add this exercise, this workout.
 */
export function visibleSetCount(
  sets: IntOrRange,
  addedSets: number,
): { shown: number; canAddMore: boolean } {
  const [min, max] = typeof sets === "number" ? [sets, sets] : sets;
  const shown = Math.min(min + Math.max(0, addedSets), max);
  return { shown, canAddMore: shown < max };
}

/**
 * UI-DECISIONS §4: rest appears only where the contract declares `rest_sec`, and never
 * between exercises in a checkoff block (no sets logged at all) or a rounds block (rest
 * there is between rounds, handled by `restBetweenRounds`).
 */
export function restForSet(
  block: ResolvedBlock,
  exercise: ResolvedExercise,
): IntOrRange | undefined {
  if (block.tracking === "checkoff") return undefined;
  if (block.type === "rounds") return undefined;
  return exercise.restSec;
}

/**
 * Rest between rounds of a `type: rounds` block — never after the final round, and
 * never in a checkoff block (rounds blocks are never checkoff in practice, but the
 * guard mirrors `restForSet`'s).
 */
export function restBetweenRounds(
  block: ResolvedBlock,
  completedRound: number,
): IntOrRange | undefined {
  if (block.type !== "rounds" || block.tracking === "checkoff") return undefined;
  if (block.rounds !== undefined && completedRound >= block.rounds) return undefined;
  return block.restSec;
}

/**
 * One loggable set of one exercise, in prescribed order: the set number (the *round*
 * number in a `type: rounds` block, where `set_no` restarts per round), the side for a
 * `per_side` exercise, and the client-side identity both the ledger and the log strip
 * key off.
 */
export type SetSlot = {
  setNo: number;
  side: "left" | "right" | undefined;
  key: string;
};

/** What was actually logged for a slot — never the pre-fill it started from. */
export type LoggedSet = {
  reps?: number;
  weightKg?: number;
  durationS?: number;
  difficulty?: "easy" | "medium" | "hard";
};

/**
 * The identity of one logged set within a workout. The block key and the set number
 * (round number, in a `type: rounds` block) are both required: the same exercise slug
 * can appear in more than one block of a session, and a rounds block reuses `set_no`
 * per round, so omitting either collapses distinct sets onto the same key.
 *
 * Deliberately derivable from a stored `set_log` row alone (block key aside, which the
 * resolved session supplies) so a resumed workout can rebuild the same keys from the
 * server rather than only from a client-side map that starts empty. The one exception is
 * a slot whose exercise has been substituted: the runner keeps such a slot on its
 * *prescribed* slug (see `slotsFor` in the runner) while logging against the substitute's,
 * because a block can prescribe the substitute in its own right. Rebuilding that slot on
 * resume needs the workout's `deviation` rows too, not `set_log` alone.
 */
export function setLogKey(
  blockKey: string,
  exerciseSlug: string,
  setNo: number,
  side?: "left" | "right",
): string {
  return `${blockKey}:${exerciseSlug}:${setNo}:${side ?? ""}`;
}

/**
 * The highest set number already logged for one exercise, or `0` when none is — read back
 * out of the runner's `setLogKey`-keyed map rather than tracked separately, so it cannot
 * drift from what the ledger actually holds.
 *
 * This is the floor a `drop_set` deviation may not go below. Dropping a set has to stop
 * *future* slots being offered; it must never shrink the ledger past a set that was really
 * performed, because that row is in the database and will be exported either way, and a
 * ledger that hides it is simply lying. (Contrast the substitution case, where slots
 * legitimately re-shape around a different movement's `per_side`.)
 *
 * Matches on the `${blockKey}:${slug}:` prefix and requires the next segment to be digits,
 * so a block key containing a colon — `key` is only `nonEmptyString` in the schema —
 * cannot make one exercise's rows count towards another's.
 */
export function highestLoggedSetNo(
  blockKey: string,
  exerciseSlug: string,
  loggedKeys: Iterable<string>,
): number {
  const prefix = `${blockKey}:${exerciseSlug}:`;
  let highest = 0;
  for (const key of loggedKeys) {
    if (!key.startsWith(prefix)) continue;
    const setNo = /^(\d+):/.exec(key.slice(prefix.length))?.[1];
    if (setNo !== undefined) highest = Math.max(highest, Number(setNo));
  }
  return highest;
}

/**
 * Every slot the open exercise currently offers, in the order they are performed:
 * set by set, and within a set left then right for a `per_side` exercise
 * (UI-DECISIONS §6 — one ledger row per side, because differing between sides is the
 * entire reason the flag exists).
 *
 * `shownSets` is `visibleSetCount(...).shown` — a ranged prescription draws its minimum
 * until the user adds the optional set. A `type: rounds` block ignores it and offers
 * exactly the current round, which is what its `set_no` means.
 */
export function setSlotsFor(
  block: Pick<ResolvedBlock, "key" | "type">,
  exercise: Pick<ResolvedExercise, "slug" | "perSide">,
  opts: { shownSets: number; currentRound: number },
): SetSlot[] {
  const setNumbers =
    block.type === "rounds"
      ? [opts.currentRound]
      : Array.from({ length: Math.max(0, opts.shownSets) }, (_, i) => i + 1);
  const sides: readonly ("left" | "right" | undefined)[] = exercise.perSide
    ? ["left", "right"]
    : [undefined];

  return setNumbers.flatMap((setNo) =>
    sides.map((side) => ({
      setNo,
      side,
      key: setLogKey(block.key, exercise.slug, setNo, side),
    })),
  );
}

/**
 * The one set the log strip is about to write (UI-DECISIONS §2: the strip logs exactly
 * one set at a time), or `undefined` when every slot on offer is already logged.
 *
 * `logged` is anything that can answer "is this key logged" — the runner's client-side
 * map today, a set rebuilt from persisted `set_log` rows on resume.
 */
export function nextUnloggedSlot(
  slots: readonly SetSlot[],
  logged: { has(key: string): boolean },
): SetSlot | undefined {
  return slots.find((slot) => !logged.has(slot.key));
}

/**
 * The log strip's context line (UI-DECISIONS §2) — names exactly what the next tap
 * writes. A rounds block counts rounds, not sets, because that is what its `set_no` is.
 */
export function formatSlotContext(
  block: Pick<ResolvedBlock, "type" | "rounds">,
  slot: SetSlot,
  totalSets: number,
): string {
  const core =
    block.type === "rounds"
      ? `Round ${slot.setNo}${block.rounds === undefined ? "" : ` of ${block.rounds}`}`
      : `Set ${slot.setNo} of ${totalSets}`;
  return slot.side === undefined ? core : `${core} — ${slot.side}`;
}

/**
 * One figure of the rest overlay's up-next line — an icon-tagged number, so `RestTimer`
 * can pair each with its `FigureIcon` (UI-DECISIONS §4) instead of parsing a sentence
 * back apart the way a single formatted string would require.
 */
export type UpNextFigure = { kind: "reps" | "time" | "load"; text: string };

/** The rest overlay's up-next card, split the way `RestTimer` renders it: `context`
 * names where you are (`"Set 3 of 3"`, `"3 sets"`), `figures` names what to do. Both
 * `upNextSlotParts` and `upNextExerciseParts` return this shape so the overlay never has
 * to know which one fired. */
export type UpNextParts = { context: string; figures: readonly UpNextFigure[] };

/**
 * The reps/time and load figures for the rest overlay's up-next line, shared by
 * `upNextSlotParts` and `upNextExerciseParts` so the two shapes can never tag the same
 * number differently. The load figure is omitted entirely when there is none: a
 * bodyweight movement, or no matching history and no configured default. The reps/time
 * figure is omitted — never a throw — when the exercise carries no target of its own
 * type, the same substitute-across-a-type-boundary case `formatTargetOrSets` already
 * has to handle; a throw here would take the rest overlay down mid-session.
 *
 * The load says `"12 kg total"`, the same unit `LogStrip`'s own dial is labelled with,
 * for the same reason: `weight_kg` is always the total being lifted (UI-DECISIONS §3,
 * settled 2026-08-10), and this figure is the one the user reads on the way to the rack
 * — a bare `"12 kg"` beside a paired movement invites loading 12 kg per hand.
 */
function upNextFigures(
  exercise: Pick<ResolvedExercise, "type" | "reps" | "durationSec">,
  weightKg: number | undefined,
): UpNextFigure[] {
  const figures: UpNextFigure[] = [];
  if (hasTarget(exercise)) {
    const value = formatRepsOrDuration(exercise);
    // `formatRepsOrDuration` already appends "sec" for a timed exercise; reps carries no
    // unit of its own (the ledger's number column doesn't need one), so it is added here.
    figures.push(
      exercise.type === "time"
        ? { kind: "time", text: value }
        : { kind: "reps", text: `${value} reps` },
    );
  }
  if (weightKg !== undefined) {
    figures.push({ kind: "load", text: `${weightKg} kg total` });
  }
  return figures;
}

/**
 * The rest overlay's up-next card (UI-DECISIONS §4: "names what is coming next") for the
 * *same* exercise's next slot — `context: "Set 3 of 3"`, `figures: [8–12 reps, 12 kg]`.
 * Built out of `formatSlotContext` so the overlay can never describe the next slot
 * differently than the ledger row it will fill in.
 */
export function upNextSlotParts(
  block: Pick<ResolvedBlock, "type" | "rounds">,
  slot: SetSlot,
  totalSets: number,
  exercise: Pick<ResolvedExercise, "type" | "reps" | "durationSec">,
  weightKg?: number,
): UpNextParts {
  return {
    context: formatSlotContext(block, slot, totalSets),
    figures: upNextFigures(exercise, weightKg),
  };
}

/**
 * The set-number cell of a ledger row. A rounds block names the round, since its rows
 * are rounds; everything else is a set number with the side appended for `per_side`.
 */
export function formatSlotLabel(block: Pick<ResolvedBlock, "type">, slot: SetSlot): string {
  const core = block.type === "rounds" ? `Round ${slot.setNo}` : `${slot.setNo}`;
  return slot.side === undefined ? core : `${core} ${slot.side === "left" ? "L" : "R"}`;
}

/**
 * What a logged set actually was, for its read-only ledger row — `11 · 12 kg`,
 * `30 sec`, or `Logged` when the row carries no figures at all (a checkoff-style write,
 * or a set logged with the steppers cleared).
 */
export function formatLoggedSet(logged: LoggedSet): string {
  const parts: string[] = [];
  if (logged.durationS !== undefined) parts.push(`${logged.durationS} sec`);
  if (logged.reps !== undefined) parts.push(`${logged.reps}`);
  if (logged.weightKg !== undefined) parts.push(`${logged.weightKg} kg`);
  return parts.length > 0 ? parts.join(" · ") : "Logged";
}

/**
 * Renders an `IntOrRange` for display: a fixed value as-is, a `[min, max]` pair as
 * `min–max` (en dash, U+2013 — not a hyphen, and never the raw `min,max` you get from
 * interpolating a tuple directly). An optional unit is appended after the number(s),
 * e.g. `formatRange([20, 40], "sec")` → `"20–40 sec"`.
 */
export function formatRange(value: IntOrRange, unit?: string): string {
  const core = typeof value === "number" ? `${value}` : `${value[0]}–${value[1]}`;
  return unit ? `${core} ${unit}` : core;
}

/**
 * The type-appropriate reps/duration value for an exercise — `reps` for type `reps`,
 * `durationSec` for type `time` — formatted with `formatRange` (duration gets a `sec`
 * unit suffix, reps doesn't). CONTRACT (schema.ts:525-553): a type `reps` exercise
 * always has `reps` set and a type `time` exercise always has `durationSec` set — the
 * contract validator rejects any document where that's not true, same precedent as
 * `resolveExercise`'s catalogue-lookup guard above — so this throws rather than
 * silently falling back, on the same "unreachable in practice, fail loud if it ever
 * isn't" basis. Shared by every call site that needs this value, so they can't drift
 * into inconsistent error handling for the same invariant.
 */
export function formatRepsOrDuration(
  exercise: Pick<ResolvedExercise, "type" | "reps" | "durationSec">,
): string {
  const targetValue = exercise.type === "time" ? exercise.durationSec : exercise.reps;
  if (targetValue === undefined) {
    throw new Error(
      `formatRepsOrDuration: a type \`${exercise.type}\` exercise must have its ` +
        `${exercise.type === "time" ? "duration_sec" : "reps"} set — the contract ` +
        `validator should already have rejected this document`,
    );
  }
  return formatRange(targetValue, exercise.type === "time" ? "sec" : undefined);
}

/**
 * The full prescription target line shown wherever an exercise's set/rep (or
 * set/duration) target is displayed — `3 × 8–12`, `2 × 20–40 sec per side`,
 * `2–3 × 10–15`.
 */
export function formatTarget(
  exercise: Pick<ResolvedExercise, "type" | "sets" | "reps" | "durationSec" | "perSide">,
): string {
  const line = `${formatRange(exercise.sets)} × ${formatRepsOrDuration(exercise)}`;
  return exercise.perSide ? `${line} per side` : line;
}

/**
 * True when the exercise carries the target its own `type` requires. Always true for a
 * prescribed exercise — the contract validator enforces it — and false only for a
 * substitute resolved across a `type` boundary (`resolveSubstitute`), where the plan
 * never stated a target for the movement on this occasion.
 */
function hasTarget(exercise: Pick<ResolvedExercise, "type" | "reps" | "durationSec">): boolean {
  return (exercise.type === "time" ? exercise.durationSec : exercise.reps) !== undefined;
}

/** The sets count alone — `"2 sets"`, `"1 set"`, `"2–3 sets per side"` — the fallback
 * half of `formatTargetOrSets` and the whole of `upNextExerciseParts`'s context line,
 * pulled out so neither has to restate the pluralisation/per-side rule. */
function formatSetsCount(exercise: Pick<ResolvedExercise, "sets" | "perSide">): string {
  const core = exercise.sets === 1 ? "1 set" : `${formatRange(exercise.sets)} sets`;
  return exercise.perSide ? `${core} per side` : core;
}

/**
 * `formatTarget` for any exercise the runner might be *rendering*, prescribed or
 * substituted. Falls back to the sets count alone (`2 sets`) when the substitute carries
 * no target of its own type, rather than throwing the way the prescribed-exercise path
 * deliberately does.
 */
export function formatTargetOrSets(
  exercise: Pick<ResolvedExercise, "type" | "sets" | "reps" | "durationSec" | "perSide">,
): string {
  return hasTarget(exercise) ? formatTarget(exercise) : formatSetsCount(exercise);
}

/**
 * The rest overlay's up-next card for the *next* exercise, once the current one is
 * finished — `context: "3 sets"`, `figures: [8–12 reps, 8 kg]`. The whole prescription
 * rather than one slot, because nothing of this movement has been logged yet and the
 * sets count is the useful figure; the figures come from the same `upNextFigures`
 * helper `upNextSlotParts` uses, so crossing from one exercise to the next can never tag
 * a number differently than the slot it lands on.
 *
 * `formatSetsCount`, not `formatTarget`: the exercise here is the *performed* one, so it
 * can be a substitute resolved across a `type` boundary with no target of its own —
 * which `formatTarget` throws on, and a throw inside the rest overlay would take the
 * whole session down. Its reps/time figure is dropped by `upNextFigures` the same way.
 */
export function upNextExerciseParts(
  exercise: Pick<ResolvedExercise, "type" | "sets" | "reps" | "durationSec" | "perSide">,
  weightKg?: number,
): UpNextParts {
  return {
    context: formatSetsCount(exercise),
    figures: upNextFigures(exercise, weightKg),
  };
}

/** `formatRepsOrDuration` for the same "prescribed or substituted" case — an em dash
 * where a substitute has no target of its own type, never a fabricated `0`. */
export function formatRepsOrDurationOrDash(
  exercise: Pick<ResolvedExercise, "type" | "reps" | "durationSec">,
): string {
  return hasTarget(exercise) ? formatRepsOrDuration(exercise) : "—";
}

/**
 * UI-DECISIONS §1: a finished exercise collapses to what it actually was —
 * `11 · 10 · 10 at 6 kg`. One figure per logged set in performed order, then the load,
 * collapsed to a single value when every set shared one and to a range when they did not
 * (dropping the weight mid-exercise is exactly the thing worth seeing from the collapsed
 * row). Sets that carry no figures at all — a checkoff-style write, or every stepper
 * cleared — summarise as `Logged`, matching `formatLoggedSet`'s own floor.
 */
export function summariseLoggedSets(sets: readonly LoggedSet[]): string {
  if (sets.length === 0) return "Nothing logged";

  const figures = sets.map((set) =>
    set.durationS !== undefined ? `${set.durationS} sec` : (set.reps?.toString() ?? "—"),
  );
  const core = figures.every((figure) => figure === "—") ? "Logged" : figures.join(" · ");

  const weights = sets
    .map((set) => set.weightKg)
    .filter((weight): weight is number => weight !== undefined);
  if (weights.length === 0) return core;

  const min = Math.min(...weights);
  const max = Math.max(...weights);
  return `${core} at ${min === max ? `${min}` : `${min}–${max}`} kg`;
}

/**
 * Every exercise of a session that can be opened and logged, in prescribed order, as
 * `${block.key}:${slug}` keys — the same identity every keyed map in the runner uses.
 * Checkoff blocks are excluded: they have no set rows and nothing to open
 * (UI-DECISIONS §9).
 */
export function trackedExerciseKeys(session: Pick<ResolvedSession, "blocks">): string[] {
  return session.blocks
    .filter((block) => block.tracking !== "checkoff")
    .flatMap((block) => block.exercises.map((exercise) => `${block.key}:${exercise.slug}`));
}

/**
 * The exercise the runner should open next (UI-DECISIONS §1: the default path is not
 * "hunt for the next row one-handed"). Searches forward from `currentKey` in prescribed
 * order, then wraps to the start so an exercise left unfinished earlier — done out of
 * order, or skipped and then un-skipped — is picked up rather than stranded. `undefined`
 * when nothing is left, which is the runner's cue to leave the current exercise open
 * showing its finished state.
 *
 * `done` is anything that can answer "is this exercise finished": the runner's derived
 * set of keys whose every offered slot is logged, plus the skipped ones.
 */
export function nextExerciseKey(
  session: Pick<ResolvedSession, "blocks">,
  done: { has(key: string): boolean },
  currentKey?: string,
): string | undefined {
  const keys = trackedExerciseKeys(session);
  const after = currentKey === undefined ? 0 : keys.indexOf(currentKey) + 1;
  return keys.slice(after).find((key) => !done.has(key)) ?? keys.find((key) => !done.has(key));
}
