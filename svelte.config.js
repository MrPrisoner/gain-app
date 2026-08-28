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

    // The Content-Security-Policy (ARCHITECTURE §3). SvelteKit owns this header rather
    // than `hooks.server.ts` because it is the only thing that knows the nonce it stamped
    // into the page's own inline hydration script; the rest of the security headers are
    // static and live in `src/lib/server/headers.ts`.
    //
    // `mode: "auto"` nonces the dynamic pages and hashes the prerendered ones, which is
    // the only combination that covers both without `'unsafe-inline'` on scripts.
    csp: {
      // The default, set explicitly because it is the load-bearing half: nonces on the
      // dynamic pages, hashes on the prerendered ones.
      mode: "auto",
      directives: {
        "default-src": ["self"],
        "script-src": ["self"],
        // Svelte's component styles are extracted to files at build time, so `self`
        // covers the stylesheets themselves.
        "style-src": ["self"],
        // ...but `style:` directives compile to inline style *attributes*, and there are
        // dozens of them — the confetti overlay, every chart, `app.html`'s own
        // `display: contents` wrapper. `style-src-attr` is the narrow allowance for
        // exactly those; it does not permit an inline `<style>` element.
        "style-src-attr": ["unsafe-inline"],
        "img-src": ["self", "data:"],
        "font-src": ["self"],
        // The sync queue posts to this origin and nowhere else. GAIN never calls an AI,
        // and this is the directive that makes that architectural claim enforceable.
        "connect-src": ["self"],
        "manifest-src": ["self"],
        "worker-src": ["self"],
        "object-src": ["none"],
        "base-uri": ["self"],
        "form-action": ["self"],
        "frame-ancestors": ["none"],
      },
    },
  },
};

export default config;
