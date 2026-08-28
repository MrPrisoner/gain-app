/**
 * A stand-in for SvelteKit's `$app/environment`, for the one server module that imports
 * it. The suite runs without the SvelteKit plugin on purpose (`vitest.config.ts`), so the
 * virtual module does not resolve — and `src/hooks.server.ts` reads exactly one export
 * from it, to skip startup during `vite build`'s prerender pass. Under test we are always
 * running, never building.
 */
export const building = false;
