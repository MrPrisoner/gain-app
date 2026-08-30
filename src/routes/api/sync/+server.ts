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
import { getControlDb, getUserDbFor } from "$lib/server/app-state";
import { getDataGeneration } from "$lib/server/control-db";
import { syncBatchSchema } from "$lib/sync/ops";
import { replayOps } from "$lib/sync/replay";

/**
 * `syncBatchSchema` caps op *count* at 500 but not the size of any one op's free-text
 * fields (a deviation's `note`, a metric's `valueText`, ...), so op count alone does not
 * bound request size. This is an app-level bound rather than a proxy setting because
 * only the app knows what a plausible batch looks like — 500 ops of
 * realistic field sizes lands nowhere near this, so it only ever rejects something
 * pathological.
 */
const MAX_SYNC_BODY_BYTES = 1_000_000;

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: "Not signed in." }, { status: 401 });

  const raw = await readCappedBody(request, MAX_SYNC_BODY_BYTES);
  if (raw === null) {
    return json({ error: "Batch is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Body is not valid JSON." }, { status: 400 });
  }

  const parsed = syncBatchSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid batch." }, { status: 400 });
  }

  // A reset bumps the generation, so anything queued before it belongs to data that no
  // longer exists. Reject the batch whole — a partial application would write orphan
  // rows into the fresh database (spec §7).
  const generation = getDataGeneration(getControlDb(), locals.user.id);
  if (parsed.data.generation !== generation) {
    return json(
      {
        error: "Your data was reset. Queued entries from before the reset cannot be applied.",
        dataGeneration: generation,
      },
      { status: 409 },
    );
  }

  const userDb = getUserDbFor(locals.user.id);

  return json(replayOps(userDb, parsed.data.ops));
};

/**
 * The body as text, or `null` if it exceeds `limit`.
 *
 * Counted off the bytes actually read rather than off `Content-Length`, because the
 * header is not a fact: a chunked request carries none at all, and a garbage value makes
 * `Number(...)` NaN, whose every comparison is false — either way a header-only check is
 * skipped rather than failed, and the unbounded body it was guarding against is then
 * buffered whole by `request.json()`. The header is still consulted first as a cheap
 * short-circuit when it is both present and honest.
 *
 * Reading incrementally is what makes the bound real: the stream is cancelled the moment
 * the running total crosses the limit, so an oversized body is never held in memory.
 */
async function readCappedBody(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;

  const body = request.body;
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
