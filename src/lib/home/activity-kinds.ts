/**
 * Activity kind bookkeeping (design spec §5). `activity.kind` is a free-form slug in
 * the user's own vocabulary — GAIN ships no list of sports (ARCHITECTURE §9), so this
 * module only ever reflects kinds the user has already used, plus `rest`.
 */

/**
 * The boring kind of slugify: lowercase, non-alphanumerics collapsed to single hyphens,
 * leading/trailing hyphens trimmed. This mints identifiers the export CSV carries to an
 * AI, so it must be predictable rather than clever.
 */
export function slugifyActivityKind(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The kinds already used, most-recent-first, deduplicated, capped at `limit` with
 * `rest` always present — six chips plus a "new" control fit a 360px screen without
 * wrapping into a grid that has to be scanned.
 */
export function suggestActivityKinds(activities: readonly { kind: string }[], limit = 6): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const a of activities) {
    if (a.kind === "rest" || seen.has(a.kind)) continue;
    seen.add(a.kind);
    ordered.push(a.kind);
    if (ordered.length >= limit - 1) break;
  }
  ordered.push("rest");
  return ordered;
}
