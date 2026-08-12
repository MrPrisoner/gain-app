/**
 * The export window picker's options (ARCHITECTURE §11). Pure, clock injected.
 */

import { describe, expect, it } from "vitest";
import {
  exportWindowOptions,
  resolveExportWindow,
  type ExportWindowContext,
} from "../src/lib/export/windows";

const NOW = new Date("2026-08-12T10:00:00Z");

const CONTEXT: ExportWindowContext = {
  versionNo: 2,
  importedAt: "2026-07-14T09:30:00Z",
  blockLengthWeeks: 4,
  now: NOW,
};

describe("exportWindowOptions", () => {
  it("offers three windows, the current version's first", () => {
    const options = exportWindowOptions(CONTEXT);
    expect(options.map((o) => o.id)).toEqual(["since_version", "recent_blocks", "full"]);
  });

  it("starts the default window at the current version's import", () => {
    const [since] = exportWindowOptions(CONTEXT);
    expect(since?.start).toBe("2026-07-14T09:30:00Z");
    expect(since?.end).toBeUndefined();
  });

  it("labels the default window with the version and its import date", () => {
    const [since] = exportWindowOptions(CONTEXT);
    expect(since?.label).toBe("since v2 (imported 2026-07-14)");
  });

  it("derives the middle window from the plan's own block length, two blocks back", () => {
    const recent = exportWindowOptions(CONTEXT).find((o) => o.id === "recent_blocks");
    expect(recent?.label).toBe("last 8 weeks (2 blocks)");
    // 8 weeks before NOW.
    expect(recent?.start).toBe("2026-06-17T10:00:00.000Z");
  });

  it("scales the middle window with the declared block length", () => {
    const recent = exportWindowOptions({ ...CONTEXT, blockLengthWeeks: 12 }).find(
      (o) => o.id === "recent_blocks",
    );
    expect(recent?.label).toBe("last 24 weeks (2 blocks)");
  });

  it("omits the middle window when the plan declares no block length", () => {
    const options = exportWindowOptions({ ...CONTEXT, blockLengthWeeks: null });
    expect(options.map((o) => o.id)).toEqual(["since_version", "full"]);
  });

  it("omits the middle window for a nonsensical block length rather than inventing one", () => {
    for (const blockLengthWeeks of [0, -4, 2.5]) {
      const options = exportWindowOptions({ ...CONTEXT, blockLengthWeeks });
      expect(
        options.map((o) => o.id),
        `block_length_weeks = ${blockLengthWeeks}`,
      ).toEqual(["since_version", "full"]);
    }
  });

  it("bounds full history at neither end", () => {
    const full = exportWindowOptions(CONTEXT).find((o) => o.id === "full");
    expect(full?.start).toBeUndefined();
    expect(full?.end).toBeUndefined();
    expect(full?.label).toBe("full history");
  });
});

describe("resolveExportWindow", () => {
  it("resolves an offered id", () => {
    expect(resolveExportWindow("full", CONTEXT)?.label).toBe("full history");
  });

  it("returns undefined for an unknown id rather than defaulting", () => {
    expect(resolveExportWindow("last_year", CONTEXT)).toBeUndefined();
    expect(resolveExportWindow("", CONTEXT)).toBeUndefined();
  });

  it("returns undefined for a window this plan does not offer", () => {
    expect(
      resolveExportWindow("recent_blocks", { ...CONTEXT, blockLengthWeeks: null }),
    ).toBeUndefined();
  });
});
