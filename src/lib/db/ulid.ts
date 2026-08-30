/**
 * ULID generation for server-side IDs (ARCHITECTURE §5: "IDs are ULIDs unless noted").
 *
 * These are the IDs GAIN itself mints — plans, versions, prescriptions, and anything
 * else created server-side. The offline client mints its own ULIDs separately
 * (`$lib/sync/ops.ts`); this module is not on that path.
 */

import { monotonicFactory } from "ulidx";

const ulid = monotonicFactory();

/** A fresh ULID, monotonically increasing within the same millisecond. */
export function newId(): string {
  return ulid();
}
