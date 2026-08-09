/**
 * The session cookie (ARCHITECTURE §4): an opaque session id, signed with
 * HMAC-SHA256 so a forged or truncated value never reaches the database
 * lookup. No JWT in the cookie — the session record lives in `control.db`.
 */

import crypto from "node:crypto";

export const SESSION_COOKIE = "gain_session";

function mac(secret: string, sessionId: string): string {
  return crypto.createHmac("sha256", secret).update(sessionId).digest("hex");
}

/** Cookie value: `<sessionId>.<hmac-hex>`. */
export function signSessionId(secret: string, sessionId: string): string {
  return `${sessionId}.${mac(secret, sessionId)}`;
}

/** Returns the session id when the signature verifies, otherwise null. */
export function verifySessionCookie(secret: string, cookieValue: string): string | null {
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0 || dot === cookieValue.length - 1) return null;
  const sessionId = cookieValue.slice(0, dot);
  const provided = cookieValue.slice(dot + 1);
  const expected = mac(secret, sessionId);

  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;
  return sessionId;
}
