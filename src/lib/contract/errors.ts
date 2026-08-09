/**
 * Validation errors are addressed to an AI, not to the user: field path, what was
 * expected, what was found, copy-pasteable in one tap. The user's recovery from a bad
 * import is pasting the report back into their chat — never hand-editing YAML.
 */

import type { z } from "zod";

/** One contract violation, structured for machines and readable by AIs. */
export type AiIssue = {
  /** Dot/bracket path into the contract block, e.g. `sessions[0].blocks[1].exercises[2].reps`. */
  path: string;
  /** What is wrong, in terms the revising AI can act on. */
  problem: string;
  /** The offending value as GAIN saw it, or `(missing)`. */
  found: string;
};

/** Renders a Zod issue path (`["sessions", 0, "blocks"]`) as `sessions[0].blocks`. */
export function pathToString(path: readonly PropertyKey[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out === "" ? String(part) : `.${String(part)}`;
  }
  return out === "" ? "(top level)" : out;
}

/** Retrieves the value a Zod issue path points at, from the raw parsed YAML data. */
function foundAt(data: unknown, path: readonly PropertyKey[]): string {
  let current: unknown = data;
  for (const part of path) {
    if (current === null || typeof current !== "object") return "(not found)";
    current = (current as Record<PropertyKey, unknown>)[part];
  }
  if (current === undefined) return "(missing)";
  try {
    return JSON.stringify(current) ?? String(current);
  } catch {
    return String(current);
  }
}

function describeIssue(issue: z.ZodIssue): string {
  if (issue.code === "invalid_union") {
    // Every union in the contract is "integer or [min, max] range".
    return "must be an integer, or a two-element [min, max] range";
  }
  return issue.message;
}

/** Converts a ZodError into flat, AI-addressed issues. `rawData` is the parsed YAML. */
export function issuesFromZodError(error: z.ZodError, rawData: unknown): AiIssue[] {
  return error.issues.map((issue) => ({
    path: pathToString(issue.path),
    problem: describeIssue(issue),
    found: foundAt(rawData, issue.path),
  }));
}

/**
 * Renders issues as one copy-pasteable Markdown report. The recovery path is the user
 * pasting this back into their AI chat, so it tells the AI exactly how to respond:
 * fix the fields and re-emit the entire plan document.
 */
export function renderIssuesForAI(issues: readonly AiIssue[], context?: string): string {
  const lines: string[] = [
    "GAIN could not import this plan document. Nothing was imported.",
    "",
    context ??
      "The `gain-plan` contract block violates the contract specification (reproduced as Section 4 of every export).",
    "",
    `Found ${issues.length} problem${issues.length === 1 ? "" : "s"}:`,
    "",
  ];

  issues.forEach((issue, i) => {
    lines.push(`${i + 1}. \`${issue.path}\``);
    lines.push(`   - problem: ${issue.problem}`);
    lines.push(`   - found: ${issue.found}`);
  });

  lines.push("");
  lines.push(
    "Fix every issue above and re-emit the ENTIRE plan document — the prose context plus one complete ```gain-plan block. Do not send a patch or just the changed fields.",
  );
  return lines.join("\n");
}
