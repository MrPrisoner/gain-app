import { encodeTime } from "ulidx";

/**
 * A ULID whose timestamp is exactly `ms`. The 16-character random suffix is fixed — the
 * tests that use this care only about the time half, and a deterministic suffix keeps a
 * failure message readable.
 */
export function ulidAt(ms: number): string {
  return `${encodeTime(ms, 10)}0000000000000000`;
}
