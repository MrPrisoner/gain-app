/**
 * Session resolution (ARCHITECTURE §4): the sliding expiry, the token refresh,
 * and the group gate that is re-checked on every refresh rather than only at
 * login.
 *
 * Everything runs against an injected `AuthDeps` — a real on-disk `control.db`
 * in a temp directory, a stub token endpoint, and real RS256 ID tokens signed
 * with a throwaway key. No live IdP, no SvelteKit request.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from "jose";
import type { Cookies } from "@sveltejs/kit";
import {
  checkSession,
  forbiddenMessage,
  type AuthDeps,
  type SessionCheck,
} from "../../src/lib/server/auth";
import {
  createSession,
  createUser,
  getSession,
  openControlDb,
  type ControlDb,
} from "../../src/lib/server/control-db";
import { SESSION_COOKIE, signSessionId } from "../../src/lib/server/session-cookie";
import type { GainConfig, OidcConfig } from "../../src/lib/server/config";
import type { FetchImpl, OidcEndpoints } from "../../src/lib/server/oidc";

const ISSUER = "https://auth.example.com/application/o/gain/";
const CLIENT_ID = "gain";
const REQUIRED_GROUP = "gain-users";
const SECRET = "test-session-secret";
const IDLE_MS = 7 * 24 * 60 * 60 * 1000;

const NOW = new Date("2026-09-08T08:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

const ENDPOINTS: OidcEndpoints = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}authorization/`,
  token_endpoint: `${ISSUER}token/`,
  jwks_uri: `${ISSUER}jwks/`,
  end_session_endpoint: `${ISSUER}end-session/`,
  userinfo_endpoint: `${ISSUER}userinfo/`,
};

let privateKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = await exportJWK(pair.publicKey);
});

async function idToken(claims: Record<string, unknown>, issuedAt: Date = NOW): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setIssuedAt(Math.floor(issuedAt.getTime() / 1000))
    .setExpirationTime(Math.floor(issuedAt.getTime() / 1000) + 3600)
    .setSubject("sub-123")
    .sign(privateKey);
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const config: GainConfig = {
  isProduction: false,
  dataDir: "unused — the ControlDb is injected",
  origin: "https://gain.example.com",
  redirectUri: "https://gain.example.com/auth/callback",
  sessionSecret: SECRET,
  sessionIdleMs: IDLE_MS,
  auth: { mode: "oidc", oidc: oidcConfig() },
};

function oidcConfig(): OidcConfig {
  return {
    issuer: ISSUER,
    clientId: CLIENT_ID,
    clientSecret: "shhh",
    requiredGroup: REQUIRED_GROUP,
  };
}

/** Only `get` is exercised; `checkSession` never writes a cookie itself. */
function cookiesWith(value: string | undefined): Cookies {
  return { get: (name: string) => (name === SESSION_COOKIE ? value : undefined) } as Cookies;
}

type TokenEndpoint = (body: URLSearchParams) => Response | Promise<Response>;

function deps(
  control: ControlDb,
  overrides: {
    token?: TokenEndpoint;
    userinfo?: () => Response | Promise<Response>;
    endpoints?: OidcEndpoints;
    getEndpoints?: () => Promise<OidcEndpoints>;
  } = {},
): AuthDeps {
  const endpoints = overrides.endpoints ?? ENDPOINTS;
  const fetchImpl: FetchImpl = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === endpoints.token_endpoint) {
      if (!overrides.token) throw new Error(`unexpected token request in this test`);
      return overrides.token(new URLSearchParams(typeof init?.body === "string" ? init.body : ""));
    }
    if (url === endpoints.userinfo_endpoint) {
      if (!overrides.userinfo) throw new Error("userinfo unreachable");
      return overrides.userinfo();
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  return {
    control,
    getEndpoints: overrides.getEndpoints ?? (() => Promise.resolve(endpoints)),
    // The public JWK stands in for the JWKS the resolver would fetch.
    getKey: () => publicJwk as never,
    fetchImpl,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let tmpDir: string;
let control: ControlDb;
let userId: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-auth-"));
  control = openControlDb(tmpDir, NOW);
  userId = createUser(control, "sub-123", NOW).id;
});

afterEach(() => {
  control.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** A session whose access token expires `accessTtlMs` from NOW. */
function seedSession(options: {
  accessTtlMs?: number | null;
  refreshToken?: string | null;
  createdAt?: Date;
}): string {
  const createdAt = options.createdAt ?? NOW;
  const session = createSession(control, {
    userId,
    now: createdAt,
    idleMs: IDLE_MS,
    tokens: {
      access_token: "access-1",
      access_expires_at:
        options.accessTtlMs == null
          ? null
          : new Date(createdAt.getTime() + options.accessTtlMs).toISOString(),
      refresh_token: options.refreshToken === undefined ? "refresh-1" : options.refreshToken,
      id_token: null,
    },
  });
  return session.id;
}

function check(sessionId: string | undefined, now: Date, d: AuthDeps): Promise<SessionCheck> {
  const cookie = sessionId === undefined ? undefined : signSessionId(SECRET, sessionId);
  return checkSession(cookiesWith(cookie), config, oidcConfig(), now, d);
}

// ---------------------------------------------------------------------------

describe("resolving a session", () => {
  it("is anonymous with no cookie", async () => {
    expect(await check(undefined, NOW, deps(control))).toEqual({ status: "anonymous" });
  });

  it("is anonymous when the cookie signature does not verify", async () => {
    const sessionId = seedSession({ accessTtlMs: 3600_000 });
    const forged = `${sessionId}.${"0".repeat(64)}`;
    const result = await checkSession(
      cookiesWith(forged),
      config,
      oidcConfig(),
      NOW,
      deps(control),
    );
    expect(result).toEqual({ status: "anonymous" });
  });

  it("is anonymous once the sliding window has elapsed, and drops the row", async () => {
    const sessionId = seedSession({ accessTtlMs: null });
    const later = at(IDLE_MS + 1000);
    expect(await check(sessionId, later, deps(control))).toEqual({ status: "anonymous" });
    expect(getSession(control, sessionId, later)).toBeUndefined();
  });

  it("admits a live session without touching the IdP", async () => {
    const sessionId = seedSession({ accessTtlMs: 3600_000 });
    // `deps` throws on any fetch that is not stubbed, so this passing is the
    // assertion that no refresh was attempted.
    expect(await check(sessionId, at(60_000), deps(control))).toEqual({
      status: "ok",
      userId,
      setCookie: null,
    });
  });
});

describe("the sliding expiry", () => {
  it("leaves the row alone while more than half the window remains", async () => {
    const sessionId = seedSession({ accessTtlMs: null });
    const before = getSession(control, sessionId, NOW)?.expires_at;
    const result = await check(sessionId, at(IDLE_MS / 4), deps(control));

    expect(result).toEqual({ status: "ok", userId, setCookie: null });
    expect(getSession(control, sessionId, NOW)?.expires_at).toBe(before);
  });

  it("extends it, and re-issues the cookie, once less than half remains", async () => {
    const sessionId = seedSession({ accessTtlMs: null });
    const before = getSession(control, sessionId, NOW)?.expires_at;
    const now = at(IDLE_MS * 0.75);
    const result = await check(sessionId, now, deps(control));

    expect(result).toEqual({ status: "ok", userId, setCookie: sessionId });
    const after = getSession(control, sessionId, now)?.expires_at;
    expect(after).not.toBe(before);
    expect(after).toBe(new Date(now.getTime() + IDLE_MS).toISOString());
  });
});

describe("the group gate on refresh", () => {
  it("refreshes when the access token is nearly out, and keeps a member signed in", async () => {
    const sessionId = seedSession({ accessTtlMs: 30_000 });
    const refreshed = await idToken({ groups: [REQUIRED_GROUP, "other"] });
    let grant: string | null = null;

    const result = await check(
      sessionId,
      NOW,
      deps(control, {
        token: (body) => {
          grant = body.get("grant_type");
          expect(body.get("refresh_token")).toBe("refresh-1");
          return json({
            access_token: "access-2",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: "refresh-2",
            id_token: refreshed,
          });
        },
      }),
    );

    expect(result).toEqual({ status: "ok", userId, setCookie: null });
    expect(grant).toBe("refresh_token");

    // The rotated tokens are persisted, so the next request does not refresh again.
    const row = getSession(control, sessionId, NOW);
    expect(row?.access_token).toBe("access-2");
    expect(row?.refresh_token).toBe("refresh-2");
    expect(row?.id_token).toBe(refreshed);
  });

  it("revokes the session when the required group is gone", async () => {
    const sessionId = seedSession({ accessTtlMs: 30_000 });
    const refreshed = await idToken({ groups: ["some-other-group"] });

    const result = await check(
      sessionId,
      NOW,
      deps(control, {
        token: () => json({ access_token: "access-2", token_type: "Bearer", id_token: refreshed }),
      }),
    );

    expect(result).toEqual({
      status: "forbidden",
      message: forbiddenMessage(REQUIRED_GROUP),
    });
    expect(getSession(control, sessionId, NOW)).toBeUndefined();
  });

  it("treats a verified ID token with an empty groups claim as a definite no", async () => {
    const sessionId = seedSession({ accessTtlMs: 30_000 });
    const refreshed = await idToken({ groups: [] });

    const result = await check(
      sessionId,
      NOW,
      deps(control, {
        token: () => json({ access_token: "access-2", token_type: "Bearer", id_token: refreshed }),
      }),
    );

    expect(result.status).toBe("forbidden");
  });

  it("falls back to userinfo when the refresh carries no ID token", async () => {
    const sessionId = seedSession({ accessTtlMs: 30_000 });

    const result = await check(
      sessionId,
      NOW,
      deps(control, {
        token: () => json({ access_token: "access-2", token_type: "Bearer" }),
        userinfo: () => json({ sub: "sub-123", groups: [REQUIRED_GROUP] }),
      }),
    );

    expect(result).toEqual({ status: "ok", userId, setCookie: null });
  });

  it("revokes when userinfo answers that membership is gone", async () => {
    const sessionId = seedSession({ accessTtlMs: 30_000 });

    const result = await check(
      sessionId,
      NOW,
      deps(control, {
        token: () => json({ access_token: "access-2", token_type: "Bearer" }),
        userinfo: () => json({ sub: "sub-123", groups: ["something-else"] }),
      }),
    );

    expect(result.status).toBe("forbidden");
    expect(getSession(control, sessionId, NOW)).toBeUndefined();
  });
});

describe("an unevaluable gate does not evict the user", () => {
  // The regression this guards: an IdP that omits `id_token` from a refresh
  // response (the spec allows it) plus a userinfo endpoint that blips used to
  // read exactly like "removed from the group", and logged the user out.
  it("keeps the session when no ID token comes back and userinfo is unreachable", async () => {
    const sessionId = seedSession({ accessTtlMs: 30_000 });

    const result = await check(
      sessionId,
      NOW,
      deps(control, {
        token: () => json({ access_token: "access-2", token_type: "Bearer", expires_in: 3600 }),
        // No userinfo stub: the harness throws, exactly like a network failure.
      }),
    );

    expect(result).toEqual({ status: "ok", userId, setCookie: null });
    expect(getSession(control, sessionId, NOW)?.access_token).toBe("access-2");
  });

  it("keeps the session when userinfo returns an error status", async () => {
    const sessionId = seedSession({ accessTtlMs: 30_000 });

    const result = await check(
      sessionId,
      NOW,
      deps(control, {
        token: () => json({ access_token: "access-2", token_type: "Bearer" }),
        userinfo: () => json({ error: "temporarily_unavailable" }, 503),
      }),
    );

    expect(result.status).toBe("ok");
  });

  it("keeps the session when the refreshed ID token will not verify", async () => {
    const sessionId = seedSession({ accessTtlMs: 30_000 });

    const result = await check(
      sessionId,
      NOW,
      deps(control, {
        token: () =>
          json({ access_token: "access-2", token_type: "Bearer", id_token: "not.a.jwt" }),
        userinfo: () => json({ error: "nope" }, 500),
      }),
    );

    expect(result.status).toBe("ok");
  });

  it("still revokes when the gate *can* be evaluated after an unusable ID token", async () => {
    const sessionId = seedSession({ accessTtlMs: 30_000 });

    const result = await check(
      sessionId,
      NOW,
      deps(control, {
        token: () =>
          json({ access_token: "access-2", token_type: "Bearer", id_token: "not.a.jwt" }),
        userinfo: () => json({ sub: "sub-123", groups: [] }),
      }),
    );

    expect(result.status).toBe("forbidden");
  });
});

describe("when the refresh itself fails", () => {
  it("logs the user out and drops the session if the IdP rejects the refresh token", async () => {
    const sessionId = seedSession({ accessTtlMs: 30_000 });

    const result = await check(
      sessionId,
      NOW,
      deps(control, { token: () => json({ error: "invalid_grant" }, 400) }),
    );

    expect(result).toEqual({ status: "anonymous" });
    expect(getSession(control, sessionId, NOW)).toBeUndefined();
  });

  it("keeps the user signed in when discovery is down — an outage is not a logout", async () => {
    const sessionId = seedSession({ accessTtlMs: 30_000 });

    const result = await check(
      sessionId,
      NOW,
      deps(control, { getEndpoints: () => Promise.reject(new Error("unreachable")) }),
    );

    expect(result).toEqual({ status: "ok", userId, setCookie: null });
    expect(getSession(control, sessionId, NOW)).toBeDefined();
  });

  it("keeps the user signed in when the token endpoint is unreachable", async () => {
    const sessionId = seedSession({ accessTtlMs: 30_000 });

    const result = await check(
      sessionId,
      NOW,
      deps(control, {
        token: () => {
          throw new Error("ECONNREFUSED");
        },
      }),
    );

    expect(result.status).toBe("ok");
    expect(getSession(control, sessionId, NOW)).toBeDefined();
  });

  it("does not refresh at all when the session has no refresh token", async () => {
    const sessionId = seedSession({ accessTtlMs: 30_000, refreshToken: null });
    // No token stub: any refresh attempt would throw.
    expect(await check(sessionId, NOW, deps(control))).toEqual({
      status: "ok",
      userId,
      setCookie: null,
    });
  });
});

describe("the forbidden message", () => {
  it("names the group and points at Authentik, not at GAIN", () => {
    const message = forbiddenMessage(REQUIRED_GROUP);
    expect(message).toContain(REQUIRED_GROUP);
    expect(message).toContain("Authentik");
  });
});
