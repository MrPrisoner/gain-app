/**
 * Reset one user's training data to a clean slate (spec §6).
 *
 * **The order below is load-bearing, not stylistic.** Each step exists because doing it
 * later breaks something quietly:
 *
 * 1. Sessions first — nothing authenticated can write once they are gone, and the
 *    wiped user's browser starts receiving 401s, which the sync layer already handles
 *    by holding its queue rather than dropping it.
 * 2. The generation bump invalidates whatever that held queue contains, so the ops do
 *    not flush back in after the wipe and quarantine forever (spec §7).
 * 3. The cached handle is closed *before* the unlink. `better-sqlite3` holds the file
 *    open; unlinking first leaves this process writing to a deleted inode.
 * 4. The directory goes, and is verified gone — `force: true` is best-effort by design,
 *    and re-provisioning on top of survivors would be worse than failing.
 * 5. Re-provision, so the user logs back in to a working empty instance rather than a
 *    broken one.
 *
 * The account itself survives: the `control_user` row stays, because the user is still
 * in `OIDC_REQUIRED_GROUP` and deleting the row only means their next login mints a new
 * user id and the list entry reappears (spec §2, decision 3).
 */

import fs from "node:fs";
import path from "node:path";
import { beginReset, endReset, evictUserDb, getUserDbFor } from "./app-state";
import { bumpDataGeneration, deleteSessionsForUser, type ControlDb } from "./control-db";

export function resetUserData(
  control: ControlDb,
  dataDir: string,
  userId: string,
): { generation: number } {
  const userDir = path.join(dataDir, "users", userId);

  deleteSessionsForUser(control, userId);
  const generation = bumpDataGeneration(control, userId);

  beginReset(userId);
  try {
    evictUserDb(userId);
    fs.rmSync(userDir, { recursive: true, force: true });
    if (fs.existsSync(userDir)) {
      throw new Error(
        `Could not remove ${userDir}. The user's data is partly deleted and their ` +
          `session has ended; re-run the reset once the cause is cleared.`,
      );
    }
  } finally {
    endReset(userId);
  }

  getUserDbFor(userId);
  return { generation };
}
