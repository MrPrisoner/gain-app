/**
 * The offline sync endpoint (design spec §3, §6).
 *
 * One batch, one transaction, one ack. `src/lib/server/gate.ts` already answers a
 * non-navigation request with 401 rather than a 303, which is what lets a queued POST
 * survive an expired session instead of being replayed as a body-discarding GET.
 *
 * Nothing here throws. A handler that 500s tells a client nothing it can act on, and a
 * client that cannot tell "retry" from "give up" either loses the workout or retries
 * forever (ARCHITECTURE §4).
 */

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getUserDbFor } from "$lib/server/app-state";
import { syncBatchSchema } from "$lib/sync/ops";
import { replayOps } from "$lib/sync/replay";

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body is not valid JSON." }, { status: 400 });
  }

  const parsed = syncBatchSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid batch." }, { status: 400 });
  }

  const userDb = getUserDbFor(locals.user.id);

  return json(replayOps(userDb, parsed.data.ops));
};
