import { describe, expect, it } from "vitest";
import {
  isNavigationRequest,
  isPublicPath,
  loginUrlFor,
  refusal,
  safeReturnTo,
  seeOther,
} from "../../src/lib/server/gate";

function req(method: string, headers: Record<string, string>): Request {
  return new Request("https://gain.example.com/", { method, headers });
}

describe("public paths", () => {
  it("lets the health endpoint and the login round trip through", () => {
    expect(isPublicPath("/healthz")).toBe(true);
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
  });

  it("lets the offline fallback page through, unauthenticated (phase 6)", () => {
    // The service worker's install-time `cache.addAll` precaches this page on every page
    // load, including `/login` before a session exists — a 401 there would fail the whole
    // precache, app shell included, for anyone whose first visit is the login page.
    expect(isPublicPath("/offline")).toBe(true);
  });

  it("gates everything else, including paths that merely start alike", () => {
    for (const path of [
      "/",
      "/plans",
      "/healthzz",
      "/logina",
      "/authorise",
      "/logout",
      "/offlinex",
    ]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });
});

describe("navigation detection", () => {
  it("trusts Sec-Fetch-Mode where the browser sends it", () => {
    expect(isNavigationRequest(req("GET", { "sec-fetch-mode": "navigate" }))).toBe(true);
    expect(isNavigationRequest(req("POST", { "sec-fetch-mode": "navigate" }))).toBe(true);
    expect(isNavigationRequest(req("POST", { "sec-fetch-mode": "cors" }))).toBe(false);
    expect(isNavigationRequest(req("GET", { "sec-fetch-mode": "cors" }))).toBe(false);
  });

  it("falls back to method plus Accept when the header is absent", () => {
    expect(isNavigationRequest(req("GET", { accept: "text/html,*/*" }))).toBe(true);
    expect(isNavigationRequest(req("GET", { accept: "application/json" }))).toBe(false);
    expect(isNavigationRequest(req("POST", { accept: "text/html" }))).toBe(false);
  });

  it("treats a bare request as non-navigation, so it gets a 401 not a redirect", () => {
    expect(isNavigationRequest(req("POST", {}))).toBe(false);
  });
});

describe("return_to", () => {
  it("keeps a same-origin path", () => {
    expect(safeReturnTo("/plans/home-training")).toBe("/plans/home-training");
    expect(safeReturnTo("/?tab=history")).toBe("/?tab=history");
  });

  it("refuses anything that could leave the origin", () => {
    // `//evil.example` and `/\evil.example` are protocol-relative: a browser
    // resolves both to another host, which would make login an open redirect.
    for (const hostile of [
      "//evil.example/",
      "/\\evil.example/",
      "https://evil.example/",
      "javascript:alert(1)",
      "evil.example",
      "",
      null,
      undefined,
    ]) {
      expect(safeReturnTo(hostile), String(hostile)).toBe("/");
    }
  });
});

describe("login URL", () => {
  it("carries where the request was headed", () => {
    expect(loginUrlFor("/plans", "?v=2")).toBe("/login?return_to=%2Fplans%3Fv%3D2");
  });

  it("stays bare when the destination is the root", () => {
    expect(loginUrlFor("/", "")).toBe("/login");
  });

  it("drops a destination it would refuse to honour anyway", () => {
    expect(loginUrlFor("//evil.example", "")).toBe("/login");
  });
});

/**
 * The gate builds its own refusals rather than throwing them, so that `handle` can stamp
 * the security headers on the way out (`tests/server/hooks-headers.test.ts`). That means
 * the gate now owns a response body, which means it owns escaping it.
 */
describe("refusal", () => {
  it("answers a fetch with JSON, which is what the sync client can read", async () => {
    const response = refusal(401, "Your session has expired.", false);
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ message: "Your session has expired." });
  });

  it("answers a navigation with a readable page", async () => {
    const response = refusal(403, "You are not in the required group.", true);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("You are not in the required group.");
  });

  it("escapes the message, which carries a group name straight from configuration", async () => {
    const response = refusal(403, 'no <script>alert("x")</script> for you', true);
    const body = await response.text();
    expect(body).not.toContain("<script>");
    expect(body).toContain("&lt;script&gt;");
  });
});

describe("seeOther", () => {
  it("redirects without a body, so nothing needs escaping", () => {
    const response = seeOther("/login?returnTo=%2Fplan");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?returnTo=%2Fplan");
  });
});
