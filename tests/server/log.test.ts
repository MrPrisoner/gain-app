/**
 * `src/lib/server/log.ts`'s request and unhandled-error lines (review 2026-08-27, E6) —
 * asserted on the actual `console.log`/`console.error` call, since the whole point of
 * these two functions is what ends up in `docker logs`.
 *
 * Spies are captured into variables rather than referenced as `console.log` inline:
 * `no-console` flags that member expression wherever it appears, call or not.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logRequest, logUnhandledError } from "../../src/lib/server/log";

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logRequest", () => {
  it("logs method, path, status, duration and the resolved user", () => {
    logRequest({
      method: "POST",
      path: "/api/sync",
      status: 200,
      durationMs: 42,
      userId: "01KZKQ4GB22EEQBF20YDKD1BYE",
    });

    expect(logSpy).toHaveBeenCalledWith(
      "[gain] POST /api/sync 200 42ms user=01KZKQ4GB22EEQBF20YDKD1BYE",
    );
  });

  it("marks an anonymous request rather than an empty user field", () => {
    logRequest({ method: "GET", path: "/login", status: 303, durationMs: 1, userId: null });

    expect(logSpy).toHaveBeenCalledWith("[gain] GET /login 303 1ms user=-");
  });
});

describe("logUnhandledError", () => {
  it("names the error id, the request and the user, and logs the cause separately", () => {
    const cause = new Error("boom");
    logUnhandledError(
      { errorId: "err-123", method: "GET", path: "/plan/home-training", userId: "alice" },
      cause,
    );

    expect(errorSpy).toHaveBeenCalledWith(
      "[gain] unhandled error id=err-123 GET /plan/home-training user=alice",
      cause,
    );
  });

  it("marks an anonymous request the same way logRequest does", () => {
    logUnhandledError({ errorId: "err-456", method: "GET", path: "/", userId: null }, "boom");

    expect(errorSpy).toHaveBeenCalledWith("[gain] unhandled error id=err-456 GET / user=-", "boom");
  });
});
