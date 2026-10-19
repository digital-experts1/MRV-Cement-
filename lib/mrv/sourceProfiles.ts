/**
 * Source-specific unit-mapping requirements for raw-material rows (Directive 06B §3, revised). Browser-safe.
 *
 * Precedence, never inferred from the size of a value:
 *  1. an explicit unit on the row (`Carbonate Unit`, `Moisture Unit`, `Mass Basis`) or in the import declaration;
 *  2. otherwise the column header ("CaCO3 %" → percent): 0.95 under a % header is 0.95 %, 0.5 is 0.5 %.
 * Genuine ambiguity is a property of a known source, not of its values: a profile lists the units the importer MUST
 * declare because that source's own documentation or formulas contradict its headers. Rows from such a source without
 * the required declaration are rejected at import and withheld from Method A by the engine. Unknown sources follow (2)
 * and are flagged by QA check CP-03 while units are undeclared.
 */
import { rowUnit, UNIT_KEYS, type UnitKey } from "./unitMapping";

export const SOURCE_PROFILE_VERSION = "trace-source-profiles/v1";

export interface SourceProfile {
  id: string;
  label: string;
  /** Exact `01_Setup` "Workbook mode" values that identify the source. */
  workbookModes: string[];
  /** Units that must be declared explicitly (row or import); the header is not authoritative for them. */
  requiredUnits: UnitKey[];
  basis: string;
}

export const SOURCE_PROFILES: SourceProfile[] = [
  {
    id: "trace-v28-template",
    label: "TRACE FORCE MRV V28 template / online entry",
    workbookModes: ["Cement_QAQC_V28", "Cement_QAQC_V28_Online"],
    requiredUnits: [],
    basis: "Platform-defined template: the % column headers are authoritative.",
  },
  {
    id: "trace-v28-collection-demo",
    label: "TRACE FORCE MRV V28 collection workbook (Demo mode)",
    workbookModes: ["Cement_QAQC_V28_Demo"],
    requiredUnits: ["carbonate", "massBasis"],
    basis: "Its Method A formula uses the 'CaCO3 %' / 'MgCO3 %' columns as fractions and does not deduct moisture, contradicting its headers.",
  },
];

export function sourceProfileOf(setup: Record<string, unknown> | undefined): SourceProfile | null {
  const mode = String(setup?.["Workbook mode"] ?? "").trim();
  return mode ? SOURCE_PROFILES.find((p) => p.workbookModes.includes(mode)) ?? null : null;
}

/** Required units the row does not declare (after the import declaration has been stamped on it). */
export function missingRequiredUnits(row: Record<string, unknown>, profile: SourceProfile | null): UnitKey[] {
  return profile ? profile.requiredUnits.filter((k) => !rowUnit(row, k)) : [];
}

export function requirementError(missing: UnitKey[], profile: SourceProfile): string {
  return `source "${profile.label}" requires an explicit ${missing.map((k) => UNIT_KEYS[k]).join(" and ")} declaration (choose it under Raw-material units). ${profile.basis}`;
}
