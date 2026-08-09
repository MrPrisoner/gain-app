import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// Test configuration stays in vitest.config.ts: the phase-1/2 suite runs without
// the SvelteKit plugin, exactly as it did before the app existed.
export default defineConfig({
  plugins: [sveltekit()],
});
