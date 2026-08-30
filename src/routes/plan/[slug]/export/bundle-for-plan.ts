/**
 * Everything the export route's action does apart from talking to SvelteKit: resolve the
 * window and assemble the bundle. It sits beside the route rather than inside
 * `+page.server.ts` so it is directly unit-testable — the same split phase 4 used to keep
 * the session runner's logic in `$lib` and the route thin.
 *
 * Returns a result rather than throwing, because its one caller is a form action and a
 * thrown `Error` there is a 500 that renders `+error.svelte` (CLAUDE.md, phase-4 review).
 *
 * This used to also archive a copy of every generated bundle under `users/<id>/exports/`.
 * Dropped 2026-08-30 (review 2026-08-27, A6/C2): nothing ever read it back — no route
 * listed, opened or deleted an archived file, only `admin-stats.ts`'s `directorySize`
 * counting its bytes — and nothing on the export screen ever told the user it existed, so
 * it was write-only storage against a promise nobody made. The user already has two
 * copies of their own: the clipboard, and the download fallback when the clipboard API is
 * unavailable. A lost paste is regenerable from the same plan and window, same as before.
 */

import { contractMd, defaultInstructionsTemplate } from "$lib/server/assets";
import { logsForPlan } from "$lib/db/logs";
import { contractOfVersion, getCurrentVersion, readSourceMd, type PlanRow } from "$lib/db/read";
import type { UserDb } from "$lib/db/user-db";
import { generateExport } from "$lib/export/bundle";
import { resolveExportWindow, type ExportWindowContext } from "$lib/export/windows";

export type BuildExportResult =
  | { ok: true; bundle: string; filename: string; windowLabel: string }
  | { ok: false; status: number; message: string };

/** The picker's context for a plan, so `load` and the action agree on what is offered. */
export function windowContextFor(
  userDb: UserDb,
  plan: PlanRow,
  now: Date,
): ExportWindowContext | undefined {
  const version = getCurrentVersion(userDb, plan.id);
  if (!version) return undefined;
  return {
    versionNo: version.version_no,
    importedAt: version.imported_at,
    blockLengthWeeks: version.block_length_weeks,
    now,
  };
}

export function buildExportBundle(
  userDb: UserDb,
  plan: PlanRow,
  windowId: string,
  now: Date,
): BuildExportResult {
  const version = getCurrentVersion(userDb, plan.id);
  const context = windowContextFor(userDb, plan, now);
  if (!version || !context) {
    return { ok: false, status: 409, message: "That plan has no current version to export." };
  }

  const window = resolveExportWindow(windowId, context);
  if (!window) {
    return { ok: false, status: 400, message: "Choose a window to export." };
  }

  let bundle: string;
  try {
    bundle = generateExport({
      contract: contractOfVersion(version),
      // Section 1 is the document on disk, byte-for-byte — never reassembled from
      // context_md plus a block (ARCHITECTURE §11).
      source_md: readSourceMd(userDb, version),
      instructions_template: defaultInstructionsTemplate,
      contract_md: contractMd,
      // Unwindowed on purpose: generateExport filters internally, and weeksElapsed
      // reads the full set for {{weeks_elapsed}}.
      logs: logsForPlan(userDb, plan.id),
      window,
      now,
    });
  } catch {
    // readSourceMd hits the filesystem and a malformed contract_json would throw here
    // too. Either way the user gets a message, not a 500 that wipes the page.
    return {
      ok: false,
      status: 500,
      message: "GAIN could not assemble the bundle. The plan's source document may be missing.",
    };
  }

  return {
    ok: true,
    bundle,
    // Built from a validated slug and an integer, so it cannot escape the user directory.
    filename: `gain-export-${plan.slug}-v${version.version_no}.md`,
    windowLabel: window.label,
  };
}
