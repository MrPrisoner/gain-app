import type { LayoutServerLoad } from "./$types";
import { getConfig } from "$lib/server/config";

export const load: LayoutServerLoad = ({ locals }) => ({
  user: locals.user,
  appVersion: getConfig().appVersion,
});
