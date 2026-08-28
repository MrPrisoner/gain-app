/**
 * The security headers every response carries (ARCHITECTURE §3).
 *
 * Split deliberately: the app sets everything it can know to be true of itself, and
 * leaves to the reverse proxy only what depends on how the instance is published. The
 * app cannot know whether it is reached over TLS — it listens on plain HTTP inside the
 * container by design — so `Strict-Transport-Security` is the proxy's, and it is the
 * only one. Everything here is a property of the application rather than of the
 * deployment, so shipping it in the image means an operator cannot forget it.
 *
 * `Content-Security-Policy` is not in this list. SvelteKit generates that one itself
 * from `kit.csp` (`svelte.config.js`) because it alone knows the nonce it stamped into
 * the page's own inline scripts; a second, static CSP header here would be intersected
 * with it by the browser and would block exactly those scripts. What is here instead is
 * `FALLBACK_CSP`, for the responses SvelteKit does not render — see below.
 */

/**
 * Applied to every response the app produces.
 *
 * `X-Frame-Options` duplicates the CSP's `frame-ancestors 'none'` rather than replacing
 * it: the CSP directive is the one modern browsers honour, the header is what an old one
 * understands, and clickjacking a session runner into an invisible iframe is cheap enough
 * to be worth both.
 */
export const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  // `same-origin` rather than `strict-origin-when-cross-origin`: the one cross-origin
  // navigation GAIN makes is the OIDC redirect to the IdP, which needs no referrer, and a
  // path like /plan/<slug>/session/<key> says more about a person than a bare origin does.
  ["referrer-policy", "same-origin"],
  // Nothing in GAIN asks for a device capability, so every one of them is denied. The
  // list is the powerful features a browser would otherwise let a compromised bundle
  // reach for silently.
  [
    "permissions-policy",
    "accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), " +
      "magnetometer=(), microphone=(), payment=(), usb=()",
  ],
];

/**
 * The CSP for responses SvelteKit does not render a page for — `/healthz`, a JSON
 * endpoint, an error with no HTML body. They contain no markup and load nothing, so the
 * policy that fits them is the one that permits nothing at all.
 *
 * Static assets are the gap this does not close, and it is accepted rather than worked
 * around: adapter-node serves `client/` and `static/` through its own middleware, ahead
 * of the SvelteKit handler, so no hook of ours ever sees those responses — verified by
 * curling a hashed asset off a real `node build`, which answers with neither a CSP nor
 * `nosniff`. Closing it would mean replacing `node build` with a custom server wrapping
 * `build/handler.js`, in exchange for headers that govern almost nothing: a CSP on a
 * script response does not constrain that script's execution in the page that imported
 * it — the importing page's own CSP does — and every asset GAIN serves is a build
 * artifact, never user content. The reverse proxy is the right place to blanket them.
 * See ARCHITECTURE §3.
 */
export const FALLBACK_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
