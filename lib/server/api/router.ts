import type { Principal } from "@/lib/server/authz/authorize";
import { badRequest, HttpError, notFound, unauthenticated } from "@/lib/server/authz/errors";
import { asOwner } from "@/lib/server/db/context";
import { SEED_USERS } from "@/lib/server/db/syntheticSeed";
import type { Caller, ServerDeps } from "@/lib/server/deps";
import { issueSession, readCookie, resolvePrincipal, revokeSession, SESSION_COOKIE } from "@/lib/server/session";
import { aiSearchEvidence, downloadByToken, issueEvidenceDownload, listEvidence } from "@/lib/server/services/evidence";
import { enqueueCalculation } from "@/lib/server/services/jobs";
import { getPortfolio } from "@/lib/server/services/portfolio";
import { createActivityRecord, getActivityRecord, listActivityRecords, listUploads, registerUpload, updateActivityRecord } from "@/lib/server/services/records";
import { decideReport, exportReport, listReports } from "@/lib/server/services/reports";
import { addMember, assignRole, getMe, listFacilities, listMembers, listPeriods, readAuditLog, revokeMember, revokeRole } from "@/lib/server/services/tenancy";

type Params = Record<string, string>;
interface Ctx {
  req: Request;
  url: URL;
  params: Params;
  caller: Caller;
  body: () => Promise<Record<string, unknown>>;
}
type Handler = (ctx: Ctx) => Promise<unknown>;

const MAX_JSON_BYTES = 1_000_000;
const MAX_UPLOAD_BYTES = 20_000_000;

const routes: [string, string, Handler][] = [
  ["GET", "/me", ({ caller }) => getMe(caller)],
  ["GET", "/tenants/:t/facilities", ({ caller, params }) => listFacilities(caller, params.t)],
  ["GET", "/tenants/:t/facilities/:f/periods", ({ caller, params }) => listPeriods(caller, params.t, params.f)],
  ["GET", "/tenants/:t/facilities/:f/activity-records", ({ caller, params, url }) => listActivityRecords(caller, params.t, params.f, url.searchParams.get("periodId"))],
  ["POST", "/tenants/:t/facilities/:f/activity-records", async ({ caller, params, body }) => createActivityRecord(caller, params.t, params.f, await body())],
  ["GET", "/tenants/:t/activity-records/:id", ({ caller, params }) => getActivityRecord(caller, params.t, params.id)],
  ["PATCH", "/tenants/:t/activity-records/:id", async ({ caller, params, body }) => updateActivityRecord(caller, params.t, params.id, await body())],
  ["GET", "/tenants/:t/facilities/:f/evidence", ({ caller, params }) => listEvidence(caller, params.t, params.f)],
  ["POST", "/tenants/:t/evidence/:id/download-url", ({ caller, params }) => issueEvidenceDownload(caller, params.t, params.id)],
  ["GET", "/tenants/:t/facilities/:f/reports", ({ caller, params }) => listReports(caller, params.t, params.f)],
  ["GET", "/tenants/:t/reports/:id/export", ({ caller, params }) => exportReport(caller, params.t, params.id)],
  ["POST", "/tenants/:t/reports/:id/approve", ({ caller, params }) => decideReport(caller, params.t, params.id, "approved")],
  ["GET", "/tenants/:t/facilities/:f/uploads", ({ caller, params }) => listUploads(caller, params.t, params.f)],
  [
    "POST",
    "/tenants/:t/facilities/:f/uploads",
    async ({ caller, params, req, url }) => {
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > MAX_UPLOAD_BYTES) throw badRequest("Upload must be 1 byte – 20 MB");
      return registerUpload(caller, params.t, params.f, { periodId: url.searchParams.get("periodId"), filename: url.searchParams.get("filename") ?? "upload.bin", bytes });
    },
  ],
  ["POST", "/tenants/:t/facilities/:f/calculations", async ({ caller, params, body }) => enqueueCalculation(caller, params.t, params.f, await body())],
  ["POST", "/tenants/:t/facilities/:f/ai/search", async ({ caller, params, body }) => aiSearchEvidence(caller, params.t, params.f, await body())],
  ["GET", "/tenants/:t/portfolio", ({ caller, params, url }) => getPortfolio(caller, params.t, { start: url.searchParams.get("start"), end: url.searchParams.get("end") })],
  ["GET", "/tenants/:t/members", ({ caller, params }) => listMembers(caller, params.t)],
  ["POST", "/tenants/:t/members", async ({ caller, params, body }) => addMember(caller, params.t, await body())],
  ["DELETE", "/tenants/:t/members/:id", ({ caller, params }) => revokeMember(caller, params.t, params.id)],
  ["POST", "/tenants/:t/role-assignments", async ({ caller, params, body }) => assignRole(caller, params.t, await body())],
  ["DELETE", "/tenants/:t/role-assignments/:id", ({ caller, params }) => revokeRole(caller, params.t, params.id)],
  ["GET", "/tenants/:t/audit-log", ({ caller, params }) => readAuditLog(caller, params.t)],
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

const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

function sessionCookie(token: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

const devOnly = () => process.env.NODE_ENV !== "production";

/**
 * Single dispatcher for /api/v1. The Next.js route and the isolation tests call this same function, so direct API
 * calls are subject to exactly the same authentication and authorization as the UI.
 */
export async function dispatch(deps: ServerDeps, req: Request, path: string): Promise<Response> {
  try {
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      const origin = req.headers.get("origin");
      if (origin && new URL(origin).host !== new URL(req.url).host) return json(403, { error: "Cross-origin request rejected" });
    }

    // Development-only synthetic sign-in (no identity provider is configured yet). 404 in production.
    if (path === "/dev/users" && method === "GET") {
      if (!devOnly()) throw notFound();
      return json(200, Object.values(SEED_USERS).map((u) => ({ email: u.email, name: u.name })));
    }
    if (path === "/auth/dev-login" && method === "POST") {
      if (!devOnly()) throw notFound();
      const body = (await req.json().catch(() => ({}))) as { email?: unknown };
      if (typeof body.email !== "string") throw badRequest("email is required");
      const userId = await asOwner(deps.db, async (sql) => {
        const r = await sql.query<{ id: string }>("SELECT id FROM app_user WHERE lower(email) = lower($1) AND status = 'active' AND auth_subject LIKE 'synthetic|%'", [body.email]);
        return r.rows[0]?.id ?? null;
      });
      if (!userId) throw notFound();
      const token = await issueSession(deps.db, userId);
      return json(200, { ok: true }, { "set-cookie": sessionCookie(token, 8 * 3600) });
    }
    const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
    if (path === "/auth/logout" && method === "POST") {
      if (token) await revokeSession(deps.db, token);
      return json(200, { ok: true }, { "set-cookie": sessionCookie("", 0) });
    }

    // Every other route: authenticate on every request (no cached authorization).
    const principal: Principal | null = await resolvePrincipal(deps.db, token);
    if (!principal) throw unauthenticated();
    const caller: Caller = { deps, principal };

    const dl = match("/downloads/:token", path);
    if (dl && method === "GET") {
      const file = await downloadByToken(caller, dl.token);
      return new Response(new Blob([file.bytes as Uint8Array<ArrayBuffer>]), {
        status: 200,
        headers: {
          "content-type": file.mime,
          "cache-control": "private, no-store",
          "content-disposition": `attachment; filename="${file.title.replace(/[^\w.\- ()]/g, "_")}.txt"`,
          "x-content-type-options": "nosniff",
        },
      });
    }

    for (const [m, pattern, handler] of routes) {
      if (m !== method) continue;
      const params = match(pattern, path);
      if (!params) continue;
      const url = new URL(req.url);
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
      return json(200, await handler({ req, url, params, caller, body }));
    }
    throw notFound();
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message });
    // Database constraint violations (e.g. cross-tenant FK) surface as a generic 400 without internal detail.
    const code = (err as { code?: string } | null)?.code;
    if (code && /^(23|42501|22)/.test(code)) return json(400, { error: "Request violates a data constraint" });
    console.error("[api] unhandled error", err);
    return json(500, { error: "Internal error" });
  }
}
