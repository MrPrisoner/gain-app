/**
 * Configuration loading: the validation rules that make a misconfigured
 * container fail at startup instead of at first login (ARCHITECTURE §3, §4).
 */

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/lib/server/config";

const FULL_OIDC = {
  OIDC_ISSUER: "https://auth.example.com/application/o/gain/",
  OIDC_CLIENT_ID: "gain",
  OIDC_CLIENT_SECRET: "secret",
  OIDC_REQUIRED_GROUP: "gain-users",
};

describe("loadConfig", () => {
  describe("production", () => {
    it("accepts a complete configuration", () => {
      const config = loadConfig(
        {
          ...FULL_OIDC,
          ORIGIN: "https://gain.example.com",
          SESSION_SECRET: "a".repeat(32),
          DATA_DIR: "/data",
        },
        "production",
      );

      expect(config.isProduction).toBe(true);
      expect(config.origin).toBe("https://gain.example.com");
      expect(config.redirectUri).toBe("https://gain.example.com/auth/callback");
      expect(config.dataDir).toBe("/data");
      expect(config.auth.mode).toBe("oidc");
      if (config.auth.mode === "oidc") {
        expect(config.auth.oidc.requiredGroup).toBe("gain-users");
      }
    });

    it("strips a trailing slash from ORIGIN", () => {
      const config = loadConfig(
        { ...FULL_OIDC, ORIGIN: "https://gain.example.com/", SESSION_SECRET: "a".repeat(32) },
        "production",
      );
      expect(config.origin).toBe("https://gain.example.com");
      expect(config.redirectUri).toBe("https://gain.example.com/auth/callback");
    });

    it("refuses the dev bypass outright", () => {
      expect(() =>
        loadConfig(
          {
            ...FULL_OIDC,
            ORIGIN: "https://g.example.com",
            SESSION_SECRET: "s",
            GAIN_DEV_USER: "me",
          },
          "production",
        ),
      ).toThrow(/GAIN_DEV_USER is set on what looks like a real deployment/);
    });

    it("requires ORIGIN", () => {
      expect(() => loadConfig({ ...FULL_OIDC, SESSION_SECRET: "s" }, "production")).toThrow(
        /ORIGIN is not set/,
      );
    });

    it("requires SESSION_SECRET", () => {
      expect(() =>
        loadConfig({ ...FULL_OIDC, ORIGIN: "https://g.example.com" }, "production"),
      ).toThrow(/SESSION_SECRET is not set/);
    });

    it("rejects a short SESSION_SECRET", () => {
      expect(() =>
        loadConfig(
          { ...FULL_OIDC, ORIGIN: "https://g.example.com", SESSION_SECRET: "short" },
          "production",
        ),
      ).toThrow(/SESSION_SECRET is only 5 characters/);
    });

    it("rejects a non-HTTPS ORIGIN", () => {
      expect(() =>
        loadConfig(
          { ...FULL_OIDC, ORIGIN: "http://g.example.com", SESSION_SECRET: "a".repeat(32) },
          "production",
        ),
      ).toThrow(/ORIGIN must be an https:\/\/ URL/);
    });

    it("requires a complete OIDC set", () => {
      expect(() =>
        loadConfig({ ORIGIN: "https://g.example.com", SESSION_SECRET: "s" }, "production"),
      ).toThrow(/No auth configuration/);
    });

    it("rejects a partial OIDC set", () => {
      expect(() =>
        loadConfig(
          {
            OIDC_ISSUER: "https://auth.example.com",
            ORIGIN: "https://g.example.com",
            SESSION_SECRET: "s",
          },
          "production",
        ),
      ).toThrow(/Partial OIDC configuration/);
    });
  });

  /**
   * The guard that stops a real deployment shipping an auth bypass. It cannot key on
   * `NODE_ENV`: `node build` does not set it and neither does adapter-node, so the whole
   * point of these tests is the production-shaped boot with `nodeEnv` undefined (review
   * 2026-08-27, E1). ORIGIN is the signal instead — a published instance has a
   * non-loopback one by construction.
   */
  describe("the dev-only variables outside a container", () => {
    const deployed = {
      ORIGIN: "https://gain.example.com",
      SESSION_SECRET: "a".repeat(32),
    };

    it("refuses GAIN_DEV_USER on a public ORIGIN with NODE_ENV unset", () => {
      expect(() => loadConfig({ ...deployed, GAIN_DEV_USER: "me" }, undefined)).toThrow(
        /GAIN_DEV_USER is set on what looks like a real deployment \(ORIGIN=https:\/\/gain\.example\.com\)/,
      );
    });

    it("refuses GAIN_DEV_USER on a public ORIGIN even when OIDC is complete", () => {
      // OIDC would have won the auth branch, so this used to load cleanly — but a variable
      // that turns off authentication has no business surviving on a deployed instance.
      expect(() =>
        loadConfig({ ...FULL_OIDC, ...deployed, GAIN_DEV_USER: "me" }, undefined),
      ).toThrow(/GAIN_DEV_USER is set on what looks like a real deployment/);
    });

    it("refuses GAIN_DEV_ADMIN on a public ORIGIN with NODE_ENV unset", () => {
      expect(() =>
        loadConfig({ ...FULL_OIDC, ...deployed, GAIN_DEV_ADMIN: "me" }, undefined),
      ).toThrow(/GAIN_DEV_ADMIN is set on what looks like a real deployment/);
    });

    it("refuses a plain HTTP ORIGIN on another host too", () => {
      // Not every wrong deployment is served over TLS directly; a bare `node build` on a
      // LAN address is the same exposure.
      expect(() =>
        loadConfig(
          { ORIGIN: "http://192.168.1.10:3000", SESSION_SECRET: "s", GAIN_DEV_USER: "me" },
          undefined,
        ),
      ).toThrow(/GAIN_DEV_USER is set on what looks like a real deployment/);
    });

    it.each(["http://localhost:5173", "http://127.0.0.1:4173", "http://[::1]:3000"])(
      "still allows the bypass on %s",
      (origin) => {
        const config = loadConfig({ ORIGIN: origin, GAIN_DEV_USER: "me" }, undefined);
        expect(config.auth).toEqual({ mode: "bypass", devUser: "me" });
      },
    );

    it("refuses a plain http ORIGIN with NODE_ENV unset", () => {
      // The session cookie is issued Secure regardless of NODE_ENV, so this fails login
      // with no diagnostic — and `node build` outside the container never sets NODE_ENV,
      // which is the whole reason these guards key on ORIGIN.
      expect(() =>
        loadConfig({ ...FULL_OIDC, ...deployed, ORIGIN: "http://gain.example.com" }, undefined),
      ).toThrow(/ORIGIN must be an https:\/\/ URL/);
    });

    it("requires SESSION_SECRET on a public ORIGIN with NODE_ENV unset", () => {
      // Without this, the secret silently defaults to a fresh random one per boot: every
      // session cookie is invalidated by a restart, and no error says why.
      expect(() =>
        loadConfig({ ...FULL_OIDC, ORIGIN: "https://gain.example.com" }, undefined),
      ).toThrow(/SESSION_SECRET is not set/);
    });

    it("rejects a short SESSION_SECRET on a public ORIGIN with NODE_ENV unset", () => {
      expect(() =>
        loadConfig({ ...FULL_OIDC, ...deployed, SESSION_SECRET: "short" }, undefined),
      ).toThrow(/SESSION_SECRET is only 5 characters/);
    });

    it("still mints a throwaway secret on a loopback ORIGIN", () => {
      const config = loadConfig(
        { ORIGIN: "http://localhost:5173", GAIN_DEV_USER: "me" },
        undefined,
      );
      expect(config.sessionSecret.length).toBeGreaterThanOrEqual(32);
    });

    it("refuses the bypass on an ORIGIN it cannot parse", () => {
      // A malformed ORIGIN is not a loopback one, and guessing in the permissive
      // direction is how an unauthenticated server gets shipped.
      expect(() =>
        loadConfig({ ORIGIN: "gain.example.com", GAIN_DEV_USER: "me" }, undefined),
      ).toThrow(/GAIN_DEV_USER is set on what looks like a real deployment/);
    });
  });

  describe("development", () => {
    it("honours GAIN_DEV_USER as a bypass", () => {
      const config = loadConfig({ GAIN_DEV_USER: "me" }, "development");

      expect(config.auth).toEqual({ mode: "bypass", devUser: "me" });
      expect(config.isProduction).toBe(false);
    });

    it("defaults origin to the local dev server and generates a secret", () => {
      const config = loadConfig({ GAIN_DEV_USER: "me" }, "development");

      expect(config.origin).toBe("http://localhost:5173");
      expect(config.redirectUri).toBe("http://localhost:5173/auth/callback");
      expect(config.sessionSecret.length).toBeGreaterThanOrEqual(32);
    });

    it("prefers full OIDC configuration over the bypass when both are present", () => {
      const config = loadConfig(
        { ...FULL_OIDC, ORIGIN: "http://localhost:4173", SESSION_SECRET: "s", GAIN_DEV_USER: "me" },
        "development",
      );
      expect(config.auth.mode).toBe("oidc");
    });

    it("rejects a partial OIDC set even with a bypass available", () => {
      expect(() =>
        loadConfig({ OIDC_ISSUER: "https://auth.example.com", GAIN_DEV_USER: "me" }, "development"),
      ).toThrow(/Partial OIDC configuration/);
    });

    it("requires some auth configuration", () => {
      expect(() => loadConfig({}, "development")).toThrow(/No auth configuration/);
    });
  });

  it("uses a seven-day sliding session window", () => {
    const config = loadConfig({ GAIN_DEV_USER: "me" }, "development");
    expect(config.sessionIdleMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  describe("appVersion", () => {
    it("defaults to dev when APP_VERSION is not set", () => {
      const config = loadConfig({ GAIN_DEV_USER: "me" }, "development");
      expect(config.appVersion).toBe("dev");
    });

    it("passes through APP_VERSION when set", () => {
      const config = loadConfig({ GAIN_DEV_USER: "me", APP_VERSION: "v0.3.0" }, "development");
      expect(config.appVersion).toBe("v0.3.0");
    });
  });

  describe("admin configuration", () => {
    const prodEnv = {
      ...FULL_OIDC,
      ORIGIN: "https://gain.example.com",
      SESSION_SECRET: "a".repeat(32),
    };

    it("carries the admin group when OIDC is complete", () => {
      const config = loadConfig({ ...prodEnv, OIDC_ADMIN_GROUP: "gain-admins" }, "production");
      expect(config.adminGroup).toBe("gain-admins");
      expect(config.devAdmin).toBeNull();
    });

    it("defaults to no admin at all", () => {
      const config = loadConfig(prodEnv, "production");
      expect(config.adminGroup).toBeNull();
    });

    it("refuses an admin group without a complete OIDC configuration", () => {
      expect(() =>
        loadConfig(
          { GAIN_DEV_USER: "dev", OIDC_ADMIN_GROUP: "gain-admins", SESSION_SECRET: "s" },
          "development",
        ),
      ).toThrow(/OIDC_ADMIN_GROUP/);
    });

    it("grants dev admin to the named bypass user only", () => {
      const config = loadConfig(
        { GAIN_DEV_USER: "dev", GAIN_DEV_ADMIN: "dev", SESSION_SECRET: "s" },
        "development",
      );
      expect(config.devAdmin).toBe("dev");
      expect(config.adminGroup).toBeNull();
    });

    it("refuses GAIN_DEV_ADMIN in production", () => {
      expect(() => loadConfig({ ...prodEnv, GAIN_DEV_ADMIN: "dev" }, "production")).toThrow(
        /GAIN_DEV_ADMIN/,
      );
    });
  });
});
