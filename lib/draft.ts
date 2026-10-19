import type { MrvInput, Store } from "./types";

export const DRAFT_KEY = "EGYTRACE_DATAENTRY_DRAFT_V2";
export const LEGACY_DRAFT_KEY = "EGYTRACE_DATAENTRY_DRAFT_V1";

export interface DraftRecord {
  schema: 2;
  facility: string;
  periodStart: string;
  periodEnd: string;
  /** Revision of the active dataset the draft was started from (null = started from blank/demo). */
  baseRevision: string | null;
  savedAt: string;
  data: MrvInput;
}

export type DraftResolution =
  | { action: "use-store" }
  | { action: "use-draft"; draft: DraftRecord }
  | { action: "ask"; draft: DraftRecord; reason: string };

function scope(setup: Record<string, unknown>) {
  return {
    facility: String(setup["Installation / site"] ?? "").trim(),
    periodStart: String(setup["Period start"] ?? "").trim(),
    periodEnd: String(setup["Period end"] ?? "").trim(),
  };
}

export function makeDraft(data: MrvInput, baseRevision: string | null, now = new Date()): DraftRecord {
  return { schema: 2, ...scope(data.setup), baseRevision, savedAt: now.toISOString(), data };
}

export function describeDraft(d: DraftRecord): string {
  return `${d.facility || "unnamed facility"}, ${d.periodStart || "?"} – ${d.periodEnd || "?"} (saved ${d.savedAt.replace("T", " ").slice(0, 16)} UTC)`;
}

/**
 * Explicit draft resolution. A draft is applied automatically only when it was started from the exact active
 * dataset revision (or nothing is loaded). Any facility/period/revision mismatch requires the user to choose.
 */
export function resolveDraft(draft: DraftRecord | null, store: Store | null): DraftResolution {
  if (!draft) return { action: "use-store" };
  if (!store?._valid) {
    return draft.baseRevision === null ? { action: "use-draft", draft } : { action: "ask", draft, reason: "The dataset this draft was based on is no longer loaded." };
  }
  const active = scope(store.setup);
  if (draft.facility !== active.facility || draft.periodStart !== active.periodStart || draft.periodEnd !== active.periodEnd) {
    return { action: "ask", draft, reason: "This draft belongs to a different facility or reporting period than the loaded dataset." };
  }
  if (draft.baseRevision !== store.meta.revision) {
    return { action: "ask", draft, reason: "The loaded dataset has changed since this draft was saved (different revision)." };
  }
  return { action: "use-draft", draft };
}

/** Reads a stored draft. Legacy V1 drafts (no scope metadata) are surfaced for an explicit decision, never auto-applied. */
export function readDraft(storage: Pick<Storage, "getItem">): DraftRecord | null {
  try {
    const v2 = storage.getItem(DRAFT_KEY);
    if (v2) {
      const parsed = JSON.parse(v2) as DraftRecord;
      if (parsed?.schema === 2 && parsed.data?.setup) return parsed;
    }
    const v1 = storage.getItem(LEGACY_DRAFT_KEY);
    if (v1) {
      const data = JSON.parse(v1) as MrvInput;
      if (data?.setup) return { ...makeDraft(data, "legacy-unknown"), savedAt: "unknown (legacy draft)" };
    }
  } catch {
    /* unreadable drafts are ignored */
  }
  return null;
}
