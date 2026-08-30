/**
 * The security headers on the responses the gate produces itself (ARCHITECTURE §3).
 *
 * `withSecurityHeaders` wraps what `resolve` returns, so every rendered page and every
 * route response carries the four static headers and, where SvelteKit rendered no page of
 * its own, `FALLBACK_CSP`. A refusal produced by the gate never reaches that wrapper if
 * it is thrown: SvelteKit catches an `HttpError` or a `Redirect` out of `handle` and
 * builds the response itself, so the headers the app is careful to stamp on everything
 * else were absent from exactly the responses an unauthenticated caller sees.
 *
 * Driving `handle` is the only way to observe this. `hooks.server.ts` runs `startup()` at
 * module scope, so the environment has to be in place before the import — hence the
 * dynamic import below rather than a static one.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAppStateForTests } from "../../src/lib/server/app-state";
import { resetConfigForTests } from "../../src/lib/server/config";
import { SECURITY_HEADERS } from "../../src/lib/server/headers";

let tmpDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-hooks-test-"));
  process.env.DATA_DIR = tmpDir;
  process.env.ORIGIN = "https://gain.example.com";
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.OIDC_ISSUER = "https://auth.example.com";
  process.env.OIDC_CLIENT_ID = "gain";
  process.env.OIDC_CLIENT_SECRET = "secret";
  process.env.OIDC_REQUIRED_GROUP = "gain-users";
  delete process.env.GAIN_DEV_USER;
  resetConfigForTests();
  resetAppStateForTests();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  resetAppStateForTests();
  resetConfigForTests();
  for (const key of [
    "DATA_DIR",
    "ORIGIN",
    "SESSION_SECRET",
    "OIDC_ISSUER",
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET",
    "OIDC_REQUIRED_GROUP",
  ]) {
    delete process.env[key];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Drives the real `handle` with no session cookie, so the gate refuses. */
async function refuse(headers: Record<string, string>): Promise<Response> {
  const { handle } = await import("../../src/hooks.server");
  const url = new URL("https://gain.example.com/plan/home-training");
  return handle({
    event: {
      url,
      locals: {},
      request: new Request(url, { method: "GET", headers }),
      cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    },
    resolve: () => {
      throw new Error("the gate must refuse before resolving");
    },
  } as never);
}

function assertSecured(response: Response): void {
  for (const [name, value] of SECURITY_HEADERS) {
    expect(response.headers.get(name), `missing ${name}`).toBe(value);
  }
  expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
}

describe("the gate's own refusals", () => {
  it("carries the security headers on the 401 a fetch gets", async () => {
    const response = await refuse({ "sec-fetch-mode": "cors" });
    expect(response.status).toBe(401);
    assertSecured(response);
  });

  it("carries the security headers on the redirect a navigation gets", async () => {
    const response = await refuse({ "sec-fetch-mode": "navigate", accept: "text/html" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?return_to=%2Fplan%2Fhome-training");
    assertSecured(response);
  });
});

describe("request logging (review 2026-08-27, E6)", () => {
  it("logs one line per response, including a gate refusal that never reached resolve", async () => {
    await refuse({ "sec-fetch-mode": "cors" });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[gain] GET \/plan\/home-training 401 \d+ms user=-$/),
    );
  });
});

describe("handleError (review 2026-08-27, E6)", () => {
  it("logs the cause with an error id and returns that id to the client", async () => {
    const { handleError } = await import("../../src/hooks.server");
    const cause = new Error("something unhandled");
    const url = new URL("https://gain.example.com/plan/home-training");

    const result = await handleError({
      error: cause,
      event: {
        url,
        locals: { user: { id: "alice", bypass: false, displayName: null, isAdmin: false } },
        request: new Request(url, { method: "GET" }),
      },
      status: 500,
      message: "Internal Error",
    } as never);

    expect(result).toMatchObject({ message: "Internal Error" });
    const errorId = (result as { errorId: string }).errorId;
    expect(typeof errorId).toBe("string");
    expect(errorId.length).toBeGreaterThan(0);
    expect(errorSpy).toHaveBeenCalledWith(
      `[gain] unhandled error id=${errorId} GET /plan/home-training user=alice`,
      cause,
    );
  });
});
