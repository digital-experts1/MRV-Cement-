import { q1Reconciliation } from "@/tests/reference/q1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Development-only: Q1 2025 (DEMO-labelled) workbook reconciliation — workbook vs independent reference vs application. */
export async function GET() {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  try {
    return Response.json(q1Reconciliation(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
