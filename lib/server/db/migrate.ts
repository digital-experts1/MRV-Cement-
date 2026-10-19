import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Database } from "./types";

/** Applies pending SQL migrations in order. Additive only: applied versions are recorded and never re-run. */
export async function migrate(db: Database, dir = path.join(process.cwd(), "db", "migrations")): Promise<string[]> {
  await db.transaction((sql) =>
    sql.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
  );
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const version = file.replace(/\.sql$/, "");
    const text = readFileSync(path.join(dir, file), "utf8");
    await db.transaction(async (sql) => {
      const done = await sql.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
      if (done.rows.length) return;
      await sql.exec(text);
      await sql.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
      applied.push(version);
    });
  }
  return applied;
}
