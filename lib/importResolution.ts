import type { Store } from "./types";

export interface ImportOutcome {
  /** The dataset that should be active after the import attempt. */
  active: Store | null;
  accepted: boolean;
  errors: string[];
}

/** A failed import never replaces (or clears) the currently active dataset. */
export function resolveImport(previous: Store | null, candidate: Store): ImportOutcome {
  if (candidate._valid) return { active: candidate, accepted: true, errors: [] };
  return {
    active: previous,
    accepted: false,
    errors: candidate._errors.length > 0 ? candidate._errors : ["The file could not be validated."],
  };
}
