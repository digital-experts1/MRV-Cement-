import { HttpError } from "@/lib/server/authz/errors";
import { createPgliteDatabase } from "@/lib/server/db/pglite";
import { migrate } from "@/lib/server/db/migrate";
import { seedSynthetic, type SeedOutput } from "@/lib/server/db/syntheticSeed";
import type { ServerDeps } from "@/lib/server/deps";
import { createSigner, signerFromEnv } from "@/lib/server/signing";
import { createMemoryStore } from "@/lib/server/storage";

/** Fresh, isolated in-process database with migrations and SYNTHETIC tenants. Never touches external systems. */
export async function createSyntheticDeps(): Promise<{ deps: ServerDeps; seed: SeedOutput }> {
  const db = await createPgliteDatabase();
  await migrate(db);
  const deps: ServerDeps = { db, store: createMemoryStore(), signer: createSigner("synthetic-test-secret-".padEnd(48, "x")) };
  const seed = await seedSynthetic(deps);
  return { deps, seed };
}

const globalKey = "__traceServerDeps" as const;
type GlobalWithDeps = typeof globalThis & { [globalKey]?: Promise<ServerDeps> };

/** The in-process synthetic backend runs only when explicitly enabled outside production (tests call createSyntheticDeps directly). */
export const syntheticBackendEnabled = () => process.env.NODE_ENV !== "production" && process.env.TRACE_SYNTHETIC_BACKEND === "1";

/**
 * Runtime dependencies for the legacy /api/v1 harness: an ephemeral in-process PostgreSQL seeded with SYNTHETIC tenants.
 * Disabled unless TRACE_SYNTHETIC_BACKEND=1 (development only). The application's real persistence is Supabase
 * (/api/mrv); there is no silent fallback from one to the other.
 */
export function getServerDeps(): Promise<ServerDeps> {
  if (!syntheticBackendEnabled()) {
    return Promise.reject(new HttpError(503, "The synthetic test backend is disabled. Application data is served by /api/mrv (Supabase)."));
  }
  const g = globalThis as GlobalWithDeps;
  if (!g[globalKey]) {
    g[globalKey] = (async () => {
      const { deps } = await createSyntheticDeps();
      return { ...deps, signer: signerFromEnv() };
    })();
    g[globalKey].catch(() => {
      delete g[globalKey];
    });
  }
  return g[globalKey];
}
