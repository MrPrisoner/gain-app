/**
 * `/healthz` (ARCHITECTURE §3) — deliberately outside the auth gate, so anyone who can
 * reach the container can read whatever it says.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../src/routes/healthz/+server";
import { resetAppStateForTests } from "../../src/lib/server/app-state";
import { resetConfigForTests } from "../../src/lib/server/config";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-healthz-test-"));
  process.env.DATA_DIR = tmpDir;
  process.env.GAIN_DEV_USER = "tester";
  resetConfigForTests();
  resetAppStateForTests();
});

afterEach(() => {
  resetAppStateForTests();
  resetConfigForTests();
  delete process.env.DATA_DIR;
  delete process.env.GAIN_DEV_USER;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("GET /healthz", () => {
  it("answers 200 when the data directory is writable", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers 503 without telling an anonymous caller where the data lives", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A data directory that is not there is the cheapest real storage fault, and its
    // error message carries the absolute path.
    process.env.DATA_DIR = path.join(tmpDir, "gone");
    resetConfigForTests();
    resetAppStateForTests();

    const response = GET();
    expect(response.status).toBe(503);

    // Both consumers — the Docker HEALTHCHECK and Portainer — read `r.ok` and nothing
    // else, so the body has no reason to carry filesystem layout, errno strings or
    // anything else that helps someone probing an unauthenticated endpoint.
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain(tmpDir);
    expect(body).not.toContain("ENOENT");
  });

  it("logs the real cause server-side, where the operator can see it", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.DATA_DIR = path.join(tmpDir, "gone");
    resetConfigForTests();
    resetAppStateForTests();

    GET();

    expect(errors).toHaveBeenCalled();
    expect(JSON.stringify(errors.mock.calls)).toContain("gone");
  });
});
