import Decimal from "decimal.js";
import { toIsoDate } from "./dates";
import { parseStrictNumber } from "./numeric";
import type { SheetRow } from "./types";

export function materialName(row: SheetRow): string {
  return String(row.Material ?? "").trim() || "Unspecified material";
}

/** Presentation totals only; incomplete data must never become a zero or a complete total. */
export function rawTotal(rows: SheetRow[], field: string): number | null {
  if (!rows.length) return null;
  let sum = new Decimal(0);
  for (const row of rows) {
    const parsed = parseStrictNumber(row[field]);
    if (parsed.kind !== "ok") return null;
    sum = sum.plus(parsed.value);
  }
  return sum.toNumber();
}

export function needsRawReview(row: SheetRow): boolean {
  return (
    String(row["QA Status"] ?? "").toUpperCase() !== "PASS" ||
    !String(row["Evidence ID"] ?? "").trim() ||
    !["percent", "fraction"].includes(
      String(row["Carbonate Unit"] ?? "")
        .trim()
        .toLowerCase(),
    ) ||
    !["dry", "wet"].includes(
      String(row["Mass Basis"] ?? "")
        .trim()
        .toLowerCase(),
    ) ||
    (String(row["Mass Basis"] ?? "")
      .trim()
      .toLowerCase() === "wet" &&
      !["percent", "fraction"].includes(
        String(row["Moisture Unit"] ?? "")
          .trim()
          .toLowerCase(),
      ))
  );
}

export function rawTrend(rows: SheetRow[]) {
  const groups = new Map<string, SheetRow[]>();
  for (const row of rows) {
    const date = toIsoDate(row.Date);
    if (!date) continue;
    const group = groups.get(date) ?? [];
    group.push(row);
    groups.set(date, group);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({
      date,
      quantity: rawTotal(items, "Quantity t"),
      co2: rawTotal(items, "Process CO2 Method A t"),
    }));
}

/** Show source values with their declared semantics. Never infer fractions from their magnitude. */
export function assayUnit(row: SheetRow, moisture = false): string {
  const unit = String(row[moisture ? "Moisture Unit" : "Carbonate Unit"] ?? "")
    .trim()
    .toLowerCase();
  return unit === "fraction"
    ? "fraction"
    : unit === "percent"
      ? "%"
      : unit
        ? `Unrecognized: ${unit}`
        : "% by header; undeclared";
}
