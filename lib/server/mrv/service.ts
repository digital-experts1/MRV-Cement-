/**
 * Supabase-backed MRV services (Directives 04/05). Every call runs with the signed-in user's JWT: reads are filtered
 * by RLS and writes go through permission-checking RPCs. Calculations always use `calculateStore`.
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
import { isValidTimezone, resolveRange, validateSpec, type RangeSpec, type ResolvedRange } from "@/lib/mrv/dateRanges";
import { CONFIG_KINDS, rebuildInput, toConfigDrafts, toReadingDrafts, type ConfigKind, type StoredReading } from "@/lib/mrv/readings";
import { computeCoverage, requiredSectionsFor, selectForRange, type Coverage } from "@/lib/mrv/rangeSelection";
import {
  checkRunIntegrity, ENGINE_VERSION, inputSha, METHODOLOGY_VERSION, qaOverall, qaRows, restoreStore, resultsFingerprint,
  resultsOf, scopeInputToRange, type RunIntegrity, type RunResults,
} from "@/lib/mrv/snapshot";
import { sha256Bytes } from "@/lib/mrv/sha";
import { dbFail, fetchAll } from "./db";

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

const ORIGINS: DataOrigin[] = ["workbook", "manual", "demo", "data-package"];

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

// ───────────────────────── Imports ─────────────────────────
export interface ImportOutcomeView {
  accepted: boolean;
  status: "accepted" | "rejected" | "duplicate";
  batchId: string;
  errors: string[];
  counts: { inserted: number; revised: number; unchanged: number };
  duplicateOf: string | null;
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
  args: { origin: DataOrigin; candidate: Store; filename: string | null; bytes?: Uint8Array; mime?: string }
): Promise<ImportOutcomeView> {
  const { candidate, origin } = args;
  const batchId = crypto.randomUUID();
  let errors = candidate._valid ? [] : candidate._errors.length ? candidate._errors : ["The file could not be validated."];
  const drafts = candidate._valid ? toReadingDrafts(candidate.inputs) : { readings: [], errors: [] };
  errors = [...errors, ...drafts.errors];
  if (!errors.length && drafts.readings.length === 0) errors.push("The file contains no dated readings.");
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
  const { data, error } = await caller.db.rpc("mrv_record_import", {
    p_tenant: t,
    p_facility: f,
    p_batch: {
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
    },
    p_readings: errors.length ? [] : drafts.readings,
    p_documents: errors.length ? [] : toConfigDrafts(candidate.inputs),
  });
  if (error) throw dbFail(error);
  const res = data as { batch_id: string; status: ImportOutcomeView["status"]; inserted: number; revised: number; unchanged: number; duplicate_of?: string | null };
  const outcome: ImportOutcomeView = {
    accepted: res.status !== "rejected",
    status: res.status,
    batchId: res.batch_id,
    errors,
    counts: { inserted: res.inserted, revised: res.revised, unchanged: res.unchanged },
    duplicateOf: res.duplicate_of ?? null,
    run: null,
    runNote: null,
  };
  if (res.status === "rejected") return outcome;

  // Recalculate the period the import declares (or the span of its readings) so the user sees the stored result.
  const span = period ?? {
    start: drafts.readings.reduce((m, r) => (r.interval_start < m ? r.interval_start : m), drafts.readings[0].interval_start),
    end: drafts.readings.reduce((m, r) => (r.interval_end > m ? r.interval_end : m), drafts.readings[0].interval_end),
  };
  if (!(await can(caller, t, f, "calculation.run"))) {
    outcome.runNote = "Imported. You do not have permission to run calculations; an MRV analyst or facility manager must calculate.";
    return outcome;
  }
  const calc = await calculateRange(caller, t, f, { preset: "custom", start: span.start, end: span.end }, {
    triggerBatchId: res.status === "accepted" ? res.batch_id : null,
    assertions: res.status === "accepted" && period ? candidate.assertions : [],
  });
  outcome.run = calc.view;
  outcome.runNote = calc.note;
  return outcome;
}

export async function importFile(caller: MrvCaller, t: string, f: string, file: { filename: string; bytes: Uint8Array }) {
  const ctx = await requireFacility(caller, t, f, "upload.create");
  const name = file.filename;
  const isJson = /\.json$/i.test(name);
  if (!isJson && !/\.(xlsx|xlsm)$/i.test(name)) throw badRequest("Choose an .xlsx/.xlsm workbook or a TRACE FORCE MRV data export (.json)");
  const buf = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer;
  const candidate = isJson ? parseDataPackage(new TextDecoder().decode(file.bytes), name) : parseWorkbook(buf, name);
  const mime = isJson ? "application/json" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return recordImport(caller, ctx, t, f, { origin: isJson ? "data-package" : "workbook", candidate, filename: name, bytes: file.bytes, mime });
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
  if (Object.keys(body).some((k) => k !== "input")) throw badRequest("Unknown field");
  const ctx = await requireFacility(caller, t, f, "upload.create");
  const input = asInput(body.input);
  // Rows entered online get manual provenance; edited workbook rows keep their previous provenance chain.
  for (const s of ["production", "rawMaterial", "kilnFuel", "electricity", "inventory"] as const) {
    input[s] = input[s].map((r) => (r._source ? r : { ...r, _source: { origin: "manual" } satisfies RowSource }));
  }
  return recordImport(caller, ctx, t, f, { origin: "manual", candidate: calculateStore(input, "manual"), filename: "Online entry" });
}

export async function importDemo(caller: MrvCaller, t: string, f: string) {
  const ctx = await requireFacility(caller, t, f, "upload.create");
  if (!ctx.synthetic) throw badRequest("Synthetic demo data can only be loaded into an organization marked as synthetic.");
  return recordImport(caller, ctx, t, f, { origin: "demo", candidate: calculateStore(createSampleDataset(), "demo"), filename: "SYNTHETIC_DEMO_DATASET" });
}

// ───────────────────────── Calculations ─────────────────────────
interface ReadingRow extends StoredReading {
  synthetic: boolean;
}

async function loadReadings(caller: MrvCaller, t: string, f: string, range: ResolvedRange): Promise<ReadingRow[]> {
  return fetchAll<ReadingRow>((from, to) =>
    caller.db
      .from("activity_reading")
      .select("id, section, series_key, record_key, observed_on, interval_start, interval_end, granularity, payload, synthetic, revision", { count: "exact" })
      .eq("tenant_id", t)
      .eq("facility_id", f)
      .eq("is_current", true)
      .eq("quality_state", "accepted")
      .lte("interval_start", range.end)
      .gte("interval_end", range.start)
      .order("id")
      .range(from, to) as unknown as PromiseLike<{ data: ReadingRow[] | null; error: never; count: number | null }>
  );
}

function dominantOrigin(rows: StoredReading[]): DataOrigin {
  const counts = new Map<DataOrigin, number>();
  for (const r of rows) {
    const o = (r.payload._source as RowSource | undefined)?.origin;
    const origin = o && ORIGINS.includes(o) ? o : "manual";
    counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "manual";
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

  const [readings, cfg] = await Promise.all([loadReadings(caller, t, f, range), caller.db.rpc("mrv_current_config", { p_tenant: t, p_facility: f })]);
  if (cfg.error) throw dbFail(cfg.error);
  const docs = (cfg.data ?? []) as { id: string; kind: ConfigKind; content: unknown }[];
  const config: Partial<Record<ConfigKind, unknown>> = {};
  for (const d of docs) if ((CONFIG_KINDS as readonly string[]).includes(d.kind)) config[d.kind] = d.content;

  const selection = selectForRange(readings, range.start, range.end);
  const setup = (config.setup ?? {}) as Record<string, unknown>;
  const coverage = computeCoverage(selection, range, requiredSectionsFor(setup));
  if (!selection.included.length) {
    return { view: null, coverage, range, note: "No stored readings fall completely inside this range. Nothing was calculated; missing data is not treated as zero." };
  }

  const included = selection.included;
  const synthetic = ctx.synthetic || included.some((r) => r.synthetic);
  const base = rebuildInput(included, config, { origin: dominantOrigin(included), synthetic, filename: `${ctx.code} · ${range.label}`, importedAt: null });
  const input = scopeInputToRange(base, { start: range.start, end: range.end, label: `${range.label} (${range.start} – ${range.end})` });
  const store = calculateStore(input, input.meta.origin);
  store.assertions = opts.assertions ?? [];
  const sha = inputSha(store.inputs);

  // Re-opening the same range with unchanged inputs returns the existing immutable run instead of creating duplicates.
  const existing = await caller.db
    .from("calculation_run")
    .select("id, run_invalidation (id)")
    .eq("tenant_id", t)
    .eq("facility_id", f)
    .eq("range_start", range.start)
    .eq("range_end", range.end)
    .eq("input_sha256", sha)
    .eq("engine_version", ENGINE_VERSION)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw dbFail(existing.error);
  if (existing.data && !(existing.data.run_invalidation as unknown[] | null)?.length) {
    return { view: await loadRun(caller, t, f, existing.data.id as string), coverage, range, note: "Existing calculation reused (inputs unchanged)." };
  }

  const { data: runId, error } = await caller.db.rpc("mrv_record_run", {
    p_tenant: t,
    p_facility: f,
    p_run: {
      kind: "exploratory",
      range_start: range.start,
      range_end: range.end,
      range_label: range.label,
      timezone: range.timezone,
      reporting_profile: "calendar",
      engine_version: ENGINE_VERSION,
      methodology_version: METHODOLOGY_VERSION,
      input_snapshot: store.inputs,
      input_sha256: sha,
      results: resultsOf(store),
      results_fingerprint: resultsFingerprint(store),
      qa_overall: qaOverall(store),
      completeness_pct: store.completeness.pct,
      coverage,
      trigger_batch_id: opts.triggerBatchId ?? null,
    },
    p_reading_ids: included.map((r) => r.id),
    p_document_ids: docs.map((d) => d.id),
    p_qa: qaRows(store),
  });
  if (error) throw dbFail(error);
  return { view: await loadRun(caller, t, f, runId as string), coverage, range, note: null };
}

const RUN_COLUMNS =
  "id, range_start, range_end, range_label, timezone, engine_version, methodology_version, input_sha256, qa_overall, synthetic, created_at, created_by, coverage, input_snapshot, results, results_fingerprint, run_invalidation (reason, created_at)";

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
      qa_overall: row.qa_overall,
      synthetic: row.synthetic,
      created_at: row.created_at,
      created_by_me: row.created_by === caller.user.id,
      coverage: row.coverage,
      stale: inv ? { reason: inv.reason, at: inv.created_at } : null,
      integrity: checkRunIntegrity(row),
      readings: row.coverage?.includedCount ?? 0,
    },
    store: restoreStore(row.input_snapshot, row.results),
  };
}

/** Latest stored run for exactly this range (read-only users can open results without recalculating). */
export async function latestRun(caller: MrvCaller, t: string, f: string, specInput: unknown) {
  const ctx = await requireFacility(caller, t, f, "facility.read");
  const spec = validateSpec(specInput) as RangeSpec | null;
  if (!spec) throw badRequest("Invalid date range");
  const range = resolveRange(spec, { timezone: ctx.timezone, fiscalYearStartMonth: ctx.fiscalYearStartMonth });
  const { data, error } = await caller.db
    .from("calculation_run")
    .select(RUN_COLUMNS)
    .eq("tenant_id", t)
    .eq("facility_id", f)
    .eq("range_start", range.start)
    .eq("range_end", range.end)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
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
