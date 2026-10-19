import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * Development/test endpoints (`route.dev.ts`, `page.dev.tsx`: test runners, fixture generators, test sessions, secret
 * rotation) are routes only under `next dev`. In any build they are not routes at all (`route.dev` is not a special
 * file name), so production cannot expose them; they also carry a runtime guard (lib/server/dev/guard.ts).
 */
export default function config(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    reactStrictMode: true,
    agentRules: false,
    allowedDevOrigins: ["localhost", "127.0.0.1"],
    pageExtensions: dev ? ["dev.tsx", "dev.ts", "tsx", "ts"] : ["tsx", "ts"],
    // PGlite ships a WASM Postgres build that must be loaded from node_modules, not bundled.
    serverExternalPackages: ["@electric-sql/pglite"],
  };
}
