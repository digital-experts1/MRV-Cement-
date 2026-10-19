import type { PostgrestError } from "@supabase/supabase-js";
import { HttpError } from "@/lib/server/authz/errors";

/** Maps database/RPC errors to HTTP errors without leaking internals. */
export function dbFail(error: PostgrestError | { code?: string; message?: string } | null): HttpError {
  const code = error?.code ?? "";
  if (code === "42501" || code === "PGRST301") return new HttpError(403, "Forbidden");
  if (code === "PGRST202" || code === "42883" || code === "42703") {
    return new HttpError(503, "The database schema is older than this application (migration 0003 not applied). Imports and calculations are disabled.");
  }
  // MRV09: inputs changed while a calculation ran (custom SQLSTATE; 40001 would be auto-retried by PostgREST).
  if (code === "MRV09" || code === "40001") return new HttpError(409, error?.message ?? "Data changed during the operation; retry");
  if (code === "22023" || code === "54000") return new HttpError(400, error?.message ?? "Invalid request");
  if (code.startsWith("23") || code.startsWith("22")) return new HttpError(400, "Request violates a data constraint");
  console.error("[mrv] database error", { code, message: error?.message });
  return new HttpError(500, "Database error");
}

interface PageResult<T> {
  data: T[] | null;
  error: PostgrestError | null;
  count: number | null;
}

/**
 * Loads every row of a query in pages and verifies the total against an exact count, so an API row limit can never
 * silently truncate inputs to a calculation. The query must have a deterministic order.
 */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  let total: number | null = null;
  // Advance by rows actually received, so a server-side max-rows cap smaller than pageSize cannot skip rows.
  for (let from = 0; ; from = out.length) {
    const { data, error, count } = await page(from, from + pageSize - 1);
    if (error) throw dbFail(error);
    if (total === null) total = count;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length === 0 || (total !== null && out.length >= total)) break;
    if (out.length > 500_000) throw new HttpError(413, "Range too large to calculate in one request; select a shorter range");
  }
  if (total === null || out.length !== total) throw new HttpError(503, "Readings changed or were truncated while loading; please retry");
  return out;
}
