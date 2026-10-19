import { runHostedCases } from "@/tests/hosted/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Development-only: runs the hosted acceptance cases against the designated test project. 404 in production. */
export async function GET() {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const started = Date.now();
  const res = await runHostedCases();
  return Response.json({ ...res, ms: Date.now() - started, executedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
