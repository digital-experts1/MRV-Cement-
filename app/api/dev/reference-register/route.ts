import { syntheticRegister } from "@/tests/mrv/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Development-only: independent reference vs application on the SYNTHETIC fixture (not real-Q1 validation). 404 in production. */
export async function GET() {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  return Response.json({ dataset: "SYNTHETIC demo fixture", rows: syntheticRegister(), executedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
