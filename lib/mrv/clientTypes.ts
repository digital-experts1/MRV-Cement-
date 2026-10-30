import type { Coverage } from "./rangeSelection";
import type { RangeSpec, ResolvedRange } from "./dateRanges";
import type { Store } from "@/lib/types";

/** Mirror of lib/mrv/snapshot.ts RunIntegrity (snapshot.ts is server-only). */
export interface RunIntegrity {
  stored: "intact" | "altered" | "unknown";
  storedEngine: string;
  currentEngine: string;
  sameEngine: boolean;
  recomputeMatches: boolean;
}

/** Shapes returned by /api/mrv (kept in sync with lib/server/mrv/service.ts). */
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
  /** True when this run predates the facility's dataset archive: history only, never auto-selected. */
  archived: boolean;
  integrity: RunIntegrity;
  readings: number;
}

export interface RunView {
  run: RunMeta;
  store: Store;
}

export interface CalcResponse {
  view: RunView | null;
  coverage: Coverage;
  note: string | null;
  range: ResolvedRange;
}

export interface ImportOutcome {
  accepted: boolean;
  status: "accepted" | "rejected" | "duplicate";
  batchId: string;
  errors: string[];
  counts: { inserted: number; revised: number; unchanged: number };
  duplicateOf: string | null;
  period: { start: string; end: string } | null;
  run: RunView | null;
  runNote: string | null;
}

export interface MeResponse {
  user: { id: string; email: string | null };
  organizations: { tenantId: string; name: string; synthetic: boolean }[];
  preference: { tenantId: string | null; facilityId: string | null; range: RangeSpec | null } | null;
}

export interface FacilitySummary {
  readingsStart?: string | null;
  readingsEnd?: string | null;
  latestObservation: string | null;
  latestImport: string | null;
  latestCalculation: string | null;
  currentReadings: number;
  /** Latest dataset archive of this facility (shown so an empty dashboard explains itself). */
  archive: { reason: string; at: string } | null;
}
