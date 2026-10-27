/**
 * Supabase-backed MRV services (Directives 04–06). Every call runs with the signed-in user's JWT: reads are filtered by
 * RLS. Imports and calculation runs are produced here (parsing, validation, the authoritative engine) and persisted only
 * through executor-signed RPCs that re-check permissions and independently verify inputs (0003). The browser never
 * submits authoritative values.
 */
import { calculateStore } from "@/lib/calcEngine";
import { parseDataPackage } from "@/lib/dataPackage";
import { toIsoDate } from "@/lib/dates";
import { parseWorkbook } from "@/lib/parser";
import { createSampleDataset } from "@/lib/sampleData";
import { createEmptyInput, type DataOrigin, type MrvInput, type RowSource, type Store } from "@/lib/types";
import { badRequest, forbidden, HttpError, isUuid, notFound } from "@/lib/server/authz/errors";
import { PRIVATE_BUCKET } from "@/integrations/supabase/client";
import type { MrvCaller } from "@/lib/server/supabase/auth";
import { addDays, isValidTimezone, resolveRange, validateSpec, type RangeSpec, type ResolvedRange } from "@/lib/mrv/dateRanges";
import { MAPPING_VERSION, parseMapping, type ImportMapping } from "@/lib/mrv/importMapping";
import { toConfigDrafts, toReadingDrafts, type StoredReading } from "@/lib/mrv/readings";
import type { Coverage } from "@/lib/mrv/rangeSelection";
import { effectivePeriod, importBody, planRun, type ConfigDoc } from "@/lib/mrv/executorPayload";
import { signExecutorRequest, type ExecutorPurpose } from "@/lib/mrv/executorSign";
import { checkRunIntegrity, ENGINE_VERSION, restoreStore, type RunIntegrity, type RunResults } from "@/lib/mrv/snapshot";
import { sha256Bytes } from "@/lib/mrv/sha";
import { dbFail, fetchAll } from "./db";
import { executorKey } from "./executor";

export interface FacilityView {
  id: string;
  code: string;
  name: string;
  timezone: string;
  reporting_boundary: string;
  permissions: string[];
}

export interface RunMeta {
  id: string;
  range_start: string;
  range_end: string;
  range_label: string;
  timezone: string;
  engine_version: string;
  methodology_version: string;
  input_sha256: string;
  results_sha256: string | null;
  dependency_sha256: string | null;
  qa_overall: string;
  synthetic: boolean;
  created_at: string;
  created_by_me: boolean;
  coverage: Coverage;
  stale: { reason: string; at: string } | null;
  integrity: RunIntegrity;
  readings: number;
}

export interface RunView {
  run: RunMeta;
  store: Store;
}

function ids(t: unknown, f?: unknown) {
  if (!isUuid(t) || (f !== undefined && !isUuid(f))) throw notFound();
}

async function can(caller: MrvCaller, t: string, f: string | null, permission: string): Promise<boolean> {
  const { data, error } = await caller.db.rpc("mrv_has_permission", { p_tenant: t, p_facility: f, p_permission: permission });
  if (error) throw dbFail(error);
  return data === true;
}

/** 404 when the facility is invisible to the caller (no probing), 403 when visible but the permission is missing. */
async function requireFacility(caller: MrvCaller, t: string, f: string, permission: string) {
  ids(t, f);
  const { data, error } = await caller.db
    .from("facility")
    .select("id, code, name, timezone, tenant:tenant_id (id, synthetic, fiscal_year_start_month)")
    .eq("tenant_id", t)
    .eq("id", f)
    .maybeSingle();
  if (error) throw dbFail(error);
  if (!data) throw notFound();
  if (permission !== "facility.read" && !(await can(caller, t, f, permission))) throw forbidden(`Missing permission ${permission}`);
  const tenant = (Array.isArray(data.tenant) ? data.tenant[0] : data.tenant) as { synthetic: boolean; fiscal_year_start_month: number } | null;
  return {
    id: data.id as string,
    code: data.code as string,
    name: data.name as string,
    timezone: data.timezone as string,
    synthetic: Boolean(tenant?.synthetic),
    fiscalYearStartMonth: tenant?.fiscal_year_start_month ?? 1,
  };
}

// ───────────────────────── Identity / scope ─────────────────────────
export async function getMe(caller: MrvCaller) {
  const { data, error } = await caller.db.from("tenant").select("id, name, synthetic").order("name").order("id");
  if (error) throw dbFail(error);
  const pref = await caller.db.from("workspace_preference").select("tenant_id, facility_id, range").maybeSingle();
  if (pref.error) throw dbFail(pref.error);
  return {
    user: caller.user,
    organizations: (data ?? []).map((t) => ({ tenantId: t.id as string, name: t.name as string, synthetic: Boolean(t.synthetic) })),
    preference: pref.data ? { tenantId: pref.data.tenant_id, facilityId: pref.data.facility_id, range: validateSpec(pref.data.range) } : null,
  };
}

export async function createOrganization(caller: MrvCaller, body: Record<string, unknown>) {
  const allowed = ["name", "facilityCode", "facilityName", "timezone", "synthetic"];
  if (Object.keys(body).some((k) => !allowed.includes(k))) throw badRequest("Unknown field");
  const { name, facilityCode, facilityName, timezone, synthetic } = body;
  if (typeof name !== "string" || name.trim().length < 2 || name.length > 120) throw badRequest("Organization name must be 2–120 characters");
  if (typeof facilityCode !== "string" || !/^[A-Za-z0-9_-]{1,20}$/.test(facilityCode.trim())) throw badRequest("Factory code: 1–20 letters, digits, - or _");
  if (typeof facilityName !== "string" || facilityName.trim().length < 2 || facilityName.length > 120) throw badRequest("Factory name must be 2–120 characters");
  if (typeof timezone !== "string" || !isValidTimezone(timezone)) throw badRequest("Unknown timezone");
  if (synthetic !== undefined && typeof synthetic !== "boolean") throw badRequest("synthetic must be boolean");
  const { data, error } = await caller.db.rpc("mrv_create_organization", {
    p_name: name, p_facility_code: facilityCode, p_facility_name: facilityName, p_timezone: timezone, p_synthetic: synthetic === true,
  });
  if (error) throw dbFail(error);
  return { tenantId: data as string };
}

export async function listFacilities(caller: MrvCaller, t: string) {
  ids(t);
  const [fac, perms] = await Promise.all([
    caller.db.from("facility").select("id, code, name, timezone, reporting_boundary").eq("tenant_id", t).order("code").order("id"),
    caller.db.rpc("mrv_my_permissions", { p_tenant: t }),
  ]);
  if (fac.error) throw dbFail(fac.error);
  if (perms.error) throw dbFail(perms.error);
  const rows = (perms.data ?? []) as { facility_id: string | null; permission: string }[];
  if (!rows.length) throw notFound();
  const facilities: FacilityView[] = (fac.data ?? []).map((f) => ({
    id: f.id, code: f.code, name: f.name, timezone: f.timezone, reporting_boundary: f.reporting_boundary,
    permissions: rows.filter((r) => r.facility_id === f.id).map((r) => r.permission).sort(),
  }));
  return { facilities, tenantPermissions: rows.filter((r) => r.facility_id === null).map((r) => r.permission).sort() };
}

export async function facilitySummary(caller: MrvCaller, t: string, f: string) {
  await requireFacility(caller, t, f, "facility.read");
  const { data, error } = await caller.db.rpc("mrv_facility_summary", { p_tenant: t, p_facility: f });
  if (error) throw dbFail(error);
  const s = (Array.isArray(data) ? data[0] : data) ?? {};
  return {
    latestObservation: s.latest_observation ?? null,
    latestImport: s.latest_import ?? null,
    latestCalculation: s.latest_calculation ?? null,
    currentReadings: Number(s.current_readings ?? 0),
  };
}

export async function savePreference(caller: MrvCaller, body: Record<string, unknown>) {
  if (Object.keys(body).some((k) => !["tenantId", "facilityId", "range"].includes(k))) throw badRequest("Unknown field");
  ids(body.tenantId, body.facilityId);
  const range = validateSpec(body.range);
  if (!range) throw badRequest("Invalid range");
  const { error } = await caller.db.rpc("mrv_save_preference", { p_tenant: body.tenantId, p_facility: body.facilityId, p_range: range });
  if (error) {
    if (error.code === "42501") throw notFound();
    throw dbFail(error);
  }
  return { ok: true };
}

export async function listImports(caller: MrvCaller, t: string, f: string) {
  await requireFacility(caller, t, f, "facility.read");
  const { data, error } = await caller.db
    .from("import_batch")
    .select("id, origin, status, filename, sha256, size_bytes, received_at, inserted_count, revised_count, unchanged_count, errors, synthetic, duplicate_of, declared_period_start, declared_period_end")
    .eq("tenant_id", t)
    .eq("facility_id", f)
    .order("received_at", { ascending: false })
    .order("id")
    .limit(50);
  if (error) throw dbFail(error);
  return data ?? [];
}

// ───────────────────────── Trusted executor ─────────────────────────
async function executorRpc<T>(caller: MrvCaller, fn: string, purpose: ExecutorPurpose, t: string, f: string, body: string): Promise<T> {
  const auth = signExecutorRequest(executorKey(), purpose, { userId: caller.user.id, tenantId: t, facilityId: f }, body);
  const { data, error } = await caller.db.rpc(fn, { p_tenant: t, p_facility: f, p_body: body, p_auth: auth });
  if (error) throw dbFail(error);
  return data as T;
}

// ───────────────────────── Imports ─────────────────────────
export interface ImportOutcomeView {
  accepted: boolean;
  status: "accepted" | "rejected" | "duplicate";
  batchId: string;
  errors: string[];
  counts: { inserted: number; revised: number; unchanged: number };
  duplicateOf: string | null;
  /** Reporting period the stored readings cover (declared, or the span of the readings). */
  period: { start: string; end: string } | null;
  run: RunView | null;
  runNote: string | null;
}

function declaredPeriod(input: MrvInput): { start: string; end: string } | null {
  const s = toIsoDate(input.setup["Period start"]);
  const e = toIsoDate(input.setup["Period end"]);
  return s && e && e >= s ? { start: s, end: e } : null;
}

const safeName = (name: string) => name.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "upload.bin";

async function recordImport(
  caller: MrvCaller,
  ctx: Awaited<ReturnType<typeof requireFacility>>,
  t: string,
  f: string,
  args: { origin: DataOrigin; candidate: Store; filename: string | null; bytes?: Uint8Array; mime?: string; mapping: ImportMapping | null }
): Promise<ImportOutcomeView> {
  executorKey(); // fail before storing anything when the trusted executor is unavailable
  const { candidate, origin } = args;
  const batchId = crypto.randomUUID();
  let errors = candidate._valid ? [] : candidate._errors.length ? candidate._errors : ["The file could not be validated."];
  const drafts = candidate._valid ? toReadingDrafts(candidate.inputs, args.mapping, `${origin}:${args.filename ?? "entry"}`) : { readings: [], errors: [] };
  errors = [...errors, ...drafts.errors];
  if (!errors.length && drafts.readings.length === 0) errors.push("The file contains no readings.");
  if (!errors.length && candidate.meta.synthetic && !ctx.synthetic) {
    errors.push("Synthetic demo data can only be stored in an organization marked as synthetic.");
  }
  const sha = args.bytes ? sha256Bytes(args.bytes) : null;

  let storagePath: string | null = null;
  if (args.bytes && sha) {
    const dup = errors.length
      ? null
      : await caller.db.from("import_batch").select("id").eq("tenant_id", t).eq("facility_id", f).eq("status", "accepted").eq("sha256", sha).limit(1).maybeSingle();
    if (dup?.error) throw dbFail(dup.error);
    if (!dup?.data) {
      storagePath = `${t}/${f}/imports/${batchId}/${safeName(args.filename ?? "upload.bin")}`;
      const up = await caller.db.storage.from(PRIVATE_BUCKET).upload(storagePath, args.bytes, { contentType: args.mime ?? "application/octet-stream", upsert: false });
      if (up.error) {
        console.error("[mrv] storage upload failed", { message: up.error.message });
        throw new HttpError(403, "Original file could not be stored; nothing was imported");
      }
    }
  }

  const period = candidate._valid ? declaredPeriod(candidate.inputs) : null;
  const eff = errors.length ? null : effectivePeriod(period, drafts.readings);
  const body = importBody(
    {
      id: batchId,
      origin,
      status: errors.length ? "rejected" : "accepted",
      filename: args.filename,
      sha256: sha,
      size_bytes: args.bytes?.byteLength ?? null,
      mime: args.mime ?? null,
      storage_path: storagePath,
      errors,
      assertions: candidate.assertions ?? [],
      declared_period_start: period?.start ?? null,
      declared_period_end: period?.end ?? null,
      synthetic: candidate.meta.synthetic,
      mapping: args.mapping,
      effective_from: eff?.from ?? null,
      effective_to: eff?.to ?? null,
      effective_basis: eff?.basis ?? null,
    },
    errors.length ? [] : drafts.readings,
    errors.length ? [] : toConfigDrafts(candidate.inputs)
  );
  const res = await executorRpc<{ batch_id: string; status: ImportOutcomeView["status"]; inserted: number; revised: number; unchanged: number; duplicate_of?: string | null }>(
    caller, "mrv_import_v2", "import", t, f, body
  );
  const outcome: ImportOutcomeView = {
    accepted: res.status !== "rejected",
    status: res.status,
    batchId: res.batch_id,
    errors,
    counts: { inserted: res.inserted, revised: res.revised, unchanged: res.unchanged },
    duplicateOf: res.duplicate_of ?? null,
    period: res.status !== "rejected" && eff ? { start: eff.from, end: eff.to } : null,
    run: null,
    runNote: null,
  };
  if (res.status === "rejected" || !eff) return outcome;

  // Recalculate the period the import declares (or the span of its readings) so the user sees the stored result.
  if (!(await can(caller, t, f, "calculation.run"))) {
    outcome.runNote = "Imported. You do not have permission to run calculations; an MRV analyst or facility manager must calculate.";
    return outcome;
  }
  // The readings are already committed: a failed follow-up calculation must not report the import itself as failed.
  try {
    const calc = await calculateRange(caller, t, f, { preset: "custom", start: eff.from, end: eff.to }, {
      triggerBatchId: res.status === "accepted" ? res.batch_id : null,
      assertions: res.status === "accepted" && period ? candidate.assertions : [],
    });
    outcome.run = calc.view;
    outcome.runNote = calc.note;
  } catch (e) {
    if (!(e instanceof HttpError)) console.error("[mrv] post-import calculation failed", { message: e instanceof Error ? e.message : "unknown" });
    outcome.runNote = `Readings were stored, but the calculation for this period failed: ${e instanceof HttpError ? e.message : "internal error"}. Use Recalculate once the problem is resolved.`;
  }
  return outcome;
}

function mappingArg(value: unknown): ImportMapping | null {
  if (value === null || value === undefined || value === "") return null;
  const m = parseMapping(value);
  if (!m) throw badRequest("Unknown import mapping");
  return m;
}

export async function importFile(caller: MrvCaller, t: string, f: string, file: { filename: string; bytes: Uint8Array; mapping: unknown }) {
  const ctx = await requireFacility(caller, t, f, "upload.create");
  const mapping = mappingArg(file.mapping);
  const name = file.filename;
  const isJson = /\.json$/i.test(name);
  if (!isJson && !/\.(xlsx|xlsm)$/i.test(name)) throw badRequest("Choose an .xlsx/.xlsm workbook or a TRACE FORCE MRV data export (.json)");
  const buf = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer;
  const candidate = isJson ? parseDataPackage(new TextDecoder().decode(file.bytes), name) : parseWorkbook(buf, name);
  const mime = isJson ? "application/json" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return recordImport(caller, ctx, t, f, { origin: isJson ? "data-package" : "workbook", candidate, filename: name, bytes: file.bytes, mime, mapping });
}

function asInput(value: unknown): MrvInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest("input must be an object");
  const v = value as Record<string, unknown>;
  const base = createEmptyInput("manual");
  const allowed = Object.keys(base);
  if (Object.keys(v).some((k) => !allowed.includes(k))) throw badRequest("Unknown input section");
  for (const k of allowed) {
    if (k === "meta" || k === "setup") continue;
    if (v[k] !== undefined && !Array.isArray(v[k])) throw badRequest(`${k} must be an array`);
  }
  if (v.setup !== undefined && (typeof v.setup !== "object" || v.setup === null || Array.isArray(v.setup))) throw badRequest("setup must be an object");
  const meta = (v.meta ?? {}) as Record<string, unknown>;
  return { ...base, ...(v as Partial<MrvInput>), meta: { origin: "manual", synthetic: meta.synthetic === true, filename: "Online entry", importedAt: new Date().toISOString() } };
}

export async function importManual(caller: MrvCaller, t: string, f: string, body: Record<string, unknown>) {
  if (Object.keys(body).some((k) => k !== "input" && k !== "mapping")) throw badRequest("Unknown field");
  const ctx = await requireFacility(caller, t, f, "upload.create");
  const mapping = mappingArg(body.mapping);
  const input = asInput(body.input);
  // Rows entered online get manual provenance; edited workbook rows keep their previous provenance chain.
  for (const s of ["production", "rawMaterial", "kilnFuel", "electricity", "inventory"] as const) {
    input[s] = input[s].map((r) => (r._source ? r : { ...r, _source: { origin: "manual" } satisfies RowSource }));
  }
  return recordImport(caller, ctx, t, f, { origin: "manual", candidate: calculateStore(input, "manual"), filename: "Online entry", mapping });
}

export async function importDemo(caller: MrvCaller, t: string, f: string) {
  const ctx = await requireFacility(caller, t, f, "upload.create");
  if (!ctx.synthetic) throw badRequest("Synthetic demo data can only be loaded into an organization marked as synthetic.");
  // Documented source metadata of the synthetic fixture: every row is the total of the calendar month of its Date.
  return recordImport(caller, ctx, t, f, {
    origin: "demo",
    candidate: calculateStore(createSampleDataset(), "demo"),
    filename: "SYNTHETIC_DEMO_DATASET",
    mapping: { version: MAPPING_VERSION, interval: "calendar_month_of_date" },
  });
}

export async function withdrawReading(caller: MrvCaller, t: string, f: string, readingId: string, body: Record<string, unknown>) {
  if (Object.keys(body).some((k) => k !== "reason")) throw badRequest("Unknown field");
  await requireFacility(caller, t, f, "upload.create");
  if (!isUuid(readingId)) throw notFound();
  if (typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.length > 500) throw badRequest("A reason (3–500 characters) is required");
  const id = await executorRpc<string>(caller, "mrv_withdraw_reading", "withdraw", t, f, JSON.stringify({ reading_id: readingId, reason: body.reason.trim() }));
  return { revisionId: id };
}

/** Every revision of a reading's source record (oldest first), including a superseded legacy (pre-mapping) revision. */
export async function readingHistory(caller: MrvCaller, t: string, f: string, readingId: string) {
  await requireFacility(caller, t, f, "facility.read");
  if (!isUuid(readingId)) throw notFound();
  const cols = "id, section, record_key, revision, is_current, quality_state, interval_start, interval_end, granularity, measurement_type, mapping_version, interval_basis, payload, batch_id, supersedes_id, received_at, superseded_at";
  const one = await caller.db.from("activity_reading").select("section, record_key").eq("tenant_id", t).eq("facility_id", f).eq("id", readingId).maybeSingle();
  if (one.error) throw dbFail(one.error);
  if (!one.data) throw notFound();
  const { data, error } = await caller.db
    .from("activity_reading")
    .select(cols)
    .eq("tenant_id", t)
    .eq("facility_id", f)
    .eq("section", one.data.section)
    .eq("record_key", one.data.record_key)
    .order("revision");
  if (error) throw dbFail(error);
  const revisions = (data ?? []) as { supersedes_id: string | null; record_key: string }[];
  const firstPrev = revisions[0]?.supersedes_id;
  if (firstPrev) {
    const prev = await caller.db.from("activity_reading").select(cols).eq("tenant_id", t).eq("facility_id", f).eq("id", firstPrev).maybeSingle();
    if (prev.error) throw dbFail(prev.error);
    if (prev.data) revisions.unshift(prev.data as (typeof revisions)[number]);
  }
  return revisions;
}

export async function listReportImpacts(caller: MrvCaller, t: string, f: string) {
  await requireFacility(caller, t, f, "facility.read");
  const { data, error } = await caller.db
    .from("report_impact")
    .select("id, report_id, run_id, batch_id, reason, created_at")
    .eq("tenant_id", t)
    .eq("facility_id", f)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw dbFail(error);
  return data ?? [];
}

// ───────────────────────── Calculations ─────────────────────────
type ReadingRow = StoredReading & { synthetic: boolean };

const READING_COLUMNS =
  "id, section, series_key, record_key, observed_on, interval_start, interval_end, granularity, measurement_type, mapping_version, quality_state, payload, synthetic, revision";

/** Every CURRENT reading overlapping the range (incl. withdrawn/legacy): selection reports exclusions; the DB pins the set. */
async function loadReadings(caller: MrvCaller, t: string, f: string, range: ResolvedRange): Promise<ReadingRow[]> {
  return fetchAll<ReadingRow>((from, to) =>
    caller.db
      .from("activity_reading")
      .select(READING_COLUMNS, { count: "exact" })
      .eq("tenant_id", t)
      .eq("facility_id", f)
      .eq("is_current", true)
      .lte("interval_start", range.end)
      .gte("interval_end", range.start)
      .order("id")
      .range(from, to) as unknown as PromiseLike<{ data: ReadingRow[] | null; error: never; count: number | null }>
  );
}

/** Series expected per meter/material: every mapped, accepted series seen in the 12 months up to the range end. */
async function loadExpectedSeries(caller: MrvCaller, t: string, f: string, range: ResolvedRange): Promise<Record<string, string[]>> {
  const rows = await fetchAll<{ section: string; series_key: string }>((from, to) =>
    caller.db
      .from("activity_reading")
      .select("id, section, series_key", { count: "exact" })
      .eq("tenant_id", t)
      .eq("facility_id", f)
      .eq("is_current", true)
      .eq("quality_state", "accepted")
      .not("mapping_version", "is", null)
      .in("section", ["electricity", "rawMaterial"])
      .lte("interval_start", range.end)
      .gte("interval_end", addDays(range.end, -365))
      .order("id")
      .range(from, to) as unknown as PromiseLike<{ data: { section: string; series_key: string }[] | null; error: never; count: number | null }>
  );
  const out: Record<string, string[]> = {};
  for (const r of rows) out[r.section] = [...new Set([...(out[r.section] ?? []), r.series_key])];
  return out;
}

async function loadConfigDocs(caller: MrvCaller, t: string, f: string): Promise<ConfigDoc[]> {
  return fetchAll<ConfigDoc>((from, to) =>
    caller.db
      .from("config_document")
      .select("id, kind, content, effective_from, effective_to, created_at", { count: "exact" })
      .eq("tenant_id", t)
      .eq("facility_id", f)
      .order("created_at")
      .order("id")
      .range(from, to) as unknown as PromiseLike<{ data: ConfigDoc[] | null; error: never; count: number | null }>
  );
}

export async function calculateRange(
  caller: MrvCaller,
  t: string,
  f: string,
  specInput: unknown,
  opts: { triggerBatchId?: string | null; assertions?: Store["assertions"] } = {}
): Promise<{ view: RunView | null; coverage: Coverage; note: string | null; range: ResolvedRange }> {
  const ctx = await requireFacility(caller, t, f, "calculation.run");
  const spec = validateSpec(specInput);
  if (!spec) throw badRequest("Invalid date range");
  const range = resolveRange(spec, { timezone: ctx.timezone, fiscalYearStartMonth: ctx.fiscalYearStartMonth });

  // A concurrent import between loading and finalizing is detected by the database (MRV09 → 409): reload and retry.
  for (let attempt = 1; ; attempt++) {
    const [readings, docs, expectedSeries] = await Promise.all([
      loadReadings(caller, t, f, range),
      loadConfigDocs(caller, t, f),
      loadExpectedSeries(caller, t, f, range),
    ]);
    const plan = planRun({ readings, docs, range, facility: ctx, expectedSeries, triggerBatchId: opts.triggerBatchId, assertions: opts.assertions });
    if (plan.kind === "none") return { view: null, coverage: plan.coverage, range, note: plan.note };

    // Same range, same pinned readings/considered set/config versions/engine/methodology/policies → reuse the stored run.
    const existing = await caller.db
      .from("calculation_run")
      .select("id, run_invalidation (id)")
      .eq("tenant_id", t)
      .eq("facility_id", f)
      .eq("dependency_sha256", plan.dependencySha)
      .eq("engine_version", ENGINE_VERSION)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing.error) throw dbFail(existing.error);
    if (existing.data && !(existing.data.run_invalidation as unknown[] | null)?.length) {
      return { view: await loadRun(caller, t, f, existing.data.id as string), coverage: plan.coverage, range, note: "Existing calculation reused (all inputs, versions and policies unchanged)." };
    }

    try {
      const runId = await executorRpc<string>(caller, "mrv_finalize_run", "run", t, f, plan.body);
      return { view: await loadRun(caller, t, f, runId), coverage: plan.coverage, range, note: null };
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 409) || attempt >= 3) throw e;
    }
  }
}

const RUN_COLUMNS =
  "id, range_start, range_end, range_label, timezone, engine_version, methodology_version, input_sha256, results_sha256, dependency_sha256, qa_overall, synthetic, created_at, created_by, coverage, input_snapshot, results, results_fingerprint, run_invalidation (reason, created_at)";

export async function loadRun(caller: MrvCaller, t: string, f: string, runId: string): Promise<RunView> {
  ids(t, f);
  if (!isUuid(runId)) throw notFound();
  const { data, error } = await caller.db.from("calculation_run").select(RUN_COLUMNS).eq("tenant_id", t).eq("facility_id", f).eq("id", runId).maybeSingle();
  if (error) throw dbFail(error);
  if (!data) throw notFound();
  return toRunView(caller, data as unknown as RunRow);
}

interface RunRow {
  id: string;
  range_start: string;
  range_end: string;
  range_label: string;
  timezone: string;
  engine_version: string;
  methodology_version: string;
  input_sha256: string;
  results_sha256: string | null;
  dependency_sha256: string | null;
  qa_overall: string;
  synthetic: boolean;
  created_at: string;
  created_by: string;
  coverage: Coverage;
  input_snapshot: MrvInput;
  results: RunResults;
  results_fingerprint: string;
  run_invalidation: { reason: string; created_at: string }[] | null;
}

function withRunRef(store: Store, row: RunRow, stale: boolean): Store {
  return {
    ...store,
    meta: {
      ...store.meta,
      run: { id: row.id, input_sha256: row.input_sha256, results_sha256: row.results_sha256, engine_version: row.engine_version, created_at: row.created_at, stale },
    },
  };
}

function toRunView(caller: MrvCaller, row: RunRow): RunView {
  const inv = (row.run_invalidation ?? []).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0];
  return {
    run: {
      id: row.id,
      range_start: row.range_start,
      range_end: row.range_end,
      range_label: row.range_label,
      timezone: row.timezone,
      engine_version: row.engine_version,
      methodology_version: row.methodology_version,
      input_sha256: row.input_sha256,
      results_sha256: row.results_sha256,
      dependency_sha256: row.dependency_sha256,
      qa_overall: row.qa_overall,
      synthetic: row.synthetic,
      created_at: row.created_at,
      created_by_me: row.created_by === caller.user.id,
      coverage: row.coverage,
      stale: inv ? { reason: inv.reason, at: inv.created_at } : null,
      integrity: checkRunIntegrity(row),
      readings: row.coverage?.includedCount ?? 0,
    },
    // Stored results are displayed as finalized — never replaced by a recomputation with the current engine.
    store: withRunRef(restoreStore(row.input_snapshot, row.results), row, !!inv),
  };
}

/**
 * Latest stored run for exactly this range, or — without a range — the factory's most recent stored run (to recover
 * from an empty reporting period). Read-only: never needs the calculation executor.
 */
export async function latestRun(caller: MrvCaller, t: string, f: string, specInput: unknown) {
  const ctx = await requireFacility(caller, t, f, "facility.read");
  let range: ResolvedRange | null = null;
  if (specInput !== null) {
    const spec = validateSpec(specInput) as RangeSpec | null;
    if (!spec) throw badRequest("Invalid date range");
    range = resolveRange(spec, { timezone: ctx.timezone, fiscalYearStartMonth: ctx.fiscalYearStartMonth });
  }
  let q = caller.db.from("calculation_run").select(RUN_COLUMNS).eq("tenant_id", t).eq("facility_id", f);
  if (range) q = q.eq("range_start", range.start).eq("range_end", range.end);
  const { data, error } = await q.order("created_at", { ascending: false }).order("id").limit(1).maybeSingle();
  if (error) throw dbFail(error);
  return { range, view: data ? toRunView(caller, data as unknown as RunRow) : null };
}

export async function listRuns(caller: MrvCaller, t: string, f: string) {
  await requireFacility(caller, t, f, "facility.read");
  const { data, error } = await caller.db
    .from("calculation_run")
    .select("id, range_start, range_end, range_label, qa_overall, synthetic, created_at, engine_version, run_invalidation (reason)")
    .eq("tenant_id", t)
    .eq("facility_id", f)
    .order("created_at", { ascending: false })
    .order("id")
    .limit(50);
  if (error) throw dbFail(error);
  return (data ?? []).map((r) => ({ ...r, stale: ((r.run_invalidation as { reason: string }[] | null) ?? [])[0]?.reason ?? null, run_invalidation: undefined }));
}
