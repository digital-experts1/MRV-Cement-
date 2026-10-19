import { MRV_CASES } from "@/tests/mrv/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Development-only: runs the Directive 04/05 pure-logic cases in the server runtime. 404 in production. */
export async function GET() {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const results = MRV_CASES.map((c) => {
    try {
      c.run();
      return { id: c.id, name: c.name, passed: true };
    } catch (e) {
      return { id: c.id, name: c.name, passed: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  return Response.json(
    { passed: results.filter((x) => x.passed).length, total: results.length, results, executedAt: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } }
  );
}
