/**
 * The diff, arranged for a phone screen.
 *
 * `diffContracts` answers "what is different" in the contract's own vocabulary:
 * slugs, field names, and values typed `unknown`. This turns that into something
 * readable at arm's length — display names, formatted values, and one group per
 * kind of change — and derives the disposition every departed slug needs before
 * the import may be committed.
 *
 * Pure, like the engine it decorates. It is also the one place ranges are turned
 * into strings: a contract range is a tuple, and `[8, 12]` interpolates as `8,12`,
 * which is not a typo the reader would notice on a screen full of numbers.
 */

import type { GainContract, MetricScope } from "../contract/schema";
import { deriveExerciseName } from "../contract/schema";
import type { ContractDiff, FieldChange } from "./diff";

export type ChangeEntry = { headline: string; details: readonly string[] };
export type ChangeGroup = { key: string; title: string; entries: readonly ChangeEntry[] };
export type RenameOption = { slug: string; name: string };

export type Disposition = {
  slug: string;
  name: string;
  /** Pre-selected mapping target, when the engine found a convincing one. */
  suggested: string | null;
  /** Why it was suggested, in the engine's words. Null when nothing was suggested. */
  reason: string | null;
  /** Every added slug, so a rename the heuristics missed is still expressible. */
  options: readonly RenameOption[];
};

export type DiffPresentation = {
  planSlug: string;
  fromVersion: number;
  toVersion: number;
  blocking: readonly string[];
  warnings: readonly string[];
  changelog: readonly string[];
  dispositions: readonly Disposition[];
  groups: readonly ChangeGroup[];
};

const FIELD_LABELS: Readonly<Record<string, string>> = {
  sets: "Sets",
  reps: "Reps",
  duration_sec: "Duration",
  rest_sec: "Rest",
  load: "Load",
  note: "Note",
  conditional: "Conditional",
  condition: "Condition",
  substitutes: "Substitutes",
  name: "Name",
  type: "Type",
  per_side: "Per side",
  rounds: "Rounds",
  tracking: "Tracking",
  order: "Order",
  label: "Label",
  default_kg: "Default weight",
  is_bodyweight: "Bodyweight",
  min: "Minimum",
  max: "Maximum",
  options: "Options",
  optional: "Optional",
  prompt_when: "Asked",
};

/** A contract value as a reader should see it. Ranges are tuples — format, never interpolate. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every((v) => typeof v === "number")) {
      const [lo, hi] = value as [number, number];
      return lo === hi ? String(lo) : `${lo}–${hi}`;
    }
    return value.map((v) => formatValue(v)).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "string" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value) ?? "—";
}

function label(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/** "Reps 8–12 to 10–14" */
function describeChange(change: FieldChange): string {
  return `${label(change.field)}: ${formatValue(change.from)} to ${formatValue(change.to)}`;
}

function nameLookup(contract: GainContract): (slug: string) => string {
  const names = new Map(contract.exercises.map((e) => [e.id, e.name ?? deriveExerciseName(e.id)]));
  return (slug) => names.get(slug) ?? deriveExerciseName(slug);
}

function sessionNames(contract: GainContract): Map<string, string> {
  return new Map(contract.sessions.map((s) => [s.key, s.name]));
}

function blockName(contract: GainContract, sessionKey: string, blockKey: string): string {
  const block = contract.sessions
    .find((s) => s.key === sessionKey)
    ?.blocks.find((b) => b.key === blockKey);
  return block?.name ?? blockKey;
}

const SCOPE_LABELS: Readonly<Record<MetricScope, string>> = {
  set: "per set",
  exercise: "per exercise",
  session: "per session",
};

export function presentDiff(
  diff: ContractDiff,
  before: GainContract,
  after: GainContract,
): DiffPresentation {
  const nameBefore = nameLookup(before);
  const nameAfter = nameLookup(after);
  const sessionsAfter = sessionNames(after);
  const sessionsBefore = sessionNames(before);
  const sessionName = (key: string): string =>
    sessionsAfter.get(key) ?? sessionsBefore.get(key) ?? key;

  // -- Dispositions: one per departed slug, every added slug offered as a target.
  const options: RenameOption[] = diff.exercises.added
    .map((e) => ({ slug: e.id, name: nameAfter(e.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const dispositions: Disposition[] = diff.exercises.removed.map((removed) => {
    const candidate = diff.exercises.possible_renames.find((r) => r.from === removed.id);
    return {
      slug: removed.id,
      name: nameBefore(removed.id),
      suggested: candidate?.to ?? null,
      reason: candidate?.reason ?? null,
      options,
    };
  });

  // -- Warnings, rebuilt from structure. The engine's strings restate the
  //    dispositions above, and matching them by prefix to strip them would break
  //    the first time a message is reworded.
  const warnings: string[] = [];
  if (after.plan.based_on_version !== before.plan.version) {
    warnings.push(
      `This revision says it is based on version ${after.plan.based_on_version ?? "nothing"}, but the version it replaces is ${before.plan.version}.`,
    );
  }
  for (const id of diff.exercises.unreferenced) {
    warnings.push(`${nameAfter(id)} is in the catalogue but no session prescribes it.`);
  }
  for (const { scope, def } of diff.metrics.removed) {
    warnings.push(
      `The ${SCOPE_LABELS[scope]} metric "${def.label}" (${def.key}) is gone. Everything already logged against it stays, but nothing new will be.`,
    );
  }

  // -- Change groups. Empty ones are dropped rather than rendered as "0 changes".
  const groups: ChangeGroup[] = [];
  const add = (key: string, title: string, entries: ChangeEntry[]): void => {
    if (entries.length > 0) groups.push({ key, title, entries });
  };

  add("sessions", "Sessions", [
    ...diff.sessions.added.map((key) => ({ headline: sessionName(key), details: ["Added"] })),
    ...diff.sessions.removed.map((key) => ({ headline: sessionName(key), details: ["Removed"] })),
    ...diff.sessions.changed.map((c) => ({
      headline: sessionName(c.key),
      details: c.changes.map(describeChange),
    })),
  ]);

  add(
    "blocks",
    "Blocks",
    diff.sessions.blocks.flatMap((b) => [
      ...b.added.map((key) => ({
        headline: `${sessionName(b.session)} · ${blockName(after, b.session, key)}`,
        details: ["Added"],
      })),
      ...b.removed.map((key) => ({
        headline: `${sessionName(b.session)} · ${blockName(before, b.session, key)}`,
        details: ["Removed"],
      })),
      ...b.changed.map((c) => ({
        headline: `${sessionName(b.session)} · ${blockName(after, b.session, c.key)}`,
        details: c.changes.map(describeChange),
      })),
    ]),
  );

  add(
    "exercises-added",
    "Exercises added",
    diff.exercises.added.map((e) => ({
      headline: nameAfter(e.id),
      details: [e.note ?? `Added to the catalogue as ${e.id}.`],
    })),
  );

  add(
    "exercises-changed",
    "Exercises changed",
    diff.exercises.changed.map((c) => ({
      headline: nameAfter(c.id),
      details: c.changes.map(describeChange),
    })),
  );

  add(
    "targets",
    "Targets changed",
    diff.prescriptions.map((p) => ({
      headline: `${sessionName(p.session)} · ${blockName(after, p.session, p.block)} · ${nameAfter(p.id)}`,
      details:
        p.status === "changed"
          ? p.changes.map(describeChange)
          : [p.status === "added" ? "Added to this block" : "Removed from this block"],
    })),
  );

  add("metrics", "Metrics", [
    ...diff.metrics.added.map((m) => ({
      headline: `${m.def.label} (${SCOPE_LABELS[m.scope]})`,
      details: ["Added"],
    })),
    ...diff.metrics.removed.map((m) => ({
      headline: `${m.def.label} (${SCOPE_LABELS[m.scope]})`,
      details: ["Removed"],
    })),
    ...diff.metrics.changed.map((m) => ({
      headline: `${m.key} (${SCOPE_LABELS[m.scope]})`,
      details: m.changes.map(describeChange),
    })),
  ]);

  add("loads", "Loads", [
    ...diff.loads.added.map((l) => ({ headline: l.label, details: ["Added"] })),
    ...diff.loads.removed.map((l) => ({ headline: l.label, details: ["Removed"] })),
    ...diff.loads.changed.map((l) => ({ headline: l.ref, details: l.changes.map(describeChange) })),
  ]);

  const flags: ChangeEntry[] = [];
  if (diff.scheduling_changed) flags.push({ headline: "Scheduling", details: ["Changed"] });
  if (diff.progression_changed) flags.push({ headline: "Progression", details: ["Changed"] });
  if (diff.safety_changed) flags.push({ headline: "Safety rules", details: ["Changed"] });
  add("rules", "Plan rules", flags);

  return {
    planSlug: diff.after.slug,
    fromVersion: diff.before.version,
    toVersion: diff.after.version,
    blocking: diff.blocking,
    warnings,
    changelog: diff.plan.changelog,
    dispositions,
    groups,
  };
}
