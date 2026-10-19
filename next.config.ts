import type { NextConfig } from "next";

/**
 * Development/test endpoints (app/api/dev/*, app/dev/*) import their implementation only inside an
 * `if (process.env.NODE_ENV === "development")` branch, which the production build evaluates statically and drops, so
 * production bundles contain no test runners, fixture generators, test-session sign-in or secret rotation. The
 * implementations also carry a runtime guard (lib/server/dev/guard.ts).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  // PGlite ships a WASM Postgres build that must be loaded from node_modules, not bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
