/**
 * The operator screen.
 *
 * A non-admin gets **404, not 403**. A 403 confirms both that the route exists and that
 * this instance has an operator configured; a 404 says nothing at all. The guard runs in
 * `load` *and* in the action — guarding only the page leaves the destructive POST
 * reachable by anyone who can construct one.
 */

import { error, fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { getControlDb } from "$lib/server/app-state";
import { getConfig } from "$lib/server/config";
import { listUsers } from "$lib/server/control-db";
import { CURRENT_SCHEMA_VERSION, statsForUsers } from "$lib/server/admin-stats";
import { resetUserData } from "$lib/server/admin-reset";
import { confirmationFor, describeActivity, schemaNote } from "$lib/admin/user-status";

function requireAdmin(locals: App.Locals): void {
  if (!locals.user?.isAdmin) throw error(404, "Not found");
}

/**
 * FormData values are `string | File`; a text field is always the string, and anything
 * else is treated as empty rather than stringified (matches `src/routes/+page.server.ts`).
 */
function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export const load: PageServerLoad = ({ locals }) => {
  requireAdmin(locals);
  const now = new Date();
  const users = statsForUsers(getConfig().dataDir, listUsers(getControlDb()));
  return {
    // The status sentence is resolved here, not in the component: "3 days ago" derived
    // at render time would differ between SSR and hydration.
    users: users.map((user) => ({
      ...user,
      status: describeActivity(user, now),
      confirmation: confirmationFor(user.displayLabel, user.userId),
      schemaNote: schemaNote(user.schemaVersion, CURRENT_SCHEMA_VERSION),
    })),
  };
};

export const actions: Actions = {
  reset: async ({ locals, request }) => {
    requireAdmin(locals);

    const form = await request.formData();
    const userId = formText(form, "userId");
    const typed = formText(form, "confirmLabel").trim();

    const control = getControlDb();
    const target = listUsers(control).find((user) => user.id === userId);
    if (!target) return fail(400, { actionError: "That user no longer exists.", userId });

    const expected = confirmationFor(target.display_label, target.id);
    if (typed !== expected) {
      return fail(400, {
        actionError: `That does not match. Type ${expected} exactly to confirm.`,
        userId,
      });
    }

    try {
      resetUserData(control, getConfig().dataDir, target.id);
    } catch (err) {
      // Never throw from an action: a 500 renders +error.svelte and the operator loses
      // the screen along with any account of what happened.
      return fail(400, {
        actionError: err instanceof Error ? err.message : "The reset did not finish.",
        userId,
      });
    }

    return { resetLabel: expected };
  },
};
