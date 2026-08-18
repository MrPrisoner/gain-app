// See https://svelte.dev/docs/kit/types#app.d.ts

/// <reference types="unplugin-icons/types/svelte" />

declare global {
  namespace App {
    interface Locals {
      /**
       * The authenticated user, resolved from the session cookie by
       * `hooks.server.ts`. `null` on unauthenticated routes (`/healthz`,
       * `/login`, `/auth/callback`).
       *
       * Identity is the GAIN user id (a ULID), never the email — the OIDC
       * `sub` claim is mapped to it in `control.db` (ARCHITECTURE §4).
       */
      user: {
        id: string;
        /** True when the dev-only bypass (`GAIN_DEV_USER`) is active. */
        bypass: boolean;
        /**
         * A friendly name for the greeting and the bootstrap prompt, read
         * from the OIDC `name`/`preferred_username` claim — display only,
         * never an identity. `null` when the IdP gave neither.
         */
        displayName: string | null;
        /**
         * Operator (spec §3). Re-derived from the IdP's groups at login and on
         * every token refresh, so revoking the group revokes this — there is no
         * separate revocation path to forget.
         */
        isAdmin: boolean;
      } | null;
    }
    // interface Error {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

// Byte-for-byte embedding of the byte-sensitive markdown assets (CONTRACT.md,
// the outbound templates). Vite `?raw` imports inline the file content at
// build time, so the container image carries them without runtime file reads.
declare module "*.md?raw" {
  const content: string;
  export default content;
}

export {};
