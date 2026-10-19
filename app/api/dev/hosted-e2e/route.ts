export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Development-only endpoint. The implementation is imported only inside the statically-evaluated development branch,
 * so production bundles contain neither the handler nor its fixtures/credentials (see lib/server/dev/guard.ts).
 */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "development") {
    const { GET: handler } = await import("@/lib/server/dev/endpoints/hosted-e2e");
    return handler(req);
  }
  return new Response("Not found", { status: 404 });
}
