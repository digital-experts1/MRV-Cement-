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

/**
 * Runtime dependencies for API routes. Development uses an ephemeral in-process PostgreSQL seeded with synthetic
 * tenants. Production has no database adapter yet (provider not selected), so tenant APIs return 503 rather than
 * falling back to anything insecure.
 */
export function getServerDeps(): Promise<ServerDeps> {
  if (process.env.NODE_ENV === "production") {
    return Promise.reject(new HttpError(503, "Tenant persistence is not configured in this deployment"));
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
