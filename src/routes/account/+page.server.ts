/**
 * Self-service account reset: a user can reset their own account, without an operator.
 *
 * Reuses `resetUserData` (`src/lib/server/admin-reset.ts`) exactly as `/admin` does —
 * the machinery does not change, only the caller: here it is the account's own owner,
 * gated by the ordinary session check rather than `isAdmin`.
 *
 * `resetUserData` ends every session for the user, including the one making this
 * request — that is correct for an operator resetting someone else, but here it would
 * strand the person who just asked for this on `/login` instead of the empty state a
 * self-service reset is supposed to land on. So this action captures the current
 * session's tokens before the
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
import { logServerError } from "$lib/server/log";

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

    // In a `finally`, not on the success path alone. `resetUserData` ends every session
    // for the user as its *first* step, so by the time any of its later steps can throw,
    // the caller's session is already gone — and a `fail(400)` that says "re-run the
    // reset" would be rendered on a page that can no longer authenticate a retry. The
    // one case where this re-mints unnecessarily is a throw from the session delete
    // itself, which leaves an orphaned row to age out rather than a signed-out user.
    let generation: number;
    try {
      ({ generation } = resetUserData(control, config.dataDir, locals.user.id));
    } catch (err) {
      // Never throw from an action (see `/admin`'s reset action): a 500 here would
      // strand the user on a page that just told them their data might be half-gone.
      //
      // The message itself stays on the server. `resetUserData`'s own failure names the
      // absolute path it could not remove, which tells an operator on `/admin` exactly
      // what to go and clear — and tells the account's owner nothing they can act on,
      // while handing them a server filesystem path. They get what they can do instead.
      logServerError(`self-service reset failed for ${locals.user.id}`, err);
      return fail(400, {
        actionError:
          "The reset did not finish. Your data may be partly deleted — try again, and " +
          "ask an administrator if it keeps failing.",
      });
    } finally {
      if (current) {
        const fresh = createSession(control, {
          userId: locals.user.id,
          now: new Date(),
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
    }

    return { reset: true, generation };
  },
};
