/**
 * Self-service account reset (ROADMAP "A user can reset their own account.").
 *
 * Reuses `resetUserData` (`src/lib/server/admin-reset.ts`) exactly as `/admin` does —
 * the machinery does not change, only the caller: here it is the account's own owner,
 * gated by the ordinary session check rather than `isAdmin`.
 *
 * `resetUserData` ends every session for the user, including the one making this
 * request — that is correct for an operator resetting someone else, but here it would
 * strand the person who just asked for this on `/login` instead of the empty state the
 * roadmap promises. So this action captures the current session's tokens before the
 * wipe and re-mints a fresh session afterwards, in OIDC mode only: bypass mode has no
 * session row at all (`hooks.server.ts` synthesises `locals.user` from `GAIN_DEV_USER`
 * on every request), so there is nothing to capture or re-mint.
 */

import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { getConfig } from "$lib/server/config";
import { getControlDb } from "$lib/server/app-state";
import { createSession, getSession } from "$lib/server/control-db";
import { setSessionCookie } from "$lib/server/auth";
import { SESSION_COOKIE, verifySessionCookie } from "$lib/server/session-cookie";
import { resetUserData } from "$lib/server/admin-reset";

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) throw redirect(303, "/login");
  return { displayName: locals.user.displayName, bypass: locals.user.bypass };
};

export const actions: Actions = {
  reset: async ({ locals, cookies, request }) => {
    if (!locals.user) throw redirect(303, "/login");

    const form = await request.formData();
    const confirmRaw = form.get("confirm");
    const typed = typeof confirmRaw === "string" ? confirmRaw.trim() : "";
    if (typed.toUpperCase() !== "RESET") {
      return fail(400, { actionError: "Type RESET to confirm." });
    }

    const config = getConfig();
    const control = getControlDb();

    // Captured before the wipe deletes the row it lives on. `bypass` mode never has a
    // session row to find, so `current` stays undefined and the re-mint below is skipped.
    const cookieValue = cookies.get(SESSION_COOKIE);
    const sessionId = cookieValue ? verifySessionCookie(config.sessionSecret, cookieValue) : null;
    const current = sessionId ? getSession(control, sessionId, new Date()) : undefined;

    let generation: number;
    try {
      ({ generation } = resetUserData(control, config.dataDir, locals.user.id));
    } catch (err) {
      // Never throw from an action (see `/admin`'s reset action): a 500 here would
      // strand the user on a page that just told them their data might be half-gone.
      return fail(400, {
        actionError: err instanceof Error ? err.message : "The reset did not finish.",
      });
    }

    if (current) {
      const now = new Date();
      const fresh = createSession(control, {
        userId: locals.user.id,
        now,
        idleMs: config.sessionIdleMs,
        tokens: {
          access_token: current.access_token,
          access_expires_at: current.access_expires_at,
          refresh_token: current.refresh_token,
          id_token: current.id_token,
        },
        isAdmin: current.is_admin === 1,
      });
      setSessionCookie(cookies, config, fresh.id);
    }

    return { reset: true, generation };
  },
};
