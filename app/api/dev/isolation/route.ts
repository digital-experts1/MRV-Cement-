import { runIsolationSuite } from "@/tests/isolation/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Development-only: runs the Directive 03 isolation suite against a fresh in-process database. 404 in production. */
export async function GET() {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const started = Date.now();
  const summary = await runIsolationSuite();
  return Response.json({ ...summary, ms: Date.now() - started, executedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
