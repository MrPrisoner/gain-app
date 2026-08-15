/**
 * The export window picker's options (ARCHITECTURE §11, "windowed by default").
 *
 * A year of raw sets blows past a usable context window and buries the recent
 * signal in old noise, so the user chooses a span. Three of them:
 *
 *   since_version   everything logged against the plan as it stands now
 *   recent_blocks   twice the plan's own declared block length
 *   full            everything
 *
 * `since_version` is the default because it is the span the reviewing AI has not
 * seen yet: a user revising on cadence imports a new version each block, so it
 * tracks their loop without GAIN having to guess at one.
 *
 * `recent_blocks` is derived from `plan.block_length_weeks` rather than a constant,
 * because the plan declares the user's feedback loop and a four-week block and a
 * twelve-week block want different windows. When the plan declares no block length
 * — it is optional in the contract — the option is **absent** rather than falling
 * back to some invented number of weeks: offering "last 8 weeks" for a plan that
 * never mentioned weeks is a guess wearing the costume of a setting.
 *
 * Pure, with the clock injected, like everything else under `src/lib/export/`.
 */

import type { ExportWindow } from "./bundle";
import { isoDate } from "./summary";

export type ExportWindowId = "since_version" | "recent_blocks" | "full";

export type ExportWindowOption = ExportWindow & {
  id: ExportWindowId;
};

export type ExportWindowContext = {
  /** `version_no` of the version currently marked `is_current`. */
  versionNo: number;
  /** That version's `imported_at`, ISO 8601. */
  importedAt: string;
  /** `plan.block_length_weeks`; null when the plan does not declare one. */
  blockLengthWeeks: number | null;
  /** Injected clock. */
  now: Date;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** How many blocks back `recent_blocks` reaches. See the module comment. */
const RECENT_BLOCK_COUNT = 2;

/**
 * The options to offer, in picker order. The first is the default.
 *
 * Every `label` is prose the reviewing AI reads — it lands in the bundle's H1 and in
 * `{{export_window}}` — so it says which span it is rather than naming a UI control.
 * "since v2 (imported 2026-07-14)" tells the AI what it has already seen; "current
 * block" tells it nothing it can act on.
 */
export function exportWindowOptions(context: ExportWindowContext): ExportWindowOption[] {
  const options: ExportWindowOption[] = [
    {
      id: "since_version",
      label: `since v${context.versionNo} (imported ${isoDate(new Date(context.importedAt))})`,
      start: context.importedAt,
    },
  ];

  const weeks = recentBlocksWeeks(context.blockLengthWeeks);
  if (weeks !== null) {
    options.push({
      id: "recent_blocks",
      label: `last ${weeks} weeks (${RECENT_BLOCK_COUNT} blocks)`,
      start: new Date(context.now.getTime() - weeks * WEEK_MS).toISOString(),
    });
  }

  options.push({ id: "full", label: "full history" });

  return options;
}

/**
 * The option a submitted picker value names, or undefined when it names none.
 *
 * Undefined is the caller's cue to `fail(400)` rather than to substitute a default:
 * a form action must never throw (CLAUDE.md, phase-4 review), and silently exporting
 * a different span than the one asked for mislabels the bundle the AI then reads.
 */
export function resolveExportWindow(
  id: string,
  context: ExportWindowContext,
): ExportWindowOption | undefined {
  return exportWindowOptions(context).find((option) => option.id === id);
}

/**
 * Null when the plan declares no usable block length, which is what removes the
 * option entirely. A non-integer or non-positive value is treated the same way —
 * the contract constrains it, but this module is fed from a nullable DB column
 * rather than from a validated contract.
 */
function recentBlocksWeeks(blockLengthWeeks: number | null): number | null {
  if (blockLengthWeeks === null) return null;
  if (!Number.isInteger(blockLengthWeeks) || blockLengthWeeks < 1) return null;
  return blockLengthWeeks * RECENT_BLOCK_COUNT;
}
