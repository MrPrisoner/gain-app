/**
 * Maps the activity sheet's coarse "when" choice to a timestamp. Exact
 * clock precision does not matter anywhere downstream — nothing in the export reads
 * activity timestamps more finely than a date — so this only has to land on the right
 * day, at a stable hour.
 */

export type ActivityWhen = "now" | "earlier_today" | "yesterday";

/**
 * "earlier_today" clamps to `nowMs` rather than landing in the future — a user
 * logging at 8am who picks "earlier today" should not get a timestamp seven hours
 * from now.
 */
export function occurredAtMsFor(choice: ActivityWhen, nowMs: number): number {
  if (choice === "now") return nowMs;

  const d = new Date(nowMs);
  if (choice === "yesterday") d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(12, 0, 0, 0);
  return Math.min(d.getTime(), nowMs);
}
