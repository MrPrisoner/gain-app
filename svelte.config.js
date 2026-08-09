import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // One image, one container, one port (ARCHITECTURE §3): adapter-node serves the
    // built app directly. The internal port is fixed at 3000 (env PORT); the host
    // port is the compose knob. ORIGIN must be the public HTTPS URL — the startup
    // log in hooks.server.ts echoes it back because a wrong ORIGIN is the #1 cause
    // of login loops behind a reverse proxy (ARCHITECTURE §14).
    adapter: adapter(),
  },
};

export default config;
