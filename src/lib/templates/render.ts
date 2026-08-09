/**
 * Variable substitution for the two outbound templates (ARCHITECTURE §7, §11).
 *
 * Both templates carry `docs/CONTRACT.md` verbatim — the bootstrap prompt via
 * `{{contract}}`, the export as Section 4 — because no AI knows the `gain-plan`
 * format otherwise. Substitution is pure string work over caller-supplied content;
 * nothing here reads the filesystem.
 *
 * Unknown placeholders are left as literal text (ARCHITECTURE §11).
 */

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * Replaces `{{name}}` placeholders whose name is in `known` with `values[name]`
 * (empty string when a known variable has no value). Everything else — unknown
 * placeholders included — is left untouched.
 */
export function substituteVariables(
  template: string,
  known: ReadonlySet<string>,
  values: Record<string, string>,
): string {
  // Function-form replace: the substituted text is never re-interpreted for `$`
  // patterns, which matters when embedding CONTRACT.md byte-for-byte.
  return template.replace(PLACEHOLDER, (match, name: string) =>
    known.has(name) ? (values[name] ?? "") : match,
  );
}

// ---------------------------------------------------------------------------
// Bootstrap prompt (templates/bootstrap-prompt.md)
// ---------------------------------------------------------------------------

/**
 * Every variable except `contract` may be empty — the template tells the AI that a
 * blank field is a question to ask, not a gap to invent around.
 */
export type BootstrapAnswers = {
  equipment?: string;
  sessions_per_week?: string;
  session_minutes?: string;
  goals?: string;
  constraints?: string;
};

export const BOOTSTRAP_VARIABLES = new Set([
  "equipment",
  "sessions_per_week",
  "session_minutes",
  "goals",
  "constraints",
  "contract",
]);

export function renderBootstrapPrompt(
  template: string,
  answers: BootstrapAnswers,
  contractMd: string,
): string {
  return substituteVariables(template, BOOTSTRAP_VARIABLES, {
    equipment: answers.equipment ?? "",
    sessions_per_week: answers.sessions_per_week ?? "",
    session_minutes: answers.session_minutes ?? "",
    goals: answers.goals ?? "",
    constraints: answers.constraints ?? "",
    contract: contractMd,
  });
}

// ---------------------------------------------------------------------------
// Revision instructions (templates/default-ai-instructions.md)
// ---------------------------------------------------------------------------

export type InstructionVariables = {
  plan_name: string;
  plan_version: string;
  export_window: string;
  /** YYYY-MM-DD. */
  today: string;
  workouts_logged: string;
  weeks_elapsed: string;
};

export const INSTRUCTION_VARIABLES = new Set([
  "plan_name",
  "plan_version",
  "export_window",
  "today",
  "workouts_logged",
  "weeks_elapsed",
]);

export function renderInstructionsTemplate(
  template: string,
  vars: InstructionVariables,
): string {
  return substituteVariables(template, INSTRUCTION_VARIABLES, { ...vars });
}