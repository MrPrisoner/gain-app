/**
 * The pasteable report for a revision GAIN refuses to import outright — a blocking
 * problem the diff engine found (`src/lib/diff/present.ts`'s `blocking`), distinct from a
 * parse failure. CLAUDE.md's invariant is "every failed import produces a pasteable
 * report — not just contract violations", and this is the half of that invariant a parse
 * failure's own report (`src/lib/parse/parser.ts`) does not cover.
 *
 * Pulled out of `src/routes/import/+page.svelte` rather than left as a closure there
 * (review 2026-08-27, U3): nothing inside a `.svelte` file is reachable by `npm test`, so
 * the wording of GAIN's second AI-facing report went out with no unit coverage at all.
 */

export type BlockingReportInput = {
  planSlug: string;
  fromVersion: number;
  toVersion: number;
  blocking: readonly string[];
};

export function blockingReport({
  planSlug,
  fromVersion,
  toVersion,
  blocking,
}: BlockingReportInput): string {
  return [
    `GAIN could not accept version ${toVersion} of "${planSlug}" as a revision of version ${fromVersion}. Fix the following and return a corrected document:`,
    "",
    ...blocking.map((problem) => `- ${problem}`),
  ].join("\n");
}
