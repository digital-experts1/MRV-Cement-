/**
 * Mapping between the engine's MrvInput and persisted historical records (Directives 04 §3, 06 §3).
 * Server/test only (uses node:crypto via sha.ts).
 *
 * Import rules (documented in docs/mrv/11-supabase-persistence.md):
 *  - Every reading's interval, measurement type and granularity come from row columns or an explicit import mapping
 *    (lib/mrv/importMapping.ts). Nothing is inferred from a date being the last day of a month.
 *  - series_key = section | identity fields. Two totals for the same series with overlapping intervals in one import
 *    are a validation error (they would double count); they are never merged or dropped silently.
 *  - record_key = series | interval | measurement type. Re-importing the same record key with identical content is
 *    "unchanged"; with different content it creates a new revision.
 *  - legacy_key = the Directive 05 key (series | date | #n) so a re-import with an explicit mapping supersedes readings
 *    that were stored under the old date-based inference (auditable correction; originals are kept).
 */
import { stableStringify } from "@/lib/hash";
import type { MrvInput, RowSource, SheetRow } from "@/lib/types";
import { toIsoDate } from "@/lib/dates";
import { MAPPING_VERSION, resolveRowInterval, type Granularity, type ImportMapping, type MeasurementType } from "./importMapping";
import { SECTION_LABELS_CLIENT } from "./sectionLabels";
import { sha256Json } from "./sha";

export const READING_SECTIONS = ["production", "rawMaterial", "kilnFuel", "electricity", "inventory"] as const;
export type ReadingSection = (typeof READING_SECTIONS)[number];

const IDENTITY: Record<ReadingSection, string[]> = {
  production: ["Kiln Line", "Cement Type"],
  rawMaterial: ["Material"],
  kilnFuel: ["Fuel Type", "Unit"],
  electricity: ["Meter / Source"],
  inventory: ["Material"],
};

export const CONFIG_KINDS = ["setup", "setup_rows", "constants", "fuel_defaults", "dcs_map", "evidence_register", "regulatory", "readme"] as const;
export type ConfigKind = (typeof CONFIG_KINDS)[number];
/** Without an effective version of these kinds a range cannot be calculated (no silent defaults). */
export const REQUIRED_CONFIG_KINDS: ConfigKind[] = ["setup", "constants"];

export interface ReadingDraft {
  section: ReadingSection;
  series_key: string;
  record_key: string;
  legacy_key: string | null;
  observed_on: string | null;
  interval_start: string;
  interval_end: string;
  granularity: Granularity;
  measurement_type: MeasurementType;
  interval_basis: string;
  mapping_version: string;
  source_identity: string;
  payload: SheetRow;
  content_hash: string;
  source_ref: { file?: string | null; sheet?: string; row?: number; origin?: string };
}

export interface ConfigDraft {
  kind: ConfigKind;
  content: unknown;
  content_hash: string;
}

/** Persisted reading as loaded back for calculation. */
export interface StoredReading {
  id: string;
  section: ReadingSection;
  series_key: string;
  record_key: string;
  observed_on: string | null;
  interval_start: string;
  interval_end: string;
  granularity: Granularity;
  measurement_type?: MeasurementType | null;
  mapping_version?: string | null;
  quality_state?: "accepted" | "rejected" | "withdrawn";
  payload: SheetRow;
  synthetic?: boolean;
  received_at?: string;
  revision?: number;
}

const norm = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim().toLowerCase());
export const seriesKeyOf = (section: ReadingSection, row: SheetRow) => [section, ...IDENTITY[section].map((f) => norm(row[f]))].join("|");

/** Values only (no provenance) — the content that defines whether a re-imported record changed. */
function contentOf(row: SheetRow): Record<string, unknown> {
  const { _source: _s, ...rest } = row;
  void _s;
  return rest;
}

export function toReadingDrafts(input: MrvInput, mapping: ImportMapping | null, sourceIdentity = "unknown"): { readings: ReadingDraft[]; errors: string[] } {
  const readings: ReadingDraft[] = [];
  const errors: string[] = [];
  for (const section of READING_SECTIONS) {
    const legacyOcc = new Map<string, number>();
    const bySeries = new Map<string, { start: string; end: string; where: string }[]>();
    input[section].forEach((row, i) => {
      const src = (row._source ?? {}) as RowSource;
      const where = src.sheet && src.row ? `${src.sheet} row ${src.row}` : `${SECTION_LABELS_CLIENT[section]} entry ${i + 1}`;
      const iv = resolveRowInterval(row, mapping);
      if (typeof iv === "string") {
        errors.push(`${where}: ${iv}.`);
        return;
      }
      const series = seriesKeyOf(section, row);
      const prior = bySeries.get(series) ?? [];
      const clash = prior.find((p) => p.start <= iv.interval_end && iv.interval_start <= p.end);
      if (clash) {
        errors.push(
          `${where}: overlaps ${clash.where} for the same ${SECTION_LABELS_CLIENT[section].toLowerCase()} series (${iv.interval_start} – ${iv.interval_end}); ` +
            "two totals for one series and period would double count. Distinguish them (e.g. meter, line) or remove one."
        );
        return;
      }
      prior.push({ start: iv.interval_start, end: iv.interval_end, where });
      bySeries.set(series, prior);

      const date = toIsoDate(row.Date);
      let legacy: string | null = null;
      if (date) {
        const base = `${series}|${date}`;
        const n = (legacyOcc.get(base) ?? 0) + 1;
        legacyOcc.set(base, n);
        legacy = `${base}|#${n}`;
      }
      // The stored row is self-describing: its resolved interval travels with it (exports/re-imports keep it).
      const normalized: SheetRow = { ...row, "Interval Start": iv.interval_start, "Interval End": iv.interval_end, "Measurement Type": iv.measurement_type };
      if (date) normalized.Date = date;
      const payload = JSON.parse(stableStringify(normalized)) as SheetRow;
      readings.push({
        section,
        series_key: series,
        record_key: `${series}|${iv.interval_start}..${iv.interval_end}|${iv.measurement_type}`,
        legacy_key: legacy,
        observed_on: date,
        interval_start: iv.interval_start,
        interval_end: iv.interval_end,
        granularity: iv.granularity,
        measurement_type: iv.measurement_type,
        interval_basis: iv.interval_basis,
        mapping_version: MAPPING_VERSION,
        source_identity: src.sheet ? `${sourceIdentity}#${src.sheet}` : sourceIdentity,
        payload,
        content_hash: sha256Json(contentOf(payload)),
        source_ref: { origin: src.origin, file: src.file ?? null, sheet: src.sheet, row: src.row },
      });
    });
  }
  return { readings, errors };
}

export function toConfigDrafts(input: MrvInput): ConfigDraft[] {
  const docs: [ConfigKind, unknown][] = [
    ["setup", input.setup],
    ["setup_rows", input.setupRows],
    ["constants", input.constants],
    ["fuel_defaults", input.fuelDefaults],
    ["dcs_map", input.dcsMap],
    ["evidence_register", input.evidence],
    ["regulatory", input.regulatory],
    ["readme", input.readme],
  ];
  return docs.map(([kind, content]) => {
    const canonical = JSON.parse(stableStringify(content ?? (kind === "setup" ? {} : []))) as unknown;
    return { kind, content: canonical, content_hash: sha256Json(canonical) };
  });
}

const sortKey = (r: StoredReading) => {
  const s = r.payload._source as RowSource | undefined;
  return `${r.interval_start}|${r.interval_end}|${String(s?.row ?? 0).padStart(8, "0")}|${r.record_key}`;
};

/** Rebuilds the engine input from persisted readings and config documents (deterministic order). */
export function rebuildInput(
  readings: StoredReading[],
  config: Partial<Record<ConfigKind, unknown>>,
  meta: MrvInput["meta"]
): MrvInput {
  const bySection = (s: ReadingSection) =>
    readings
      .filter((r) => r.section === s)
      .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0))
      .map((r) => structuredClone(r.payload));
  const arr = (k: ConfigKind) => (Array.isArray(config[k]) ? structuredClone(config[k] as SheetRow[]) : []);
  return {
    meta,
    readme: arr("readme"),
    setup: config.setup && typeof config.setup === "object" ? structuredClone(config.setup as Record<string, unknown>) : {},
    setupRows: arr("setup_rows"),
    dcsMap: arr("dcs_map"),
    production: bySection("production"),
    rawMaterial: bySection("rawMaterial"),
    kilnFuel: bySection("kilnFuel"),
    electricity: bySection("electricity"),
    inventory: bySection("inventory"),
    constants: arr("constants"),
    fuelDefaults: arr("fuel_defaults"),
    evidence: arr("evidence_register"),
    regulatory: arr("regulatory"),
  };
}
