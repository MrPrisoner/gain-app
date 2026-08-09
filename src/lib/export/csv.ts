/**
 * Section 3 of the export: raw logs as CSV (ARCHITECTURE §11).
 *
 * Three tables: sets, sessions, activities. Deterministic column order — fixed
 * columns first, then plan-declared metric keys in contract declaration order.
 */

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

/** Renders rows (header first) as CSV. Always ends with a single newline. */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(csvEscape).join(","));
  return `${lines.join("\n")}\n`;
}

/** Formats a number without floating-point noise: 6 instead of 6.0000000001. */
export function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
