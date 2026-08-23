/**
 * The version-browsing routes (ROADMAP, "Loose ends"; ARCHITECTURE §8).
 *
 * Two things are worth a test rather than a read-through. The document must come back
 * byte-identical — this route is the plainest statement of the never-paraphrase
 * guarantee, and a helpful `.trim()` anywhere in it would be a silent breach. And
 * `readSourceMd` is a bare `readFileSync` on a path stored in the row, so a version
 * whose file has gone missing has to render an explanation rather than take the page
 * down with a 500: the row is still good, only the file is gone.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isHttpError } from "@sveltejs/kit";
import { load as listLoad } from "../../src/routes/plan/[slug]/versions/+page.server";
import { load as detailLoad } from "../../src/routes/plan/[slug]/versions/[n]/+page.server";
import { archivePlan } from "../../src/lib/db/archive";
import { importPlan } from "../../src/lib/db/import-plan";
import { getPlanBySlug, listVersions } from "../../src/lib/db/read";
import { openUserDb } from "../../src/lib/db/user-db";
import { parsePlanDocument } from "../../src/lib/parse/parser";
import { openControlDb, createUser, type ControlUser } from "../../src/lib/server/control-db";
import { resetAppStateForTests, getUserDbFor } from "../../src/lib/server/app-state";
import { resetConfigForTests } from "../../src/lib/server/config";

const v1Md = fs.readFileSync("fixtures/plans/home-training-v1.md", "utf8");
const v2Md = fs.readFileSync("fixtures/plans/home-training-v2.md", "utf8");
const NOW = new Date("2026-09-08T08:00:00Z");
const LATER = new Date("2026-10-06T08:00:00Z");

let dataDir: string;
let user: ControlUser;

function event(slug: string, n?: string) {
  return {
    params: { slug, ...(n === undefined ? {} : { n }) },
    locals: { user: { id: user.id, isAdmin: false, bypass: true, displayName: null } },
  } as never;
}

/** Both loads throw synchronously; unwrap rather than let the rejection escape. */
function expectNotFound(run: () => unknown): void {
  try {
    run();
  } catch (err) {
    expect(isHttpError(err) && err.status === 404).toBe(true);
    return;
  }
  throw new Error("expected a 404, but the call returned normally");
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-versions-route-"));
  process.env.DATA_DIR = dataDir;
  process.env.GAIN_DEV_USER = "tester";
  resetConfigForTests();
  resetAppStateForTests();

  const control = openControlDb(dataDir, NOW);
  user = createUser(control, "sub-tester", NOW);
  control.close();

  const userDb = openUserDb(dataDir, user.id, { now: NOW });
  for (const [source, now] of [
    [v1Md, NOW],
    [v2Md, LATER],
  ] as const) {
    const parsed = parsePlanDocument(source);
    if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.kind}`);
    const result = importPlan(userDb, { parsed, now });
    if (!result.ok) throw new Error(result.message);
  }
  userDb.close();
});

afterEach(() => {
  resetAppStateForTests();
  resetConfigForTests();
  delete process.env.DATA_DIR;
  delete process.env.GAIN_DEV_USER;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("the versions list", () => {
  it("lists newest first, marks the current one, and carries the AI's changelog", () => {
    const data = listLoad(event("home-training")) as {
      versions: { versionNo: number; isCurrent: boolean; changelog: string[] }[];
    };

    expect(data.versions.map((v) => v.versionNo)).toEqual([2, 1]);
    expect(data.versions[0]?.isCurrent).toBe(true);
    expect(data.versions[1]?.isCurrent).toBe(false);
    // The contract requires a non-empty changelog on every version above 1; v1 may
    // carry one too, and the reference fixture does — "First plan — nothing precedes
    // it." So both versions here have lines, and the empty case the page renders a
    // fallback for is the genuinely-absent one, not "this is v1".
    expect(data.versions[0]?.changelog.length).toBeGreaterThan(0);
    expect(data.versions[1]?.changelog[0]).toMatch(/^First plan/);
  });

  it("still lists for an archived plan", () => {
    archivePlan(getUserDbFor(user.id), "home-training", LATER);
    const data = listLoad(event("home-training")) as { planArchived: boolean };
    expect(data.planArchived).toBe(true);
  });

  it("404s an unknown plan", () => {
    expectNotFound(() => listLoad(event("no-such-plan")));
  });
});

describe("one version's document", () => {
  it("returns the imported document byte for byte", () => {
    const data = detailLoad(event("home-training", "1")) as { source: string; filename: string };
    expect(data.source).toBe(v1Md);
    expect(data.filename).toBe("home-training-v1.md");

    const current = detailLoad(event("home-training", "2")) as {
      source: string;
      isCurrent: boolean;
    };
    expect(current.source).toBe(v2Md);
    expect(current.isCurrent).toBe(true);
  });

  it("explains a document missing from disk instead of 500ing", () => {
    const userDb = getUserDbFor(user.id);
    const plan = getPlanBySlug(userDb, "home-training")!;
    const v1 = listVersions(userDb, plan.id).find((v) => v.version_no === 1)!;
    fs.rmSync(path.join(userDb.userDir, v1.source_path));

    const data = detailLoad(event("home-training", "1")) as {
      source: string | undefined;
      sourcePath: string;
    };
    expect(data.source).toBeUndefined();
    expect(data.sourcePath).toBe(v1.source_path);
  });

  it("404s a version that does not exist, and a version number that is not one", () => {
    expectNotFound(() => detailLoad(event("home-training", "9")));
    // `Number("2x")` is NaN, but a looser parse would take the leading 2 and serve
    // version 2 under a URL that never named it.
    expectNotFound(() => detailLoad(event("home-training", "2x")));
    expectNotFound(() => detailLoad(event("home-training", "-1")));
  });
});
