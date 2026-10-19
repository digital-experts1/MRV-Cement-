import { createHash, randomUUID } from "node:crypto";
import { withTenant } from "@/lib/server/authz/authorize";
import { badRequest, forbidden, isUuid, notFound } from "@/lib/server/authz/errors";
import type { Caller } from "@/lib/server/deps";
import { storageKey } from "@/lib/server/storage";

export function createEvidence(
  { deps, principal }: Caller,
  tenantId: unknown,
  facilityId: unknown,
  input: { evidenceCode: string; title: string; mime: string; text: string; periodId?: string | null }
) {
  return withTenant(deps.db, principal, tenantId, "evidence.create", async ({ sql, require, access, audit }) => {
    require(String(facilityId), "evidence.write");
    const id = randomUUID();
    const bytes = new TextEncoder().encode(input.text);
    const key = storageKey(access.tenantId, String(facilityId), "evidence", id);
    await sql.query(
      `INSERT INTO evidence (id, tenant_id, facility_id, period_id, evidence_code, title, mime, storage_key, sha256, text_content, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, access.tenantId, facilityId, input.periodId ?? null, input.evidenceCode, input.title, input.mime, key,
        createHash("sha256").update(bytes).digest("hex"), input.text, principal.userId]
    );
    await deps.store.put(key, bytes);
    await audit("evidence.create", `evidence:${id}`, String(facilityId));
    return { evidenceId: id };
  });
}

export function listEvidence({ deps, principal }: Caller, tenantId: unknown, facilityId: unknown) {
  return withTenant(deps.db, principal, tenantId, "evidence.list", async ({ sql, require, access }) => {
    require(String(facilityId), "evidence.read");
    const r = await sql.query<{ id: string; evidence_code: string; title: string; mapping_status: string }>(
      "SELECT id, evidence_code, title, mapping_status FROM evidence WHERE tenant_id = $1 AND facility_id = $2 ORDER BY evidence_code",
      [access.tenantId, facilityId]
    );
    return r.rows;
  });
}

/** Issues a short-lived download URL bound to tenant, facility, object and user. */
export function issueEvidenceDownload({ deps, principal }: Caller, tenantId: unknown, evidenceId: unknown) {
  return withTenant(deps.db, principal, tenantId, "evidence.url", async ({ sql, require, access, audit }) => {
    if (!isUuid(evidenceId)) throw notFound();
    const r = await sql.query<{ facility_id: string }>("SELECT facility_id FROM evidence WHERE tenant_id = $1 AND id = $2", [access.tenantId, evidenceId]);
    const row = r.rows[0];
    if (!row) throw notFound();
    require(row.facility_id, "evidence.read");
    const token = deps.signer.issue({ kind: "evidence", tenantId: access.tenantId, facilityId: row.facility_id, objectId: evidenceId, userId: principal.userId });
    await audit("evidence.url", `evidence:${evidenceId}`, row.facility_id);
    return { url: `/api/v1/downloads/${encodeURIComponent(token)}`, token };
  });
}

/** The signature alone is not sufficient: the current session must belong to the same user and still hold access. */
export async function downloadByToken({ deps, principal }: Caller, token: string) {
  const claims = deps.signer.verify(token);
  if (!claims) throw forbidden("Invalid or expired download link");
  if (claims.userId !== principal.userId) throw forbidden("Download link was issued to a different user");
  if (claims.kind !== "evidence") throw notFound();
  return withTenant(deps.db, principal, claims.tenantId, "evidence.download", async ({ sql, require, access, audit }) => {
    require(claims.facilityId, "evidence.read");
    const r = await sql.query<{ title: string; mime: string; storage_key: string }>(
      "SELECT title, mime, storage_key FROM evidence WHERE tenant_id = $1 AND facility_id = $2 AND id = $3",
      [access.tenantId, claims.facilityId, claims.objectId]
    );
    const row = r.rows[0];
    if (!row) throw notFound();
    const bytes = await deps.store.get(row.storage_key);
    if (!bytes) throw notFound();
    await audit("evidence.download", `evidence:${claims.objectId}`, claims.facilityId);
    return { title: row.title, mime: row.mime, bytes };
  });
}

// ───────────── AI retrieval (advisory only) ─────────────

const AI_TOOL_ARGS = new Set(["query", "limit"]);

/**
 * Evidence retrieval tool exposed to an AI model. Tenant/facility scope comes ONLY from the server-validated
 * session and route; tool arguments chosen by the model may contain a query and limit, nothing else.
 */
export function aiSearchEvidence({ deps, principal }: Caller, tenantId: unknown, facilityId: unknown, toolArgs: Record<string, unknown>) {
  return withTenant(deps.db, principal, tenantId, "ai.retrieve", async ({ sql, require, access, audit }) => {
    require(String(facilityId), "ai.assess");
    const extra = Object.keys(toolArgs).filter((k) => !AI_TOOL_ARGS.has(k));
    if (extra.length) throw badRequest(`AI tool arguments may not set scope (${extra.join(", ")})`);
    if (typeof toolArgs.query !== "string" || !toolArgs.query.trim()) throw badRequest("query is required");
    const limit = typeof toolArgs.limit === "number" ? Math.min(Math.max(1, Math.floor(toolArgs.limit)), 20) : 5;
    const r = await sql.query<{ id: string; tenant_id: string; facility_id: string; evidence_code: string; title: string; text_content: string }>(
      `SELECT id, tenant_id, facility_id, evidence_code, title, text_content FROM evidence
       WHERE tenant_id = $1 AND facility_id = $2 AND (title ILIKE $3 OR text_content ILIKE $3) ORDER BY evidence_code LIMIT $4`,
      [access.tenantId, facilityId, `%${toolArgs.query.replace(/[%_\\]/g, "\\$&")}%`, limit]
    );
    await sql.query(
      `INSERT INTO ai_assessment (tenant_id, facility_id, question, retrieved_evidence_ids, output, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [access.tenantId, facilityId, toolArgs.query, r.rows.map((x) => x.id), `Advisory retrieval: ${r.rows.length} document(s) in scope.`, principal.userId]
    );
    await audit("ai.retrieve", null, String(facilityId), { hits: r.rows.length });
    return r.rows;
  });
}
