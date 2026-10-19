import { dispatch } from "@/lib/server/api/router";
import { HttpError } from "@/lib/server/authz/errors";
import { getServerDeps } from "@/lib/server/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  try {
    const deps = await getServerDeps();
    return dispatch(deps, req, "/" + path.map(encodeURIComponent).join("/"));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return Response.json({ error: err instanceof HttpError ? err.message : "Server unavailable" }, { status, headers: { "cache-control": "no-store" } });
  }
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
