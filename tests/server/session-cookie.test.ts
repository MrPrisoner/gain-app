/**
 * The session cookie: an opaque id signed with HMAC-SHA256. A forged or
 * truncated value must never reach the database lookup (ARCHITECTURE §4).
 */

import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE,
  signSessionId,
  verifySessionCookie,
} from "../../src/lib/server/session-cookie";

const SECRET = "test-secret";
const OTHER_SECRET = "another-secret";
const SID = "a".repeat(64);

describe("session cookie", () => {
  it("has a stable cookie name", () => {
    expect(SESSION_COOKIE).toBe("gain_session");
  });

  it("round-trips a signed session id", () => {
    const cookie = signSessionId(SECRET, SID);
    expect(cookie).not.toBe(SID); // the signature is appended
    expect(verifySessionCookie(SECRET, cookie)).toBe(SID);
  });

  it("rejects a tampered session id", () => {
    const cookie = signSessionId(SECRET, SID);
    const tampered = `b${cookie.slice(1)}`;
    expect(verifySessionCookie(SECRET, tampered)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const cookie = signSessionId(SECRET, SID);
    const dot = cookie.lastIndexOf(".");
    const sid = cookie.slice(0, dot);
    const mac = cookie.slice(dot + 1);
    const flipped = mac.startsWith("0") ? `1${mac.slice(1)}` : `0${mac.slice(1)}`;
    expect(verifySessionCookie(SECRET, `${sid}.${flipped}`)).toBeNull();
  });

  it("rejects a cookie signed with a different secret", () => {
    const cookie = signSessionId(OTHER_SECRET, SID);
    expect(verifySessionCookie(SECRET, cookie)).toBeNull();
  });

  it("rejects malformed cookies", () => {
    expect(verifySessionCookie(SECRET, "")).toBeNull();
    expect(verifySessionCookie(SECRET, "no-dot")).toBeNull();
    expect(verifySessionCookie(SECRET, ".only-mac")).toBeNull();
    expect(verifySessionCookie(SECRET, "only-sid.")).toBeNull();
  });

  it("produces distinct signatures per session id", () => {
    const a = signSessionId(SECRET, "a".repeat(64));
    const b = signSessionId(SECRET, "b".repeat(64));
    expect(a).not.toBe(b);
  });
});
