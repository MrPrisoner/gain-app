/**
 * Everything the export route's action does apart from talking to SvelteKit: resolve the
 * window, assemble the bundle, archive a copy. It sits beside the route rather than inside
 * `+page.server.ts` so it is directly unit-testable — the same split phase 4 used to keep
 * the session runner's logic in `$lib` and the route thin.
 *
 * Returns a result rather than throwing, because its one caller is a form action and a
 * thrown `Error` there is a 500 that renders `+error.svelte` (AGENTS.md, phase-4 review).
 */

import fs from "node:fs";
import path from "node:path";
import { contractMd, defaultInstructionsTemplate } from "$lib/server/assets";
import { logsForPlan } from "$lib/db/logs";
import {
  contractOfVersion,
  getCurrentVersion,
  getDefaultTemplate,
  readSourceMd,
  type PlanRow,
} from "$lib/db/read";
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
      instructions_template: getDefaultTemplate(userDb) ?? defaultInstructionsTemplate,
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

  archive(userDb, plan, version.version_no, now, bundle);

  return {
    ok: true,
    bundle,
    // The download name is stable and clean; the archived name is unique. Both are built
    // from a validated slug and an integer, so neither can escape the user directory.
    filename: `gain-export-${plan.slug}-v${version.version_no}.md`,
    windowLabel: window.label,
  };
}

/**
 * Keep a copy under `users/<id>/exports/` (ARCHITECTURE §3's data layout), so a user who
 * loses the paste can find it again. Best-effort by design: failing the export the user is
 * about to paste because an archive write failed would break the crossing to save a
 * convenience.
 */
function archive(
  userDb: UserDb,
  plan: PlanRow,
  versionNo: number,
  now: Date,
  bundle: string,
): void {
  try {
    const stamp = `${now.toISOString().slice(0, 19).replaceAll(":", "")}Z`;
    const dir = path.join(userDb.userDir, "exports");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `gain-export-${plan.slug}-v${versionNo}-${stamp}.md`),
      bundle,
      "utf8",
    );
  } catch {
    // Deliberately swallowed — see the comment above.
  }
}
