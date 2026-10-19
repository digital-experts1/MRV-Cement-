import { badRequest, HttpError, notFound, unauthenticated } from "@/lib/server/authz/errors";
import { authenticateRequest, type MrvCaller } from "@/lib/server/supabase/auth";
import {
  calculateRange, createOrganization, facilitySummary, getMe, importDemo, importFile, importManual, latestRun, listFacilities,
  listImports, listRuns, loadRun, savePreference,
} from "./service";

type Params = Record<string, string>;
interface Ctx {
  url: URL;
  params: Params;
  caller: MrvCaller;
  req: Request;
  body: () => Promise<Record<string, unknown>>;
}
type Handler = (ctx: Ctx) => Promise<unknown>;

const MAX_JSON_BYTES = 5_000_000;
const MAX_UPLOAD_BYTES = 20_000_000;

const rangeFromQuery = (url: URL): unknown => {
  const raw = url.searchParams.get("range");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest("range must be JSON");
  }
};

/** Supabase-backed MRV API (`/api/mrv/*`). Authentication on every request; authorization in the database. */
const routes: [string, string, Handler][] = [
  ["GET", "/me", ({ caller }) => getMe(caller)],
  ["POST", "/orgs", async ({ caller, body }) => createOrganization(caller, await body())],
  ["PUT", "/preference", async ({ caller, body }) => savePreference(caller, await body())],
  ["GET", "/orgs/:t/facilities", ({ caller, params }) => listFacilities(caller, params.t)],
  ["GET", "/orgs/:t/facilities/:f/summary", ({ caller, params }) => facilitySummary(caller, params.t, params.f)],
  ["GET", "/orgs/:t/facilities/:f/imports", ({ caller, params }) => listImports(caller, params.t, params.f)],
  [
    "POST",
    "/orgs/:t/facilities/:f/imports",
    async ({ caller, params, req, url }) => {
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > MAX_UPLOAD_BYTES) throw badRequest("Upload must be 1 byte – 20 MB");
      return importFile(caller, params.t, params.f, { filename: url.searchParams.get("filename") ?? "upload.bin", bytes });
    },
  ],
  ["POST", "/orgs/:t/facilities/:f/manual", async ({ caller, params, body }) => importManual(caller, params.t, params.f, await body())],
  ["POST", "/orgs/:t/facilities/:f/demo", ({ caller, params }) => importDemo(caller, params.t, params.f)],
  ["GET", "/orgs/:t/facilities/:f/runs", ({ caller, params }) => listRuns(caller, params.t, params.f)],
  ["GET", "/orgs/:t/facilities/:f/runs/latest", ({ caller, params, url }) => latestRun(caller, params.t, params.f, rangeFromQuery(url))],
  [
    "POST",
    "/orgs/:t/facilities/:f/runs",
    async ({ caller, params, body }) => {
      const b = await body();
      if (Object.keys(b).some((k) => k !== "range")) throw badRequest("Unknown field");
      return calculateRange(caller, params.t, params.f, b.range);
    },
  ],
  ["GET", "/orgs/:t/facilities/:f/runs/:id", ({ caller, params }) => loadRun(caller, params.t, params.f, params.id)],
];

function match(pattern: string, path: string): Params | null {
  const p = pattern.split("/");
  const s = path.split("/");
  if (p.length !== s.length) return null;
  const out: Params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) {
      if (!s[i]) return null;
      out[p[i].slice(1)] = decodeURIComponent(s[i]);
    } else if (p[i] !== s[i]) return null;
  }
  return out;
}

export async function dispatchMrv(req: Request, path: string): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "private, no-store" });
  const respond = (status: number, data: unknown, cookies: string[] = []) => {
    for (const c of cookies) headers.append("set-cookie", c);
    return new Response(JSON.stringify(data), { status, headers });
  };
  let cookies: string[] = [];
  try {
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      const origin = req.headers.get("origin");
      if (origin && new URL(origin).host !== new URL(req.url).host) return respond(403, { error: "Cross-origin request rejected" });
    }
    const auth = await authenticateRequest(req);
    cookies = auth.setCookies;
    if (!auth.caller) throw unauthenticated();
    const caller = auth.caller;

    // "latest" must win over ":id".
    const ordered = [...routes].sort((a, b) => Number(b[1].endsWith("/latest")) - Number(a[1].endsWith("/latest")));
    for (const [m, pattern, handler] of ordered) {
      if (m !== method) continue;
      const params = match(pattern, path);
      if (!params) continue;
      const body = async () => {
        const text = await req.text();
        if (text.length > MAX_JSON_BYTES) throw badRequest("Request body too large");
        if (!text) return {};
        try {
          const parsed = JSON.parse(text) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
          return parsed as Record<string, unknown>;
        } catch {
          throw badRequest("Body must be a JSON object");
        }
      };
      return respond(200, await handler({ url: new URL(req.url), params, caller, req, body }), cookies);
    }
    throw notFound();
  } catch (err) {
    if (err instanceof HttpError) return respond(err.status, { error: err.message }, cookies);
    console.error("[mrv] unhandled error", err);
    return respond(500, { error: "Internal error" }, cookies);
  }
}
