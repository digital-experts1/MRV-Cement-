import { buildWorkbook } from "@/tests/fixtures/synthetic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Development-only: the SYNTHETIC test workbook (Q1 2025, fictitious values) used by the UI walkthrough. 404 in production. */
export async function GET() {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  return new Response(buildWorkbook(), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="SYNTHETIC_TEST_WORKBOOK_Q1_2025.xlsx"',
      "cache-control": "no-store",
    },
  });
}
