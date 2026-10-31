/**
 * Evidence document file rules (Directive 06 §3 — private evidence files). Pure logic only: the server service
 * (lib/server/mrv/service.ts) and the Vitest suites both use it. Nothing here performs I/O.
 *
 *  - allowed types: PDF, Excel (.xlsx/.xlsm), CSV, JPG and PNG — no other extension is accepted;
 *  - the declared extension is cross-checked against the file's magic bytes (a renamed file is rejected);
 *  - hard size ceiling of 10 MB (the private bucket allows 20 MB for source imports);
 *  - storage paths are always built server-side as <tenant>/<facility>/evidence/<document id>/<safe name>.
 */
import { toIsoDate } from "@/lib/dates";

export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

export const EVIDENCE_MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xlsm": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export const EVIDENCE_CATEGORIES = ["production", "rawMaterial", "kilnFuel", "electricity"] as const;
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

export function evidenceExtension(name: string): string | null {
  const m = /\.[a-z0-9]+$/i.exec(name.trim());
  return m ? m[0].toLowerCase() : null;
}

/** Storage-safe file name: no path parts, no control/unsafe characters, bounded length. */
export function sanitizeEvidenceFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const safe = base.replace(/[^\w.\- ()]/g, "_").slice(0, 120);
  return safe && !/^\.+$/.test(safe) ? safe : "document.bin";
}

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

export interface EvidenceFileCheck {
  mime: string;
}

/**
 * Server-side validation of an evidence file. The check is deliberately independent of the browser:
 * extension, size and content signature must all agree. Returns the canonical MIME type or an error message.
 */
export function validateEvidenceFile(name: string, bytes: Uint8Array): EvidenceFileCheck | { error: string } {
  const ext = evidenceExtension(name);
  const mime = ext ? EVIDENCE_MIME_BY_EXT[ext] : undefined;
  if (!mime) return { error: `"${name}" is not a supported evidence file. Allowed: PDF, Excel (.xlsx/.xlsm), CSV, JPG, PNG.` };
  if (bytes.byteLength === 0) return { error: "The file is empty." };
  if (bytes.byteLength > EVIDENCE_MAX_BYTES) return { error: `Evidence files must be 10 MB or smaller (this file is ${Math.ceil(bytes.byteLength / 1024 / 1024)} MB).` };
  const isPdf = startsWith(bytes, [0x25, 0x50, 0x44, 0x46]); // %PDF
  const isZip = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]); // PK.. (xlsx/xlsm)
  const isPng = startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const isJpg = startsWith(bytes, [0xff, 0xd8, 0xff]);
  const knownBinary = isPdf || isZip || isPng || isJpg;
  const isText = !bytes.includes(0) && !knownBinary; // CSV has no signature: reject NUL bytes and known binary headers
  const ok =
    ext === ".pdf" ? isPdf :
    ext === ".xlsx" || ext === ".xlsm" ? isZip :
    ext === ".png" ? isPng :
    ext === ".jpg" || ext === ".jpeg" ? isJpg :
    isText;
  if (!ok) return { error: `The content of "${name}" does not match a ${ext ? ext.replace(".", "").toUpperCase() : "declared"} file. The upload was rejected.` };
  return { mime };
}

export interface EvidenceMetaInput {
  evidenceId: string;
  category?: string | null;
  start?: string | null;
  end?: string | null;
}

export interface EvidenceMeta {
  evidenceId: string;
  category: EvidenceCategory | null;
  coverageStart: string | null;
  coverageEnd: string | null;
}

/** Normalizes the document's register association. Category/date coverage are optional but validated when given. */
export function validateEvidenceMeta(meta: EvidenceMetaInput): EvidenceMeta | { error: string } {
  const evidenceId = meta.evidenceId.trim();
  if (!evidenceId || evidenceId.length > 120) return { error: "Choose the evidence reference this document belongs to (1–120 characters)." };
  let category: EvidenceCategory | null = null;
  if (meta.category != null && meta.category !== "") {
    if (!(EVIDENCE_CATEGORIES as readonly string[]).includes(meta.category)) return { error: "Unknown input category." };
    category = meta.category as EvidenceCategory;
  }
  let coverageStart: string | null = meta.start ? toIsoDate(meta.start) : null;
  let coverageEnd: string | null = meta.end ? toIsoDate(meta.end) : null;
  if ((meta.start && !coverageStart) || (meta.end && !coverageEnd)) return { error: "Coverage dates must be YYYY-MM-DD." };
  if (coverageStart && coverageEnd && coverageEnd < coverageStart) return { error: "Coverage end must not be before coverage start." };
  if (coverageStart && !coverageEnd) coverageEnd = coverageStart;
  if (coverageEnd && !coverageStart) coverageStart = coverageEnd;
  return { evidenceId, category, coverageStart, coverageEnd };
}

/** Storage path of an evidence document. Always derived from authorized scope server-side. */
export function evidenceStoragePath(t: string, f: string, documentId: string, filename: string): string {
  return `${t}/${f}/evidence/${documentId}/${sanitizeEvidenceFilename(filename)}`;
}

export interface EvidenceDocumentBody {
  id: string;
  evidence_id: string;
  category: string | null;
  coverage_start: string | null;
  coverage_end: string | null;
  filename: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  storage_path: string;
  replaces: string | null;
}

/** Canonical body for the mrv_store_evidence_document RPC (the executor signature binds its exact bytes). */
export function evidenceDocumentBody(meta: EvidenceMeta & { documentId: string; filename: string; mime: string; sizeBytes: number; sha256: string; storagePath: string; replaces: string | null }): string {
  const body: EvidenceDocumentBody = {
    id: meta.documentId,
    evidence_id: meta.evidenceId,
    category: meta.category,
    coverage_start: meta.coverageStart,
    coverage_end: meta.coverageEnd,
    filename: sanitizeEvidenceFilename(meta.filename),
    mime: meta.mime,
    size_bytes: meta.sizeBytes,
    sha256: meta.sha256,
    storage_path: meta.storagePath,
    replaces: meta.replaces,
  };
  return JSON.stringify(body);
}
