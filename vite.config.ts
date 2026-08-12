import { defineConfig, loadEnv } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

// Test configuration stays in vitest.config.ts: the phase-1/2 suite runs without
// the SvelteKit plugin, exactly as it did before the app existed.
export default defineConfig(({ mode }) => {
  // Reaching the dev server from a phone on the LAN needs two things Vite will
  // not do by default: bind beyond localhost, and accept the hostname the phone
  // asks for. Both are per-developer facts — one machine's hostname is nobody
  // else's — so they live in `.env.local`, which is git-ignored, rather than in
  // this tracked file:
  //
  //     GAIN_DEV_HOSTS=my-desktop.home.arpa
  //
  // Unset — every CI run, every fresh clone — leaves the dev server bound to
  // localhost, which is the right default for a server with an auth bypass in it.
  const env = loadEnv(mode, process.cwd(), "GAIN_");
  const devHosts = (env.GAIN_DEV_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  return {
    plugins: [sveltekit()],
    ...(devHosts.length > 0 ? { server: { host: true, allowedHosts: devHosts } } : {}),
  };
});
