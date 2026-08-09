import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The suite runs without the SvelteKit plugin — the pure core and the server
// layer are plain TypeScript, exactly as they were before the app existed. The
// one thing the plugin would otherwise provide is the `$lib` alias, which the
// route modules use; Vite resolves `?raw` imports natively.
export default defineConfig({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
