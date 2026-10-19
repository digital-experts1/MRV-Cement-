export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Development-only endpoint. The implementation is imported only inside the statically-evaluated development branch,
 * so production bundles contain neither the handler nor its fixtures/credentials (see lib/server/dev/guard.ts).
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "development") {
    const { POST: handler } = await import("@/lib/server/dev/endpoints/secret-rotation");
    return handler(req);
  }
  return new Response("Not found", { status: 404 });
}
