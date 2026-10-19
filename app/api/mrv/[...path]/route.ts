import { dispatchMrv } from "@/lib/server/mrv/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return dispatchMrv(req, "/" + path.map(encodeURIComponent).join("/"));
}

export { handle as GET, handle as POST, handle as PUT };
