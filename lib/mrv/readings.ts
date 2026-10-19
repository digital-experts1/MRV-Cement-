/**
 * Mapping between the engine's MrvInput and persisted historical records (Directive 04 §3).
 * Server/test only (uses node:crypto via sha.ts).
 *
 * Import rules (documented in docs/mrv/11-supabase-persistence.md):
 *  - Every activity row must carry a valid ISO `Date`; rows without one are rejected (never guessed).
 *  - A row dated on the last day of a month is a monthly summary covering that whole calendar month;
 *    any other date is a daily record covering that date only.
 *  - record_key = section | date | identity fields | occurrence. Identical source records in one file keep distinct
 *    occurrences (legitimate equal readings are not merged). Re-importing the same record key with identical content is
 *    "unchanged"; with different content it creates a new revision.
 */
import { stableStringify } from "@/lib/hash";
import type { MrvInput, RowSource, SheetRow } from "@/lib/types";
import { toIsoDate } from "@/lib/dates";
import { isLastDayOfMonth, monthStart, parseDate } from "./dateRanges";
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

const SECTION_LABELS: Record<string, string> = SECTION_LABELS_CLIENT;

export const CONFIG_KINDS = ["setup", "setup_rows", "constants", "fuel_defaults", "dcs_map", "evidence_register", "regulatory", "readme"] as const;
export type ConfigKind = (typeof CONFIG_KINDS)[number];

export interface ReadingDraft {
  section: ReadingSection;
  series_key: string;
  record_key: string;
  observed_on: string;
  interval_start: string;
  interval_end: string;
  granularity: "day" | "month";
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
  observed_on: string;
  interval_start: string;
  interval_end: string;
  granularity: "day" | "month";
  payload: SheetRow;
  synthetic?: boolean;
  received_at?: string;
  revision?: number;
}

const norm = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim().toLowerCase());

export function intervalFor(date: string): { interval_start: string; interval_end: string; granularity: "day" | "month" } {
  const p = parseDate(date);
  if (!p) throw new Error(`Invalid date ${date}`);
  if (isLastDayOfMonth(date)) return { interval_start: monthStart(p.y, p.m), interval_end: date, granularity: "month" };
  return { interval_start: date, interval_end: date, granularity: "day" };
}

/** Values only (no provenance) — the content that defines whether a re-imported record changed. */
function contentOf(row: SheetRow): Record<string, unknown> {
  const { _source: _s, ...rest } = row;
  void _s;
  return rest;
}

export function toReadingDrafts(input: MrvInput): { readings: ReadingDraft[]; errors: string[] } {
  const readings: ReadingDraft[] = [];
  const errors: string[] = [];
  for (const section of READING_SECTIONS) {
    const occurrences = new Map<string, number>();
    input[section].forEach((row, i) => {
      const src = (row._source ?? {}) as RowSource;
      const where = src.sheet && src.row ? `${src.sheet} row ${src.row}` : `${SECTION_LABELS[section]} entry ${i + 1}`;
      const date = toIsoDate(row.Date);
      if (!date) {
        errors.push(`${where}: missing or invalid Date — every reading needs an observation date (YYYY-MM-DD).`);
        return;
      }
      const series = [section, ...IDENTITY[section].map((f) => norm(row[f]))].join("|");
      const base = `${series}|${date}`;
      const n = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, n);
      const payload = JSON.parse(stableStringify({ ...row, Date: date })) as SheetRow;
      readings.push({
        section,
        series_key: series,
        record_key: `${base}|#${n}`,
        observed_on: date,
        ...intervalFor(date),
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
  return `${r.observed_on}|${String(s?.row ?? 0).padStart(8, "0")}|${r.record_key}`;
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
