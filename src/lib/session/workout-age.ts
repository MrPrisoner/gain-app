/**
 * How long an unfinished workout stays resumable, and the one comparison that decides it.
 *
 * Twelve hours from the workout's start. Past that, the session is not resumed — it can
 * only be discarded, and starting the same session again mints a fresh workout. The
 * reason is the export rather than tidiness: session duration is `completed_at -
 * started_at` (`$lib/export/bundle.ts`), so appending today's sets to a days-old workout
 * reports a multi-day session to the reviewing AI, and CLAUDE.md's summary invariant is
 * that a wrong number there becomes a wrong prescription with nothing in the loop to
 * catch it.
 *
 * The age is read from the workout's **client id**, which is a ULID minted when the
 * runner mounted and therefore already carries `started_at` to the millisecond. That is
 * what lets the server (which has the column) and the client (which has only the
 * `localStorage` pointer) reach the same answer with no extra plumbing and no round trip.
 *
 * Pure, and `now` is injected — no clock is read here, so this stays usable during SSR
 * without a hydration mismatch.
 */

import { decodeTime, isValid } from "ulidx";

/** Twelve hours. Defined once; nothing else may spell this number. */
export const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * The start time a workout's ULID client id encodes, or `undefined` when the id is not a
 * ULID at all — a value from a future id format, or a corrupted `localStorage` entry.
 * `decodeTime` throws on a malformed input rather than returning a sentinel, so the
 * guard is `isValid` and not a try/catch after the fact.
 */
export function workoutStartedAtMs(clientId: string): number | undefined {
  if (!isValid(clientId)) return undefined;
  return decodeTime(clientId);
}

/**
 * Whether this workout may still be resumed.
 *
 * An id we cannot read is **not** resumable. That is the safe direction: a wrong `false`
 * costs a fresh workout, while a wrong `true` costs a corrupted duration in an export
 * nobody re-checks.
 *
 * A start time in the future is resumable. A device clock corrected backwards can
 * produce one, and that describes a session started moments ago rather than an ancient
 * one.
 */
export function isResumable(clientId: string, now: Date): boolean {
  const startedAt = workoutStartedAtMs(clientId);
  if (startedAt === undefined) return false;
  return now.getTime() - startedAt < RESUME_WINDOW_MS;
}
