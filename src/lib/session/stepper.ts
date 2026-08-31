/**
 * The log strip's numeric field arithmetic, pulled out of the component so it can be
 * tested. It computes `weight_kg`, which CLAUDE.md's invariants make the export's — and
 * therefore the reviewing AI's — problem if it is wrong, and a stepper that drifts by a
 * float epsilon is exactly the kind of wrongness nothing downstream would catch.
 *
 * Both functions are total: every input a text field can hold has a defined answer, and
 * neither ever throws.
 */

/**
 * Step a field's current text value by `delta`, returning the text to put back in the
 * input.
 *
 * UI §3: the load dial steps 1 kg, with no per-load-configuration increment and
 * no new contract field; duration steps 5 sec, the granularity a held position is
 * actually timed at. Those increments are the caller's; what is fixed here is that
 * nothing goes below zero, and that an empty or unparseable field steps from zero rather
 * than to `NaN`.
 *
 * Pre-fills can carry halves — an odd total on a paired lift is what 1.25 kg plates
 * produce — so the result is rounded to two decimals to shed float noise rather than to
 * shed the value: stepping 2.5 by 1 must yield `"3.5"`, not `"3.5000000000000004"` and
 * not `"4"`.
 */
export function stepValue(current: string, delta: number): string {
  const parsed = Number.parseFloat(current);
  const base = Number.isFinite(parsed) ? parsed : 0;
  const next = Math.max(0, base + delta);
  return String(Math.round(next * 100) / 100);
}

/**
 * Read a text field as the number to submit, or `undefined` for "not supplied".
 *
 * An empty field is `undefined` rather than `0`, because those mean different things in
 * a `set_log`: a set logged with no weight is bodyweight, and a set logged at 0 kg is a
 * claim. Anything that does not parse finitely is also `undefined` — the alternative is
 * writing `NaN` into a column the export later does arithmetic on.
 */
export function parseNumericField(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
