import { calculateStore } from "./calcEngine";
import { SYNTHETIC_NOTICE } from "./sampleData";
import { createEmptyStore, type MrvInput, type Store } from "./types";

export const DATA_PACKAGE_FORMAT = "trace-force-mrv/data-package";
export const DATA_PACKAGE_VERSION = 1;

/**
 * Re-importable data export (see docs/mrv/08-data-export-format.md).
 * Contains inputs and per-row provenance only. Calculated values are deliberately excluded:
 * they are recomputed by the engine on re-import.
 */
export interface DataPackage {
  format: typeof DATA_PACKAGE_FORMAT;
  version: typeof DATA_PACKAGE_VERSION;
  exportedAt: string;
  synthetic: boolean;
  notice: string;
  source: { origin: string | null; filename: string | null; revision: string | null };
  inputs: MrvInput;
}

export function buildDataPackage(store: Store, now = new Date()): DataPackage {
  return {
    format: DATA_PACKAGE_FORMAT,
    version: DATA_PACKAGE_VERSION,
    exportedAt: now.toISOString(),
    synthetic: store.meta.synthetic,
    notice: store.meta.synthetic
      ? SYNTHETIC_NOTICE
      : "Input data export. Calculated values are not included and are recomputed on import. Not a report.",
    source: { origin: store.meta.origin, filename: store.meta.filename, revision: store.meta.revision },
    inputs: store.inputs,
  };
}

export function dataPackageFilename(store: Store): string {
  const q = String(store.setup["Reporting quarter"] ?? "period").replace(/\s+/g, "_");
  return `${store.meta.synthetic ? "SYNTHETIC_DEMO_" : ""}TRACE_FORCE_MRV_Data_${q}.json`;
}

function invalid(filename: string, errors: string[]): Store {
  const s = createEmptyStore();
  s.meta.filename = filename;
  s._errors = errors;
  return s;
}

export function parseDataPackage(text: string, filename: string): Store {
  let pkg: Partial<DataPackage>;
  try {
    pkg = JSON.parse(text);
  } catch {
    return invalid(filename, ["File is not valid JSON."]);
  }
  if (!pkg || pkg.format !== DATA_PACKAGE_FORMAT) return invalid(filename, [`Not a TRACE FORCE MRV data package (expected format "${DATA_PACKAGE_FORMAT}").`]);
  if (pkg.version !== DATA_PACKAGE_VERSION) return invalid(filename, [`Unsupported data package version ${String(pkg.version)} (supported: ${DATA_PACKAGE_VERSION}).`]);
  const inputs = pkg.inputs;
  const arrays: (keyof MrvInput)[] = ["production", "rawMaterial", "kilnFuel", "electricity", "inventory", "constants", "evidence"];
  if (!inputs || typeof inputs.setup !== "object" || arrays.some((k) => !Array.isArray(inputs[k]))) {
    return invalid(filename, ["Data package is missing required input sections."]);
  }
  return calculateStore(
    {
      ...inputs,
      meta: {
        origin: "data-package",
        synthetic: Boolean(pkg.synthetic) || Boolean(inputs.meta?.synthetic),
        filename,
        importedAt: new Date().toISOString(),
      },
    },
    "data-package",
  );
}
