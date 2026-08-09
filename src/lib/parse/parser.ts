/**
 * The import side of the loop: Markdown in, `{ source_md, context_md, contract }` out.
 *
 * A plan document is prose context plus exactly one fenced `gain-plan` block
 * (CONTRACT §2). Everything outside the block is `context_md`, stored byte-for-byte —
 * GAIN never paraphrases, summarises or regenerates it. Import is all-or-nothing: any
 * failure returns a report and writes nothing.
 *
 * Pure function over plain data — no I/O.
 */

import { parse as parseYaml } from "yaml";
import type { AiIssue } from "../contract/errors";
import { issuesFromZodError, renderIssuesForAI } from "../contract/errors";
import { contractSchema, type GainContract } from "../contract/schema";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ParseFailureKind =
  | "export_bundle"
  | "missing_block"
  | "bad_info_string"
  | "multiple_blocks"
  | "unterminated_block"
  | "yaml_error"
  | "validation";

export type ParseFailure = {
  ok: false;
  kind: ParseFailureKind;
  issues: AiIssue[];
  /** Copy-pasteable report. For validation failures it is addressed to the AI. */
  report: string;
};

export type ParsedPlan = {
  ok: true;
  /** The entire plan document exactly as it was pasted in. */
  source_md: string;
  /** Everything outside the contract block, byte-for-byte. */
  context_md: string;
  /** The validated contract. */
  contract: GainContract;
};

export type ParseResult = ParsedPlan | ParseFailure;

// ---------------------------------------------------------------------------
// Export-bundle detection (ARCHITECTURE §11)
// ---------------------------------------------------------------------------

/**
 * The headings GAIN itself generates in every export. Section 0 is user-editable and
 * may be retitled, so detection rests on the title line and the generated sections.
 */
export const EXPORT_TITLE_REGEX = /^# GAIN Export( — .*)?$/;
export const GENERATED_SECTION_HEADINGS = [
  "## 1. The current plan",
  "## 2. Progress summary",
  "## 3. Raw logs",
  "## 4. How to return an updated plan",
] as const;

export function looksLikeExportBundle(source: string): boolean {
  const firstLine = source.split("\n", 1)[0]?.replace(/\r$/, "").trimEnd() ?? "";
  if (EXPORT_TITLE_REGEX.test(firstLine)) return true;

  const lines = new Set(source.split("\n").map((l) => l.replace(/\r$/, "").trimEnd()));
  let hits = 0;
  for (const heading of GENERATED_SECTION_HEADINGS) {
    if (lines.has(heading)) hits += 1;
  }
  return hits >= 2;
}

const BUNDLE_EXPLANATION = [
  "That is a GAIN export, not a plan.",
  "",
  "GAIN produces export bundles for an AI to read; the AI then returns a plan document.",
  "Bundles are not re-importable — import only ever sees plan documents. Paste the plan",
  "your AI gave you: the prose context plus one ```gain-plan block.",
].join("\n");

// ---------------------------------------------------------------------------
// Fence scanning
// ---------------------------------------------------------------------------

type LineSpan = { start: number; end: number };

/** Offsets of every line; `end` excludes the line terminator. */
function lineSpans(source: string): LineSpan[] {
  const spans: LineSpan[] = [];
  let start = 0;
  for (let i = 0; i <= source.length; i++) {
    if (i === source.length || source[i] === "\n") {
      if (i < source.length || i > start) spans.push({ start, end: i });
      start = i + 1;
    }
  }
  return spans;
}

function lineText(source: string, span: LineSpan): string {
  return source.slice(span.start, span.end).replace(/\r$/, "");
}

type FencedBlock = {
  /** First word of the info string, e.g. `gain-plan`. */
  info: string;
  /** Full info string, trimmed. */
  infoFull: string;
  openLineStart: number;
  bodyStart: number;
  bodyEnd: number;
  /** Offset just past the closing fence line, including its newline if present. */
  afterClose: number;
  unterminated: boolean;
};

const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** Scans CommonMark-style fenced blocks. Never throws. */
export function scanFences(source: string): FencedBlock[] {
  const spans = lineSpans(source);
  const blocks: FencedBlock[] = [];

  let i = 0;
  while (i < spans.length) {
    const span = spans[i];
    if (!span) break;
    const open = OPEN_FENCE.exec(lineText(source, span));
    if (!open) {
      i += 1;
      continue;
    }

    const fence = open[1] ?? "";
    const fenceChar = fence.charAt(0);
    const fenceLen = fence.length;
    const infoFull = (open[2] ?? "").trim();
    const info = infoFull.split(/\s+/)[0] ?? "";

    const closeRegex =
      fenceChar === "`"
        ? new RegExp(`^ {0,3}\`{${fenceLen},}[ \\t]*$`)
        : new RegExp(`^ {0,3}~{${fenceLen},}[ \\t]*$`);

    let closeIndex = -1;
    for (let j = i + 1; j < spans.length; j++) {
      const candidate = spans[j];
      if (candidate && closeRegex.test(lineText(source, candidate))) {
        closeIndex = j;
        break;
      }
    }

    if (closeIndex === -1) {
      blocks.push({
        info,
        infoFull,
        openLineStart: span.start,
        bodyStart: Math.min(span.end + 1, source.length),
        bodyEnd: source.length,
        afterClose: source.length,
        unterminated: true,
      });
      break;
    }

    const closeSpan = spans[closeIndex];
    if (!closeSpan) break;
    const hasNewlineAfterClose = source[closeSpan.end] === "\n";

    blocks.push({
      info,
      infoFull,
      openLineStart: span.start,
      bodyStart: Math.min(span.end + 1, source.length),
      bodyEnd: closeSpan.start,
      afterClose: hasNewlineAfterClose ? closeSpan.end + 1 : closeSpan.end,
      unterminated: false,
    });
    i = closeIndex + 1;
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

function failure(kind: ParseFailureKind, report: string, issues: AiIssue[] = []): ParseFailure {
  return { ok: false, kind, issues, report };
}

/**
 * Parses a plan document. All-or-nothing: on any failure nothing is imported and the
 * returned report explains why — for validation failures, in terms an AI can act on.
 */
export function parsePlanDocument(source: string): ParseResult {
  if (looksLikeExportBundle(source)) {
    return failure("export_bundle", BUNDLE_EXPLANATION);
  }

  const fences = scanFences(source);
  const exact = fences.filter((f) => f.info === "gain-plan");
  const nearMiss = fences.find((f) => f.info.toLowerCase() === "gain-plan");

  if (exact.length === 0) {
    if (nearMiss) {
      return failure(
        "bad_info_string",
        [
          "GAIN could not import this plan document. Nothing was imported.",
          "",
          `The contract block's info string must be exactly \`gain-plan\` — found \`${nearMiss.infoFull}\`.`,
          "Info strings are case-sensitive. Fix the fence and re-emit the entire plan document.",
        ].join("\n"),
      );
    }
    return failure(
      "missing_block",
      [
        "GAIN could not import this plan document. Nothing was imported.",
        "",
        "No fenced ```gain-plan block was found. A plan document must contain exactly one",
        "such block (CONTRACT §2): the prose context plus one fenced YAML block whose info",
        "string is `gain-plan`. Re-emit the entire plan document.",
      ].join("\n"),
    );
  }

  const unterminated = exact.find((f) => f.unterminated);
  if (unterminated) {
    return failure(
      "unterminated_block",
      [
        "GAIN could not import this plan document. Nothing was imported.",
        "",
        "The ```gain-plan block is never closed — its closing ``` fence is missing.",
        "Re-emit the entire plan document with the block properly closed.",
      ].join("\n"),
    );
  }

  if (exact.length > 1) {
    return failure(
      "multiple_blocks",
      [
        "GAIN could not import this plan document. Nothing was imported.",
        "",
        `Found ${exact.length} \`gain-plan\` blocks; a plan document must contain exactly one`,
        "(CONTRACT §2). Merge them into a single block and re-emit the entire plan document.",
      ].join("\n"),
    );
  }

  const block = exact[0];
  if (!block) {
    return failure("missing_block", "No contract block found.");
  }
  const body = source.slice(block.bodyStart, block.bodyEnd);

  // -- YAML parse.
  let data: unknown;
  try {
    data = parseYaml(body);
  } catch (err) {
    const e = err as { message?: string; linePos?: Array<{ line: number; col: number }> };
    const pos = e.linePos?.[0];
    const where = pos ? `gain-plan block, line ${pos.line}, column ${pos.col}` : "gain-plan block";
    return failure("yaml_error", "", [
      {
        path: where,
        problem: `the block is not valid YAML: ${e.message ?? "unknown parse error"}`,
        found: "(unparseable YAML)",
      },
    ]);
  }

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return failure("yaml_error", "", [
      {
        path: "(gain-plan block)",
        problem:
          "the block must be a YAML mapping of top-level keys (schema_version, plan, loads, ...)",
        found: data === null ? "(empty block)" : JSON.stringify(data),
      },
    ]);
  }

  // -- Contract validation.
  const result = contractSchema.safeParse(data);
  if (!result.success) {
    const issues = issuesFromZodError(result.error, data);
    return failure("validation", renderIssuesForAI(issues), issues);
  }

  const context_md = source.slice(0, block.openLineStart) + source.slice(block.afterClose);

  return {
    ok: true,
    source_md: source,
    context_md,
    // Validation guarantees `plan` is present; the type narrows it (see schema.ts).
    contract: result.data as GainContract,
  };
}

/** Counts every exercise prescription across all sessions and blocks. */
export function countPrescriptions(contract: GainContract): number {
  let n = 0;
  for (const session of contract.sessions) {
    for (const block of session.blocks) {
      n += block.exercises.length;
    }
  }
  return n;
}
