/**
 * Trusted execution pipeline (Directive 06 §2/§4). Server/test only. Pure apart from hashing.
 *
 * Builds the exact request bodies the trusted executor signs:
 *  - import bodies (validated readings with explicit interval metadata + effective-dated configuration);
 *  - run bodies: persisted readings + effective configuration → range selection → authoritative engine → results.
 * The database re-verifies the run input against the pinned revisions (0003 mrv_finalize_run).
 */
import { calculateStore } from "@/lib/calcEngine";
import { stableStringify } from "@/lib/hash";
import type { DataOrigin, MrvInput, RowSource, Store } from "@/lib/types";
import type { ResolvedRange } from "./dateRanges";
import type { ImportMapping } from "./importMapping";
import { CONFIG_KINDS, rebuildInput, REQUIRED_CONFIG_KINDS, type ConfigDraft, type ConfigKind, type ReadingDraft, type StoredReading } from "./readings";
import { computeCoverage, COVERAGE_POLICY, requiredSectionsFor, selectForRange, SELECTION_POLICY, type Coverage } from "./rangeSelection";
import { ENGINE_VERSION, inputSha, METHODOLOGY_VERSION, resultsFingerprint, resultsOf, scopeInputToRange } from "./snapshot";
import { sha256Json } from "./sha";

// ───────────────────────── Imports ─────────────────────────
export interface ImportBatchMeta {
  id: string;
  origin: DataOrigin;
  status: "accepted" | "rejected";
  filename: string | null;
  sha256: string | null;
  size_bytes: number | null;
  mime: string | null;
  storage_path: string | null;
  errors: string[];
  assertions: unknown[];
  declared_period_start: string | null;
  declared_period_end: string | null;
  synthetic: boolean;
  mapping: ImportMapping | null;
  effective_from: string | null;
  effective_to: string | null;
  effective_basis: "declared_period" | "batch_reading_span" | null;
}

export function importBody(batch: ImportBatchMeta, readings: ReadingDraft[], documents: ConfigDraft[]): string {
  return stableStringify({ batch, readings, documents: documents.map((d) => ({ kind: d.kind, content: d.content })) });
}

/** Configuration submitted with a batch applies to its declared period, else to the span of the batch's readings. */
export function effectivePeriod(declared: { start: string; end: string } | null, readings: ReadingDraft[]) {
  if (declared) return { from: declared.start, to: declared.end, basis: "declared_period" as const };
  if (!readings.length) return null;
  return {
    from: readings.reduce((m, r) => (r.interval_start < m ? r.interval_start : m), readings[0].interval_start),
    to: readings.reduce((m, r) => (r.interval_end > m ? r.interval_end : m), readings[0].interval_end),
    basis: "batch_reading_span" as const,
  };
}

// ───────────────────────── Configuration selection by effective period ─────────────────────────
export interface ConfigDoc {
  id: string;
  kind: ConfigKind;
  content: unknown;
  effective_from: string | null;
  effective_to: string | null;
  created_at: string;
}

/** For each kind: the most recently stored version whose effective period covers the WHOLE range. Never "latest upload". */
export function selectConfig(docs: ConfigDoc[], start: string, end: string): { chosen: ConfigDoc[]; gaps: string[] } {
  const chosen: ConfigDoc[] = [];
  const gaps: string[] = [];
  for (const kind of CONFIG_KINDS) {
    const ofKind = docs.filter((d) => d.kind === kind);
    const covering = ofKind
      .filter((d) => d.effective_from && d.effective_to && d.effective_from <= start && d.effective_to >= end)
      .sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at)));
    if (covering.length) {
      chosen.push(covering[covering.length - 1]);
      continue;
    }
    if (!REQUIRED_CONFIG_KINDS.includes(kind)) continue;
    const overlapping = ofKind.filter((d) => d.effective_from && d.effective_to && d.effective_from <= end && d.effective_to >= start);
    const legacy = ofKind.some((d) => !d.effective_from || !d.effective_to);
    gaps.push(
      overlapping.length
        ? `${kind}: different configuration versions apply within this range; calculate each configuration period separately`
        : legacy
          ? `${kind}: only versions stored without an effective period (before Directive 06) exist; re-import to declare it`
          : `${kind}: no configuration version is effective for this range`
    );
  }
  return { chosen, gaps };
}

// ───────────────────────── Runs ─────────────────────────
export interface RunPlanArgs {
  readings: (StoredReading & { synthetic?: boolean })[];
  docs: ConfigDoc[];
  range: ResolvedRange;
  facility: { code: string; synthetic: boolean };
  expectedSeries?: Record<string, string[]>;
  triggerBatchId?: string | null;
  assertions?: Store["assertions"];
}

export type RunPlan =
  | { kind: "none"; coverage: Coverage; note: string }
  | { kind: "run"; coverage: Coverage; store: Store; body: string; dependencySha: string; inputSha: string };

const ORIGINS: DataOrigin[] = ["workbook", "manual", "demo", "data-package"];

function dominantOrigin(rows: StoredReading[]): DataOrigin {
  const counts = new Map<DataOrigin, number>();
  for (const r of rows) {
    const o = (r.payload._source as RowSource | undefined)?.origin;
    const origin = o && ORIGINS.includes(o) ? o : "manual";
    counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "manual";
}

export function planRun(args: RunPlanArgs): RunPlan {
  const { range } = args;
  const cfg = selectConfig(args.docs, range.start, range.end);
  const config: Partial<Record<ConfigKind, unknown>> = {};
  for (const d of cfg.chosen) config[d.kind] = d.content;
  const selection = selectForRange(args.readings, range.start, range.end);
  const coverage = computeCoverage(selection, range, requiredSectionsFor((config.setup ?? {}) as Record<string, unknown>), {
    expectedSeries: args.expectedSeries,
    configGaps: cfg.gaps,
  });
  if (cfg.gaps.length) {
    return { kind: "none", coverage, note: `Not calculated: ${cfg.gaps.join("; ")}. No default configuration is substituted.` };
  }
  if (!selection.included.length) {
    return { kind: "none", coverage, note: "No usable stored readings fall completely inside this range. Nothing was calculated; missing data is not treated as zero." };
  }

  const included = selection.included;
  const synthetic = args.facility.synthetic || included.some((r) => r.synthetic === true);
  const base = rebuildInput(included, config, { origin: dominantOrigin(included), synthetic, filename: `${args.facility.code} · ${range.label}`, importedAt: null });
  const input: MrvInput = scopeInputToRange(base, { start: range.start, end: range.end, label: `${range.label} (${range.start} – ${range.end})` });
  const store = calculateStore(input, input.meta.origin);
  store.assertions = args.assertions ?? [];
  const results = resultsOf(store);
  const readingIds = included.map((r) => r.id).sort();
  const consideredIds = [...selection.considered].sort();
  const documentIds = cfg.chosen.map((d) => d.id).sort();
  const iSha = inputSha(store.inputs);
  const dependencySha = sha256Json({
    range: [range.start, range.end],
    readingIds,
    consideredIds,
    documentIds,
    engine: ENGINE_VERSION,
    methodology: METHODOLOGY_VERSION,
    selection: SELECTION_POLICY,
    coverage: COVERAGE_POLICY,
    inputSha: iSha,
  });
  const body = stableStringify({
    run: {
      range_start: range.start,
      range_end: range.end,
      range_label: range.label,
      timezone: range.timezone,
      engine_version: ENGINE_VERSION,
      methodology_version: METHODOLOGY_VERSION,
      selection_policy: SELECTION_POLICY,
      input_sha256: iSha,
      results_sha256: sha256Json(results),
      results_fingerprint: resultsFingerprint(store),
      dependency_sha256: dependencySha,
      trigger_batch_id: args.triggerBatchId ?? null,
    },
    input_snapshot: store.inputs,
    results,
    coverage,
    reading_ids: readingIds,
    considered_ids: consideredIds,
    document_ids: documentIds,
  });
  return { kind: "run", coverage, store, body, dependencySha, inputSha: iSha };
}
