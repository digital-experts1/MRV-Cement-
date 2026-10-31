"use client";
/**
 * Document management for the Evidence Register (Directive 06 §3 — private evidence files).
 * Uploads go to the private bucket through the MRV API (server-side type/size validation, storage cleanup on
 * failure), previews use short-lived signed URLs created server-side, and replacements keep immutable history.
 * A stored or previewed document remains a linkage claim only — it never establishes external verification.
 */
import { useRef, useState } from "react";
import { useScope } from "@/context/ScopeContext";
import { EVIDENCE_MAX_BYTES, evidenceExtension, EVIDENCE_MIME_BY_EXT } from "@/lib/mrv/evidenceFiles";
import { EVIDENCE_SECTIONS } from "@/lib/evidenceReview";
import { setupDisplay } from "@/lib/setupView";
import type { EvidenceDocumentView } from "@/lib/mrv/clientTypes";

export interface EvidenceUploadRequest {
  evidenceId: string;
  category?: string | null;
  start?: string | null;
  end?: string | null;
  replace?: string | null;
}

/** Uploads a document file with progress. Same-origin XHR so the session cookies authenticate the request. */
export function uploadEvidenceDocumentFile(
  scope: { tenantId: string | null; facilityId: string | null },
  file: File,
  params: EvidenceUploadRequest,
  onProgress: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!scope.tenantId || !scope.facilityId) {
      reject(new Error("Sign in and select a factory before uploading."));
      return;
    }
    const qs = new URLSearchParams({ filename: file.name, evidenceId: params.evidenceId });
    if (params.category) qs.set("category", params.category);
    if (params.start) qs.set("start", params.start);
    if (params.end) qs.set("end", params.end);
    if (params.replace) qs.set("replace", params.replace);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/mrv/orgs/${scope.tenantId}/facilities/${scope.facilityId}/evidence-documents?${qs.toString()}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error("The upload could not be sent. Check your connection and try again."));
    xhr.onload = () => {
      if (xhr.status === 200) {
        onProgress(1);
        resolve();
        return;
      }
      let msg = `Upload rejected (HTTP ${xhr.status}).`;
      try {
        const parsed = JSON.parse(xhr.responseText) as { error?: string };
        if (parsed.error) msg = parsed.error;
      } catch {
        /* keep the generic message */
      }
      reject(new Error(msg));
    };
    xhr.send(file);
  });
}

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const ACCEPT = ".pdf,.xlsx,.xlsm,.csv,.jpg,.jpeg,.png";

export function EvidenceDocuments({ evidenceId, docs, onChanged, canUpload }: {
  evidenceId: string;
  docs: EvidenceDocumentView[];
  onChanged: () => void;
  canUpload: boolean;
}) {
  const scope = useScope();
  const input = useRef<HTMLInputElement | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<EvidenceDocumentView | null>(null);
  const [category, setCategory] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const current = docs.filter((d) => d.isCurrent);
  const history = docs.filter((d) => !d.isCurrent);

  async function send(file: File, replace: string | null) {
    setMessage("");
    // Instant client feedback only — the server independently re-validates type, size and content.
    const ext = evidenceExtension(file.name);
    if (!ext || !EVIDENCE_MIME_BY_EXT[ext]) {
      setMessage(`"${file.name}" is not a supported evidence file. Allowed: PDF, Excel (.xlsx/.xlsm), CSV, JPG, PNG.`);
      return;
    }
    if (file.size > EVIDENCE_MAX_BYTES) {
      setMessage("Evidence files must be 10 MB or smaller.");
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      await uploadEvidenceDocumentFile(
        { tenantId: scope.tenantId, facilityId: scope.facilityId },
        file,
        { evidenceId, category: category || null, start: start || null, end: end || null, replace },
        setProgress
      );
      setMessage(replace ? "Replacement saved. The previous document is kept as history." : "Document saved.");
      setCategory("");
      setStart("");
      setEnd("");
      setReplaceTarget(null);
      onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "The upload failed. Nothing was saved.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function openDocument(id: string) {
    setMessage("");
    try {
      const r = await scope.scopedFetch<{ url: string; expiresAt: string }>(
        `/orgs/${scope.tenantId}/facilities/${scope.facilityId}/evidence-documents/${id}/url`
      );
      window.open(r.url, "_blank", "noopener");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "A download link could not be created; try again.");
    }
  }

  return (
    <div className="evidence-docs">
      {current.length ? (
        <ul className="evidence-doc-list">
          {current.map((d) => (
            <li key={d.id}>
              <button type="button" className="evidence-doc-open" title="Open a short-lived private link (preview/download)" onClick={() => void openDocument(d.id)}>
                {d.filename}
              </button>
              <span className="evidence-doc-meta">
                {fmtSize(d.sizeBytes)} · uploaded {new Date(d.createdAt).toLocaleDateString()}
                {d.category ? ` · ${setupDisplay(EVIDENCE_SECTIONS.find(([, key]) => key === d.category)?.[0] ?? d.category)}` : ""}
                {d.coverageStart ? ` · covers ${d.coverageStart} – ${d.coverageEnd}` : ""}
              </span>
              {canUpload && !busy ? (
                <button type="button" className="evidence-doc-action" onClick={() => { setReplaceTarget(d); input.current?.click(); }}>
                  Replace
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="evidence-doc-meta">No document uploaded for this reference yet.</p>
      )}

      {canUpload ? (
        <>
          <details className="evidence-doc-upload">
            <summary>Upload details (optional)</summary>
            <div className="evidence-doc-fields">
              <label>
                Input category
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Not category-specific</option>
                  {EVIDENCE_SECTIONS.map(([label, key]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Coverage start
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label>
                Coverage end
                <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </div>
            <p className="evidence-doc-meta">Category and coverage describe what the document supports. They never mark readings as verified.</p>
          </details>
          <button type="button" className="evidence-doc-action" disabled={busy} onClick={() => { setReplaceTarget(null); input.current?.click(); }}>
            Upload document
          </button>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            aria-label={`Evidence document for ${evidenceId}`}
            tabIndex={-1}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void send(file, replaceTarget?.id ?? null);
            }}
          />
          {replaceTarget && !busy ? (
            <p className="evidence-doc-meta">Replacing “{replaceTarget.filename}”. Choose the new file — the old one is kept as history.</p>
          ) : null}
        </>
      ) : null}

      {history.length ? (
        <details className="evidence-doc-history">
          <summary>Version history ({history.length} replaced)</summary>
          <ul>
            {history.map((d) => (
              <li key={d.id}>
                <button type="button" className="evidence-doc-open" onClick={() => void openDocument(d.id)}>
                  {d.filename}
                </button>
                <span className="evidence-doc-meta">
                  {fmtSize(d.sizeBytes)} · replaced {new Date(d.createdAt).toLocaleDateString()}
                  {d.sha256 ? ` · sha256 ${d.sha256.slice(0, 12)}…` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {progress !== null ? (
        <div className="evidence-doc-progress" role="status" aria-label="Upload progress">
          <div className="evidence-doc-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          <span>{Math.round(progress * 100)}%</span>
        </div>
      ) : null}
      {busy ? <p className="evidence-doc-meta">Uploading…</p> : null}
      {message ? <p className="evidence-doc-message" role="status">{message}</p> : null}
    </div>
  );
}