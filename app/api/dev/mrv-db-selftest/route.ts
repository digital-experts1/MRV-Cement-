import { runDbCases } from "@/tests/mrv/dbHarness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Development-only: runs the Directive 06 database cases against a fresh in-process PostgreSQL. 404 in production. */
export async function GET() {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const started = Date.now();
  const res = await runDbCases();
  return Response.json({ ...res, ms: Date.now() - started, executedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
