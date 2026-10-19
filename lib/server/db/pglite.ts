import { PGlite } from "@electric-sql/pglite";
import type { Database } from "./types";

/**
 * In-process PostgreSQL (PGlite, real Postgres compiled to WASM) for development and isolation tests.
 * Ephemeral: nothing is written to disk and no external/deployed database is touched.
 */
export async function createPgliteDatabase(): Promise<Database> {
  const pg = new PGlite();
  await pg.waitReady;
  return {
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn({
          query: async (text, params) => {
            const r = await tx.query(text, params);
            return { rows: r.rows as never[], affectedRows: r.affectedRows };
          },
          exec: async (text) => {
            await tx.exec(text);
          },
        })
      ),
    close: () => pg.close(),
  };
}
