import { json } from "@sveltejs/kit";

/**
 * Health endpoint for Portainer/uptime checks (ARCHITECTURE §3). Deliberately
 * outside the auth gate — hooks.server.ts lets `/healthz` through untouched.
 */
export function GET() {
  return json({ status: "ok" });
}
