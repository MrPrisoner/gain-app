import type { LayoutServerLoad } from "./$types";
import { getControlDb } from "$lib/server/app-state";
import { getConfig } from "$lib/server/config";
import { getDataGeneration } from "$lib/server/control-db";

export const load: LayoutServerLoad = ({ locals }) => ({
  user: locals.user,
  appVersion: getConfig().appVersion,
  // The generation the client's outbox must match to be accepted (spec §7). 0 for an
  // anonymous request, which is also the default a batch with no generation parses to.
  dataGeneration: locals.user ? getDataGeneration(getControlDb(), locals.user.id) : 0,
});
