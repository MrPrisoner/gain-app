import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The suite runs without the SvelteKit plugin — the pure core and the server
// layer are plain TypeScript, exactly as they were before the app existed. The
// two things the plugin would otherwise provide are the `$lib` alias, which the
// route modules use, and `$app/environment`, which one module reads a single
// boolean from; Vite resolves `?raw` imports natively.
export default defineConfig({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
      // `src/hooks.server.ts` is the one server module importing a SvelteKit virtual
      // module, and it needs to be reachable from a test — the gate's refusals are only
      // observable by driving `handle` itself.
      "$app/environment": fileURLToPath(
        new URL("./tests/helpers/app-environment.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
