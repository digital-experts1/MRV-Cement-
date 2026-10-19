import Decimal from "decimal.js";

/**
 * Tenant-level (portfolio) consolidation — documented treatment:
 *  1. Intensities are NEVER averaged. Consolidated intensity = Σ emissions / Σ production denominator.
 *  2. Only facilities with the same denominator basis, the same reporting interval and complete data are summed;
 *     otherwise the consolidated intensity is withheld (null) with the reasons listed.
 *  3. Emissions: each facility's direct (scope 1) emissions are counted once, at the facility that emitted them.
 *     Embedded emissions of intermediate products received from sister facilities are never re-added.
 *  4. Denominator (clinker basis): clinker *produced* at each facility. Clinker received via inter-factory
 *     transfer is not production and is not added again.
 *     Denominator (cement basis): cement produced at each facility; cement received from a sister facility and
 *     re-dispatched is subtracted when the receiving facility reports it inside its cement figure.
 */

export type DenominatorBasis = "clinker" | "cement";

export interface FacilityPeriodResult {
  facilityId: string;
  facilityName: string;
  reportingBoundary: string;
  periodStart: string;
  periodEnd: string;
  synthetic: boolean;
  scope1Tco2: string | null;
  clinkerT: string | null;
  cementT: string | null;
  transfersIn: { fromFacilityId: string; material: string; tonnes: string; includedInReportedOutput: boolean }[];
}

export interface ConsolidatedResult {
  basis: DenominatorBasis;
  facilities: (FacilityPeriodResult & { intensity: string | null })[];
  totalScope1Tco2: string | null;
  totalDenominatorT: string | null;
  excludedInternalTransfersT: string;
  consolidatedIntensity: string | null;
  withheldReasons: string[];
  treatment: string[];
}

export const CONSOLIDATION_TREATMENT = [
  "Consolidated intensity = Σ scope 1 emissions ÷ Σ production denominator; facility intensities are never averaged.",
  "Each facility's direct emissions are counted once, at the emitting facility.",
  "Inter-factory transfers of the denominator product between facilities in this view are removed from the receiving facility's output when it reported them as its own output.",
  "Consolidation is withheld when any facility is missing data, uses a different reporting interval, or the view contains no facilities.",
];

function denominatorOf(f: FacilityPeriodResult, basis: DenominatorBasis): string | null {
  return basis === "clinker" ? f.clinkerT : f.cementT;
}

export function consolidate(results: FacilityPeriodResult[], basis: DenominatorBasis): ConsolidatedResult {
  const reasons: string[] = [];
  const inView = new Set(results.map((r) => r.facilityId));
  const facilities = results.map((f) => {
    const den = denominatorOf(f, basis);
    const intensity = f.scope1Tco2 !== null && den !== null && !new Decimal(den).isZero() ? new Decimal(f.scope1Tco2).div(den).toString() : null;
    return { ...f, intensity };
  });

  if (!results.length) reasons.push("No authorized facilities in this view.");
  const intervals = new Set(results.map((r) => `${r.periodStart}..${r.periodEnd}`));
  if (intervals.size > 1) reasons.push("Facilities report different intervals; results are not compatible for summation.");
  for (const f of results) {
    if (f.scope1Tco2 === null) reasons.push(`${f.facilityName}: scope 1 emissions missing.`);
    if (denominatorOf(f, basis) === null) reasons.push(`${f.facilityName}: ${basis} production missing.`);
  }

  let excluded = new Decimal(0);
  for (const f of results) {
    for (const t of f.transfersIn) {
      if (t.material === basis && t.includedInReportedOutput && inView.has(t.fromFacilityId)) excluded = excluded.plus(t.tonnes);
    }
  }

  let totalE: Decimal | null = null;
  let totalD: Decimal | null = null;
  if (!reasons.length) {
    totalE = results.reduce((s, f) => s.plus(f.scope1Tco2 as string), new Decimal(0));
    totalD = results.reduce((s, f) => s.plus(denominatorOf(f, basis) as string), new Decimal(0)).minus(excluded);
    if (totalD.lte(0)) reasons.push("Consolidated production denominator is not positive.");
  }
  const ok = !reasons.length && totalE !== null && totalD !== null;
  return {
    basis,
    facilities,
    totalScope1Tco2: ok ? totalE!.toString() : null,
    totalDenominatorT: ok ? totalD!.toString() : null,
    excludedInternalTransfersT: excluded.toString(),
    consolidatedIntensity: ok ? totalE!.div(totalD!).toString() : null,
    withheldReasons: reasons,
    treatment: CONSOLIDATION_TREATMENT,
  };
}
