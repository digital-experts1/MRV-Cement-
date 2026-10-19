import { devGuard } from "@/lib/server/dev/guard";
import { buildWorkbook, SYNTH_PRODUCTION } from "@/tests/fixtures/synthetic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Development-only (excluded from production builds): SYNTHETIC test workbooks (Q1 2025, fictitious values).
 * ?variant=base (default) | corrected (January clinker +1,000 t) | invalid (required production sheet missing).
 */
export async function GET(req: Request) {
  const denied = devGuard(req);
  if (denied) return denied;
  const variant = new URL(req.url).searchParams.get("variant") ?? "base";
  const bytes =
    variant === "corrected"
      ? buildWorkbook({ production: [{ ...SYNTH_PRODUCTION, "Clinker Produced t": 521000, "Clinker Used t": 521200 }] })
      : variant === "invalid"
        ? buildWorkbook({ omitSheet: "03_Production_Input" })
        : variant === "base"
          ? buildWorkbook()
          : null;
  if (!bytes) return Response.json({ error: "variant must be base, corrected or invalid" }, { status: 400 });
  return new Response(bytes, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="SYNTHETIC_TEST_WORKBOOK_Q1_2025_${variant}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
