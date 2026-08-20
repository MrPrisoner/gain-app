/**
 * How long ago a session was last trained, for the Home screen's session rows.
 *
 * "3 days ago" is the question those rows are actually asking — a rotation is chosen on
 * recency, not on calendar dates — and it is also far shorter than the ISO string it
 * replaces, which is what let the row give the session name a full line to itself instead
 * of wrapping it under the key badge at 320px.
 *
 * Pure, and takes `todayDate` rather than reading a clock. That is what keeps it usable
 * during SSR without a hydration mismatch: the server passes its own date down as data,
 * so both renders compute the same label from the same two strings. Both inputs are
 * date-only (`YYYY-MM-DD`) — `lastDoneDate` already is, everywhere it comes from — and
 * the whole app is already on server dates (`imported_at.slice(0, 10)`,
 * `startedAtDate`), so this introduces no timezone assumption that was not there before.
 */

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Midnight UTC for a `YYYY-MM-DD`, or `undefined` if it is not one. Parsing to a real
 * date rather than subtracting the parts is what makes month, year and leap-day
 * boundaries come out right — the arithmetic that gets those wrong fails silently, with
 * a plausible number that is off by one. */
function midnightUtc(date: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? undefined : ms;
}

function absolute(date: string, ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function lastDoneLabel(lastDoneDate: string | undefined, todayDate: string): string {
  if (lastDoneDate === undefined) return "not done yet";

  const then = midnightUtc(lastDoneDate);
  const now = midnightUtc(todayDate);
  // Nothing here is worth inventing a label over: show what we were given rather than
  // a confidently wrong "0 days ago".
  if (then === undefined || now === undefined) return lastDoneDate;

  // `lastDoneDate` is derived from a client-stamped `started_at` while `todayDate` is
  // the server's, so a workout logged late in the evening from a timezone ahead of the
  // server can legitimately carry tomorrow's date. "in 1 day" on a training screen is
  // worse than "today", and the distinction never matters here.
  const days = Math.max(0, Math.round((now - then) / DAY_MS));

  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;

  const weeks = Math.floor(days / 7);
  // Past a couple of months "9 weeks ago" stops being a gap anyone can place, and the
  // date is both shorter to read and more useful.
  if (weeks > 8) return absolute(lastDoneDate, then);
  return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
}
