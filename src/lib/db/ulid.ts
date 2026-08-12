/**
 * ULID generation for server-side IDs (ARCHITECTURE §5: "IDs are ULIDs unless noted").
 *
 * Client-generated ULIDs for offline sync arrive in phase 6; these are the IDs GAIN
 * itself mints — plans, versions, prescriptions, and anything else created server-side.
 */

import { monotonicFactory } from "ulidx";

const ulid = monotonicFactory();

/** A fresh ULID, monotonically increasing within the same millisecond. */
export function newId(): string {
  return ulid();
}
