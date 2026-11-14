/**
 * The OIDC module (ARCHITECTURE §4): discovery, PKCE, token exchange, ID-token
 * verification and the email gate — all against injected fetch/keys, no live
 * IdP. ID tokens are real RS256 JWTs signed with a throwaway key.
 */

import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, generateKeyPair } from "jose";
import {
  OidcError,
  buildAuthorizationUrl,
  buildEndSessionUrl,
  discoverEndpoints,
  discoveryUrl,
  exchangeCode,
  extractDisplayName,
  claimsAnswerEmail,
  extractDisplayLabel,
  extractEmailAnswer,
  extractVerifiedEmail,
  fetchUserinfoEmail,
  generatePkce,
  isEmailAllowed,
  resolveLoginEmail,
  randomToken,
  refreshTokens,
  verifyIdToken,
  type FetchImpl,
} from "../../src/lib/server/oidc";

const ISSUER = "https://auth.example.com/application/o/gain/";
const CLIENT_ID = "gain";
const NOW = new Date("2026-09-08T08:00:00Z");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Adapt a synchronous handler to the fetch interface; a thrown error rejects. */
function mockFetch(handler: (url: string, init: RequestInit | undefined) => Response): FetchImpl {
  return (input, init) =>
    new Promise<Response>((resolve) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      resolve(handler(url, init));
    });
}

/** The token endpoint is always called with a urlencoded string body. */
function formBody(init: RequestInit | undefined): URLSearchParams {
  return new URLSearchParams(typeof init?.body === "string" ? init.body : "");
}

describe("discovery", () => {
  it("builds the well-known URL with or without a trailing slash", () => {
    expect(discoveryUrl(ISSUER)).toBe(`${ISSUER}.well-known/openid-configuration`);
    expect(discoveryUrl("https://auth.example.com/application/o/gain")).toBe(
      "https://auth.example.com/application/o/gain/.well-known/openid-configuration",
    );
  });

  it("parses a discovery document", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe(discoveryUrl(ISSUER));
      return jsonResponse({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}authorization/`,
        token_endpoint: `${ISSUER}token/`,
        jwks_uri: `${ISSUER}jwks/`,
        end_session_endpoint: `${ISSUER}end-session/`,
        userinfo_endpoint: `${ISSUER}userinfo/`,
      });
    });

    const endpoints = await discoverEndpoints(ISSUER, fetchImpl);
    expect(endpoints).toEqual({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}authorization/`,
      token_endpoint: `${ISSUER}token/`,
      jwks_uri: `${ISSUER}jwks/`,
      end_session_endpoint: `${ISSUER}end-session/`,
      userinfo_endpoint: `${ISSUER}userinfo/`,
    });
  });

  it("tolerates missing optional endpoints", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({
        issuer: ISSUER,
        authorization_endpoint: "a",
        token_endpoint: "t",
        jwks_uri: "j",
      }),
    );

    const endpoints = await discoverEndpoints(ISSUER, fetchImpl);
    expect(endpoints.end_session_endpoint).toBeNull();
    expect(endpoints.userinfo_endpoint).toBeNull();
  });

  it("rejects a document missing required fields", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ issuer: ISSUER }));
    await expect(discoverEndpoints(ISSUER, fetchImpl)).rejects.toThrow(
      /missing 'authorization_endpoint'/,
    );
  });

  it("rejects a non-200 response", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({}, 500));
    await expect(discoverEndpoints(ISSUER, fetchImpl)).rejects.toThrow(/HTTP 500/);
  });

  it("wraps network failures", async () => {
    const fetchImpl = mockFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    await expect(discoverEndpoints(ISSUER, fetchImpl)).rejects.toThrow(OidcError);
  });
});

describe("PKCE + authorization request", () => {
  it("generates a valid S256 challenge", () => {
    const { verifier, challenge } = generatePkce();
    const expected = crypto.createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
    expect(verifier.length).toBeGreaterThanOrEqual(43); // RFC 7636 minimum
  });

  it("generates unique tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => randomToken(24)));
    expect(tokens.size).toBe(50);
  });

  it("builds the authorization URL with every §4 parameter", () => {
    const url = new URL(
      buildAuthorizationUrl({
        authorizationEndpoint: `${ISSUER}authorization/`,
        clientId: CLIENT_ID,
        redirectUri: "https://gain.example.com/auth/callback",
        scope: "openid profile email",
        state: "st",
        codeChallenge: "ch",
        nonce: "no",
      }),
    );

    expect(url.origin + url.pathname).toBe(`${ISSUER}authorization/`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe("https://gain.example.com/auth/callback");
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("nonce")).toBe("no");
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("token endpoint", () => {
  it("exchanges the code with the PKCE verifier and client secret", async () => {
    let captured: { url: string; body: URLSearchParams } | undefined;
    const fetchImpl = mockFetch((url, init) => {
      captured = { url, body: formBody(init) };
      return jsonResponse({ access_token: "at", token_type: "Bearer", id_token: "idt" });
    });

    const tokens = await exchangeCode(
      { token_endpoint: `${ISSUER}token/` },
      {
        clientId: CLIENT_ID,
        clientSecret: "secret",
        code: "the-code",
        redirectUri: "https://gain.example.com/auth/callback",
        codeVerifier: "verifier",
      },
      fetchImpl,
    );

    expect(tokens.access_token).toBe("at");
    expect(captured?.url).toBe(`${ISSUER}token/`);
    expect(captured?.body.get("grant_type")).toBe("authorization_code");
    expect(captured?.body.get("code")).toBe("the-code");
    expect(captured?.body.get("code_verifier")).toBe("verifier");
    expect(captured?.body.get("client_id")).toBe(CLIENT_ID);
    expect(captured?.body.get("client_secret")).toBe("secret");
    expect(captured?.body.get("redirect_uri")).toBe("https://gain.example.com/auth/callback");
  });

  it("refreshes with the refresh_token grant", async () => {
    let captured: URLSearchParams | undefined;
    const fetchImpl = mockFetch((_url, init) => {
      captured = formBody(init);
      return jsonResponse({ access_token: "at2", token_type: "Bearer" });
    });

    await refreshTokens(
      { token_endpoint: `${ISSUER}token/` },
      { clientId: CLIENT_ID, clientSecret: "secret", refreshToken: "rt" },
      fetchImpl,
    );

    expect(captured?.get("grant_type")).toBe("refresh_token");
    expect(captured?.get("refresh_token")).toBe("rt");
  });

  it("surfaces provider errors", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({ error: "invalid_grant", error_description: "code expired" }, 400),
    );

    await expect(
      exchangeCode(
        { token_endpoint: `${ISSUER}token/` },
        { clientId: CLIENT_ID, clientSecret: "s", code: "c", redirectUri: "r", codeVerifier: "v" },
        fetchImpl,
      ),
    ).rejects.toThrow(/invalid_grant: code expired/);
  });
});

describe("ID token verification", () => {
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  let publicKey: Awaited<ReturnType<typeof generateKeyPair>>["publicKey"];

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  });

  async function signIdToken(claims: Record<string, unknown>): Promise<string> {
    const builder = new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject(claims.sub as string)
      .setIssuedAt(NOW)
      .setExpirationTime(new Date(NOW.getTime() + 600_000));
    return builder.sign(privateKey);
  }

  it("verifies a valid token and returns its claims", async () => {
    const idToken = await signIdToken({
      sub: "user-1",
      email: "ada@example.com",
      email_verified: true,
    });
    const claims = await verifyIdToken(idToken, {
      issuer: ISSUER,
      clientId: CLIENT_ID,
      key: publicKey,
      now: NOW,
    });
    expect(claims.sub).toBe("user-1");
    expect(claims.email).toBe("ada@example.com");
  });

  it("rejects a wrong audience", async () => {
    const idToken = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(ISSUER)
      .setAudience("another-client")
      .setIssuedAt(NOW)
      .setExpirationTime(new Date(NOW.getTime() + 600_000))
      .sign(privateKey);

    await expect(
      verifyIdToken(idToken, { issuer: ISSUER, clientId: CLIENT_ID, key: publicKey, now: NOW }),
    ).rejects.toThrow(/"aud" claim/);
  });

  it("rejects a wrong issuer", async () => {
    const idToken = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://evil.example.com")
      .setAudience(CLIENT_ID)
      .setIssuedAt(NOW)
      .setExpirationTime(new Date(NOW.getTime() + 600_000))
      .sign(privateKey);

    await expect(
      verifyIdToken(idToken, { issuer: ISSUER, clientId: CLIENT_ID, key: publicKey, now: NOW }),
    ).rejects.toThrow(/"iss" claim/);
  });

  it("rejects an expired token", async () => {
    const idToken = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt(new Date(NOW.getTime() - 7200_000))
      .setExpirationTime(new Date(NOW.getTime() - 3600_000))
      .sign(privateKey);

    await expect(
      verifyIdToken(idToken, { issuer: ISSUER, clientId: CLIENT_ID, key: publicKey, now: NOW }),
    ).rejects.toThrow(/JWTExpired/);
  });

  it("rejects a nonce mismatch", async () => {
    const idToken = await signIdToken({ sub: "user-1", nonce: "other" });
    await expect(
      verifyIdToken(idToken, {
        issuer: ISSUER,
        clientId: CLIENT_ID,
        key: publicKey,
        expectedNonce: "expected",
        now: NOW,
      }),
    ).rejects.toThrow(/nonce/);
  });

  it("accepts a matching nonce", async () => {
    const idToken = await signIdToken({ sub: "user-1", nonce: "expected" });
    const claims = await verifyIdToken(idToken, {
      issuer: ISSUER,
      clientId: CLIENT_ID,
      key: publicKey,
      expectedNonce: "expected",
      now: NOW,
    });
    expect(claims.nonce).toBe("expected");
  });

  it("rejects a token signed by the wrong key", async () => {
    const other = await generateKeyPair("RS256");
    const idToken = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt(NOW)
      .setExpirationTime(new Date(NOW.getTime() + 600_000))
      .sign(other.privateKey);

    await expect(
      verifyIdToken(idToken, { issuer: ISSUER, clientId: CLIENT_ID, key: publicKey, now: NOW }),
    ).rejects.toThrow(OidcError);
  });
});

describe("the email gate", () => {
  it("reads a verified address, lower-cased and trimmed", () => {
    expect(extractVerifiedEmail({ email: "  Ada@Example.COM ", email_verified: true })).toBe(
      "ada@example.com",
    );
  });

  // The allowlist is only as strong as the address it compares: an unverified one is
  // whatever the user typed, so anything short of a literal `true` is no address at all.
  it("refuses an address the IdP has not verified", () => {
    expect(extractVerifiedEmail({ email: "ada@example.com" })).toBeNull();
    expect(extractVerifiedEmail({ email: "ada@example.com", email_verified: false })).toBeNull();
    expect(extractVerifiedEmail({ email: "ada@example.com", email_verified: "true" })).toBeNull();
  });

  it("returns null when the claim is missing or malformed", () => {
    expect(extractVerifiedEmail({ email_verified: true })).toBeNull();
    expect(extractVerifiedEmail({ email: 42, email_verified: true })).toBeNull();
    expect(extractVerifiedEmail({ email: "  ", email_verified: true })).toBeNull();
  });

  it("decides membership, and never admits a missing address", () => {
    const allowed = new Set(["ada@example.com"]);
    expect(isEmailAllowed("ada@example.com", allowed)).toBe(true);
    expect(isEmailAllowed("bob@example.com", allowed)).toBe(false);
    expect(isEmailAllowed(null, allowed)).toBe(false);
  });

  it("keeps an unverified address aside for the refusal, never as the gated address", () => {
    expect(extractEmailAnswer({ email: "Ada@Example.com", email_verified: false })).toEqual({
      email: null,
      unverified: "ada@example.com",
    });
    expect(extractEmailAnswer({ email: "ada@example.com", email_verified: true })).toEqual({
      email: "ada@example.com",
      unverified: null,
    });
    expect(extractEmailAnswer({})).toEqual({ email: null, unverified: null });
  });

  it("tells a token that says nothing about email from one that says no", () => {
    expect(claimsAnswerEmail({ sub: "x" })).toBe(false);
    expect(claimsAnswerEmail({ sub: "x", email: "ada@example.com" })).toBe(true);
    expect(claimsAnswerEmail({ sub: "x", email_verified: false })).toBe(true);
  });
});

describe("the login-time email answer", () => {
  const USERINFO = `${ISSUER}userinfo/`;

  it("uses the ID token when it speaks about email, without asking userinfo", async () => {
    const fetchImpl = mockFetch(() => {
      throw new Error("userinfo must not be asked");
    });
    expect(
      await resolveLoginEmail(
        { email: "ada@example.com", email_verified: true },
        USERINFO,
        "at",
        fetchImpl,
      ),
    ).toEqual({ email: "ada@example.com", unverified: null });
  });

  it("falls back to userinfo when the ID token is silent", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({ sub: "user-1", email: "ada@example.com", email_verified: true }),
    );
    expect(await resolveLoginEmail({ sub: "user-1" }, USERINFO, "at", fetchImpl)).toEqual({
      email: "ada@example.com",
      unverified: null,
    });
  });

  // At login there is no session to protect, so "could not tell" denies.
  it("denies when the token is silent and userinfo cannot answer", async () => {
    const fetchImpl = mockFetch(() => {
      throw new Error("boom");
    });
    expect(await resolveLoginEmail({ sub: "user-1" }, USERINFO, "at", fetchImpl)).toEqual({
      email: null,
      unverified: null,
    });
    expect(await resolveLoginEmail({ sub: "user-1" }, null, "at", fetchImpl)).toEqual({
      email: null,
      unverified: null,
    });
  });
});

describe("the operator label", () => {
  // Access is a list of addresses, so the label the operator screen shows must be the
  // one that list holds — not a username the provider minted from it.
  it("prefers email over preferred_username and name", () => {
    expect(
      extractDisplayLabel({
        email: "ada@example.com",
        preferred_username: "ada_example.com",
        name: "Ada",
      }),
    ).toBe("ada@example.com");
  });

  it("falls back to preferred_username, then name", () => {
    expect(extractDisplayLabel({ preferred_username: "ada", name: "Ada" })).toBe("ada");
    expect(extractDisplayLabel({ name: "Ada" })).toBe("Ada");
    expect(extractDisplayLabel({})).toBeNull();
  });
});

describe("the display name", () => {
  it("prefers the name claim", () => {
    expect(extractDisplayName({ name: "Ada Lovelace", preferred_username: "ada" })).toBe(
      "Ada Lovelace",
    );
  });

  it("falls back to preferred_username when name is missing or blank", () => {
    expect(extractDisplayName({ preferred_username: "ada" })).toBe("ada");
    expect(extractDisplayName({ name: "  ", preferred_username: "ada" })).toBe("ada");
  });

  it("trims whitespace", () => {
    expect(extractDisplayName({ name: "  Ada Lovelace  " })).toBe("Ada Lovelace");
  });

  it("is null when neither claim is a non-empty string", () => {
    expect(extractDisplayName({})).toBeNull();
    expect(extractDisplayName({ name: 42, preferred_username: null })).toBeNull();
    expect(extractDisplayName({ name: "   " })).toBeNull();
  });

  it("falls back to the userinfo email", async () => {
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe(`${ISSUER}userinfo/`);
      expect(init?.headers).toMatchObject({ authorization: "Bearer at" });
      return jsonResponse({ sub: "user-1", email: "Ada@example.com", email_verified: true });
    });

    const answer = await fetchUserinfoEmail(`${ISSUER}userinfo/`, "at", fetchImpl);
    expect(answer).toEqual({ email: "ada@example.com", unverified: null });
  });

  // `null`, not `{ email: null }`: "the IdP says no verified address" and "GAIN could not ask" are
  // different facts. A login denies on either; a mid-session re-check must not
  // evict a legitimate user over a network blip (see auth.test.ts).
  it("reports 'could not tell' when userinfo is unreachable", async () => {
    const fetchImpl = mockFetch(() => {
      throw new Error("boom");
    });
    expect(await fetchUserinfoEmail(`${ISSUER}userinfo/`, "at", fetchImpl)).toBeNull();
  });

  it("reports 'could not tell' when userinfo refuses the token", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ error: "invalid_token" }, 401));
    expect(await fetchUserinfoEmail(`${ISSUER}userinfo/`, "at", fetchImpl)).toBeNull();
  });

  it("reports no address when the IdP answers without a verified one", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ sub: "abc" }));
    expect(await fetchUserinfoEmail(`${ISSUER}userinfo/`, "at", fetchImpl)).toEqual({
      email: null,
      unverified: null,
    });
  });
});

describe("end-session URL", () => {
  it("carries the id_token_hint and post-logout redirect", () => {
    const url = new URL(
      buildEndSessionUrl(`${ISSUER}end-session/`, {
        idTokenHint: "idt",
        postLogoutRedirectUri: "https://gain.example.com",
      }),
    );
    expect(url.searchParams.get("id_token_hint")).toBe("idt");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://gain.example.com");
  });

  it("omits hints it does not have", () => {
    const url = new URL(buildEndSessionUrl(`${ISSUER}end-session/`, {}));
    expect(url.searchParams.get("id_token_hint")).toBeNull();
    expect(url.searchParams.get("post_logout_redirect_uri")).toBeNull();
  });
});
