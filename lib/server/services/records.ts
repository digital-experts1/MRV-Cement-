import { createHash, randomUUID } from "node:crypto";
import { withTenant } from "@/lib/server/authz/authorize";
import { badRequest, isUuid, notFound } from "@/lib/server/authz/errors";
import type { Caller } from "@/lib/server/deps";
import { storageKey } from "@/lib/server/storage";
import { parseStrictNumber } from "@/lib/numeric";
import { ACTIVITY_DOMAINS, writePermissionForDomain, type ActivityDomain } from "@/lib/tenancy/permissions";

const RECORD_COLUMNS =
  "id, tenant_id, facility_id, period_id, domain, activity_type, value::text AS value, unit, value_state, observed_on::text AS observed_on, version";

export interface ActivityRecordRow {
  id: string;
  tenant_id: string;
  facility_id: string;
  period_id: string;
  domain: ActivityDomain;
  activity_type: string;
  value: string | null;
  unit: string;
  value_state: string;
  observed_on: string | null;
  version: number;
}

const CREATE_FIELDS = new Set(["periodId", "domain", "activityType", "value", "unit", "valueState", "observedOn"]);
const UPDATE_FIELDS = new Set(["value", "valueState", "version"]);

/** Rejects unexpected keys (e.g. a smuggled tenant_id/facility_id) instead of silently ignoring them. */
function assertOnlyFields(body: Record<string, unknown>, allowed: Set<string>) {
  const extra = Object.keys(body).filter((k) => !allowed.has(k));
  if (extra.length) throw badRequest(`Unexpected field(s): ${extra.join(", ")}`);
}

function parseValue(valueState: unknown, value: unknown): { state: string; value: string | null } {
  if (valueState === "present") {
    const p = parseStrictNumber(value);
    if (p.kind !== "ok") throw badRequest("value must be an unambiguous number when valueState is 'present'");
    return { state: "present", value: p.value.toString() };
  }
  if (valueState === "zero") return { state: "zero", value: "0" };
  if (valueState === "missing" || valueState === "not_applicable" || valueState === "rejected") return { state: valueState, value: null };
  throw badRequest("Invalid valueState");
}

export function listActivityRecords({ deps, principal }: Caller, tenantId: unknown, facilityId: unknown, periodId?: unknown) {
  return withTenant(deps.db, principal, tenantId, "activity.list", async ({ sql, require, access }) => {
    require(String(facilityId), "facility.read");
    if (periodId !== undefined && periodId !== null && !isUuid(periodId)) throw notFound();
    const r = await sql.query<ActivityRecordRow>(
      `SELECT ${RECORD_COLUMNS} FROM activity_record WHERE tenant_id = $1 AND facility_id = $2 AND ($3::uuid IS NULL OR period_id = $3) ORDER BY activity_type, id`,
      [access.tenantId, facilityId, periodId ?? null]
    );
    return r.rows;
  });
}

export function getActivityRecord({ deps, principal }: Caller, tenantId: unknown, recordId: unknown) {
  return withTenant(deps.db, principal, tenantId, "activity.read", async ({ sql, require, access }) => {
    if (!isUuid(recordId)) throw notFound();
    const r = await sql.query<ActivityRecordRow>(`SELECT ${RECORD_COLUMNS} FROM activity_record WHERE tenant_id = $1 AND id = $2`, [access.tenantId, recordId]);
    const row = r.rows[0];
    if (!row) throw notFound();
    require(row.facility_id, "facility.read");
    return row;
  });
}

export function createActivityRecord({ deps, principal }: Caller, tenantId: unknown, facilityId: unknown, body: Record<string, unknown>) {
  return withTenant(deps.db, principal, tenantId, "activity.create", async ({ sql, require, access, audit }) => {
    assertOnlyFields(body, CREATE_FIELDS);
    const domain = body.domain as ActivityDomain;
    if (!ACTIVITY_DOMAINS.includes(domain)) throw badRequest("Invalid domain");
    require(String(facilityId), writePermissionForDomain(domain));
    if (!isUuid(body.periodId)) throw badRequest("periodId is required");
    if (typeof body.activityType !== "string" || !body.activityType || typeof body.unit !== "string" || !body.unit) {
      throw badRequest("activityType and unit are required");
    }
    const v = parseValue(body.valueState, body.value);
    // The composite FK (tenant, facility, period) rejects a period of another facility/tenant.
    const r = await sql.query<ActivityRecordRow>(
      `INSERT INTO activity_record (tenant_id, facility_id, period_id, domain, activity_type, value, unit, value_state, observed_on, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${RECORD_COLUMNS}`,
      [access.tenantId, facilityId, body.periodId, domain, body.activityType, v.value, body.unit, v.state, body.observedOn ?? null, principal.userId]
    );
    await audit("activity.create", `activity_record:${r.rows[0].id}`, String(facilityId));
    return r.rows[0];
  });
}

export function updateActivityRecord({ deps, principal }: Caller, tenantId: unknown, recordId: unknown, body: Record<string, unknown>) {
  return withTenant(deps.db, principal, tenantId, "activity.update", async ({ sql, require, access, audit }) => {
    assertOnlyFields(body, UPDATE_FIELDS);
    if (!isUuid(recordId)) throw notFound();
    const existing = await sql.query<ActivityRecordRow>(`SELECT ${RECORD_COLUMNS} FROM activity_record WHERE tenant_id = $1 AND id = $2`, [access.tenantId, recordId]);
    const row = existing.rows[0];
    if (!row) throw notFound();
    require(row.facility_id, writePermissionForDomain(row.domain));
    if (body.version !== row.version) throw badRequest("Stale version; reload the record");
    const v = parseValue(body.valueState, body.value);
    const r = await sql.query<ActivityRecordRow>(
      `UPDATE activity_record SET value = $3, value_state = $4, version = version + 1, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING ${RECORD_COLUMNS}`,
      [access.tenantId, recordId, v.value, v.state]
    );
    await audit("activity.update", `activity_record:${recordId}`, row.facility_id);
    return r.rows[0];
  });
}

export function registerUpload(
  { deps, principal }: Caller,
  tenantId: unknown,
  facilityId: unknown,
  input: { periodId: unknown; filename: string; bytes: Uint8Array }
) {
  return withTenant(deps.db, principal, tenantId, "upload.create", async ({ sql, require, access, audit }) => {
    require(String(facilityId), "upload.create");
    if (!isUuid(input.periodId)) throw badRequest("periodId is required");
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    // Deduplication only within this tenant/facility/period; RLS hides every other tenant's uploads.
    const existing = await sql.query<{ id: string }>(
      "SELECT id FROM upload WHERE tenant_id = $1 AND facility_id = $2 AND period_id = $3 AND sha256 = $4",
      [access.tenantId, facilityId, input.periodId, sha256]
    );
    if (existing.rows[0]) return { uploadId: existing.rows[0].id, sha256, duplicate: true };
    const id = randomUUID();
    const key = storageKey(access.tenantId, String(facilityId), "uploads", id);
    await sql.query(
      `INSERT INTO upload (id, tenant_id, facility_id, period_id, filename, sha256, size_bytes, storage_key, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, access.tenantId, facilityId, input.periodId, input.filename.slice(0, 255), sha256, input.bytes.byteLength, key, principal.userId]
    );
    await deps.store.put(key, input.bytes);
    await audit("upload.create", `upload:${id}`, String(facilityId));
    return { uploadId: id, sha256, duplicate: false };
  });
}

export function listUploads({ deps, principal }: Caller, tenantId: unknown, facilityId: unknown) {
  return withTenant(deps.db, principal, tenantId, "upload.list", async ({ sql, require, access }) => {
    require(String(facilityId), "facility.read");
    const r = await sql.query<{ id: string; filename: string; sha256: string }>(
      "SELECT id, filename, sha256 FROM upload WHERE tenant_id = $1 AND facility_id = $2 ORDER BY created_at",
      [access.tenantId, facilityId]
    );
    return r.rows;
  });
}
