import { describe, expect, it } from "vitest";
import {
  isNavigationRequest,
  isPublicPath,
  loginUrlFor,
  safeReturnTo,
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
    expect(safeReturnTo("/plans/home-dumbbell")).toBe("/plans/home-dumbbell");
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
