"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { StaleScopeError, useScope } from "@/context/ScopeContext";
import { useStore } from "@/context/StoreContext";
import { downloadBlankTemplate } from "@/lib/export";
import { importFailureFrom, rejectedImport, scopeChangedDuringImport, type ImportFailure } from "@/lib/mrv/importFailure";
import { downloadDailyTemplate } from "@/lib/mrv/dailyTotals";
import * as XLSX from "xlsx";
import { mrvFetch } from "@/lib/apiClient";
import { MappingSelect } from "./MappingSelect";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const SUPPORTED = /\.(xlsx|xlsm|json|csv)$/i;
interface Review { errors: string[]; start: string | null; end: string | null; count: number; unchanged: number; revisions: number; overlaps: number; configKinds: string[]; sections: Record<string, number>; missingEvidence: number; missingDailyReadings: number | null; changes: { section: string; start: string; end: string; kind: string; fields: { field: string; before: unknown; after: unknown }[] }[] }

export function UploadPrompt({ droppedFile, clearDroppedFile }: { droppedFile?: File | null; clearDroppedFile?: () => void }) {
  const { uploadOpen, closeUpload, loading, parseError } = useStore();
  const scope = useScope();
  const isSynthetic = scope.memberships.find((m) => m.tenantId === scope.tenantId)?.synthetic ?? false;
  const ready = scope.status === "ready" && !!scope.facility;
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [daily, setDaily] = useState(false);
  const [preview, setPreview] = useState<{ file: File; result: Review; target: string; daily: boolean; mapping: string } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [mapping, setMapping] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the primary action on open; restore focus to the trigger on close.
  useEffect(() => {
    if (!uploadOpen) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Show errors from a page-level drag & drop that opened this dialog.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setFailure(parseError);
      setPreview(null);
      setAcknowledged(false);
      chooseRef.current?.focus();
    });
    return () => { cancelled = true; trigger?.focus(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadOpen]);

  // Escape dismisses (unless an upload is processing), even if focus left the card.
  useEffect(() => {
    if (!uploadOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!loading && !busy) closeUpload();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [uploadOpen, loading, busy, closeUpload]);

  useEffect(() => {
    if (!uploadOpen || !droppedFile || !ready || loading || busy) return;
    const file = droppedFile;
    clearDroppedFile?.();
    void importFile(file);
    // The pending dropped file is consumed once, using the active authorized scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadOpen, droppedFile, ready]);

  if (!uploadOpen) return null;

  function close() {
    if (!loading && !busy) closeUpload();
  }

  async function importFile(file: File, confirmed = false) {
    if (!confirmed) { setPreview(null); setAcknowledged(false); }
    if (!SUPPORTED.test(file.name)) {
      setFailure(rejectedImport(["Choose an Excel workbook, daily CSV, or MRV JSON data export."])); return;
    }
    if (file.size > 20_000_000 || !file.size) {
      setFailure(rejectedImport(["Choose a non-empty file no larger than 20 MB."])); return;
    }
    setFailure(null);
    setBusy(true);
    try {
      const target = scope.activeKey;
      if (!confirmed) {
        const bytes = await file.arrayBuffer();
        let detectedDaily = /\.csv$/i.test(file.name);
        if (/\.(xlsx|xlsm)$/i.test(file.name)) {
          const sheets = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames;
          detectedDaily = sheets.some(s => ["production", "fuel", "electricity"].includes(s.trim().toLowerCase())) && !sheets.includes("00_README_Control");
        }
        setDaily(detectedDaily);
        const query = new URLSearchParams({ filename: file.name, preview: "true" });
        if (detectedDaily) query.set("format", "daily-totals");
        else if (mapping) query.set("mapping", mapping);
        const result = await mrvFetch<Review>(`/orgs/${scope.tenantId}/facilities/${scope.facility?.id}/imports?${query}`, {
          method: "POST", body: bytes, headers: { "content-type": "application/octet-stream" },
        });
        setPreview({ file, result, target, daily: detectedDaily, mapping });
        return;
      }
      if (!preview || preview.target !== target || preview.mapping !== mapping || preview.result.errors.length || !acknowledged) {
        setFailure(rejectedImport(["Review the file again and confirm its destination before importing."])); return;
      }
      const result = await scope.importFile(file, preview.daily ? null : mapping || null, preview.daily ? "daily-totals" : undefined);
      if (result.accepted) closeUpload();
      else setFailure(rejectedImport(result.errors));
    } catch (e) {
      // The scope changed while the import was pending: report its real outcome for the original factory, not a failure.
      setFailure(e instanceof StaleScopeError ? scopeChangedDuringImport(e.message) : importFailureFrom(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadSample() {
    setFailure(null);
    setBusy(true);
    try {
      const result = await scope.loadDemo();
      if (result.accepted) closeUpload();
      else setFailure(rejectedImport(result.errors));
    } catch (e) {
      setFailure(e instanceof StaleScopeError ? scopeChangedDuringImport(e.message) : importFailureFrom(e));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      id="upload-prompt"
      onKeyDown={onKeyDown}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer.files?.[0];
        if (file && !loading && !busy && ready) importFile(file);
      }}
    >
      <div
        ref={dialogRef}
        className="upload-card upload-card-compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-dialog-title"
        aria-describedby="upload-dialog-desc"
        aria-busy={loading || busy}
      >
        <button type="button" className="upload-close" aria-label="Close upload dialog" title="Close" onClick={close} disabled={loading || busy}>
          <Icon name="x" size={18} />
        </button>

        <h2 id="upload-dialog-title">Upload readings</h2>
        <div id="upload-dialog-desc">
          <p>Choose a file, review its contents, then confirm import. Choosing a file does not save readings.</p>
          <ol className="upload-steps" aria-label="Import progress"><li>1. Choose file</li><li aria-current={preview ? "step" : undefined}>2. Review data</li><li>3. Confirm import</li></ol>
          {ready ? (
            <p className="upload-target">Organization: <strong>{scope.memberships.find(m => m.tenantId === scope.tenantId)?.name}</strong><br />Factory: <strong>{scope.facility?.code} · {scope.facility?.name}</strong></p>
          ) : (
            <div className="dataset-banner dataset-banner-warn">
              {scope.status === "signed-out" ? (
                <>
                  <Link href="/signin" onClick={closeUpload}>Sign in</Link> to import — data is stored per organization and factory.
                </>
              ) : scope.status === "no-organization" ? (
                <>
                  <Link href="/onboarding" onClick={closeUpload}>Create an organization</Link> before importing.
                </>
              ) : (
                "Select an authorized factory before importing."
              )}
            </div>
          )}
        </div>

        {ready && !daily ? <details className="upload-help"><summary>Workbook intervals and units</summary>
          <p className="upload-note">Declare how dated workbook rows should be interpreted. Daily files supply their own one-day intervals. Changing these settings requires a new review.</p>
          <fieldset disabled={busy || loading} style={{ border: 0, padding: 0 }}><MappingSelect id="upload-mapping" value={mapping} onChange={v => { setMapping(v); setPreview(null); setAcknowledged(false); }} /></fieldset>
        </details> : null}
        {preview ? <section className="daily-import-preview" aria-label="Import review">
          <h3>Review before importing</h3>
          <strong>{preview.file.name}</strong>
          <p>Detected format: {preview.daily ? "Daily totals" : "MRV workbook / data export"}</p>
          <p>Destination: <strong>{scope.facility?.code} · {scope.facility?.name}</strong><br />Selected reporting period: {scope.range?.start} – {scope.range?.end} ({scope.facility?.timezone})</p>
          <p>File coverage: {preview.result.start ?? "Not available"} – {preview.result.end ?? "Not available"}.</p>
          <dl className="upload-review-counts">{Object.entries(preview.result.sections).filter(([,n]) => n > 0).map(([section,n]) => <div key={section}><dt>{section === "kilnFuel" ? "Fuel" : section === "rawMaterial" ? "Raw materials" : section}</dt><dd>{n} readings</dd></div>)}</dl>
          {preview.result.start && preview.result.end && scope.range && (preview.result.start < scope.range.start || preview.result.end > scope.range.end) ? <p className="dataset-banner dataset-banner-warn">This file includes dates outside the selected reporting period. Confirmation imports all valid file readings.</p> : null}
          {preview.result.missingDailyReadings !== null && preview.result.missingDailyReadings > 0 ? <p>{preview.result.missingDailyReadings} missing daily readings within file coverage, assuming each detected line or meter reports every day. This does not establish coverage of all factory sources.</p> : null}
          <p>{preview.result.count - preview.result.unchanged - preview.result.revisions - preview.result.overlaps} new · {preview.result.unchanged} unchanged · {preview.result.revisions} changed values · {preview.result.overlaps} overlapping intervals</p>
          {preview.result.changes.length ? <details className="upload-help"><summary>Review changed values and overlapping dates ({preview.result.revisions + preview.result.overlaps}; showing up to 20)</summary>
            <ul>{preview.result.changes.map((change, i) => <li key={i}><strong>{change.kind}: {change.section}, {change.start} – {change.end}</strong>
              <ul>{change.fields.map(field => <li key={field.field}>{field.field}: {String(field.before ?? "Empty")} → {String(field.after ?? "Empty")}</li>)}</ul>
            </li>)}</ul>
          </details> : null}
          {preview.result.revisions || preview.result.overlaps ? <p>Changed values create revisions. Review overlapping intervals before continuing.</p> : null}
          {preview.result.missingEvidence > 0 ? <p>{preview.result.missingEvidence} readings have no Evidence ID. Link their source documents before report review.</p> : null}
          <p>{preview.result.configKinds.length ? `Configuration supplied by this file: ${preview.result.configKinds.join(", ")}. These will be versioned on import.` : "This file supplies readings only; existing setup and constants are preserved."}</p>
          {preview.result.errors.length ? <div className="error-banner" role="alert"><strong>Resolve these issues before importing</strong><ul>{preview.result.errors.slice(0,50).map((e,i) => <li key={i}>{e}</li>)}</ul><p>Correct the source file or interval settings, then choose the file again.</p></div> : <>
          <label><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} disabled={busy} /> I reviewed the destination, dates, configuration and changed readings.</label>
          <button type="button" className="btn btn-primary" disabled={busy || loading || !scope.canImport || preview.target !== scope.activeKey || !acknowledged} onClick={() => void importFile(preview.file, true)}>Confirm and import {preview.result.count} readings</button>
          </>}
          {preview.target !== scope.activeKey ? <p role="alert">Factory or reporting period changed. Choose the file again before importing.</p> : null}
          <p className="upload-note">The server validates again on confirmation. Importing does not approve or externally verify a report.</p>
        </section> : null}

        <div style={{ margin: "18px 0 10px" }}>
          <button
            ref={chooseRef}
            type="button"
            className={preview ? "btn btn-secondary" : "btn btn-primary"}
            style={{ fontSize: 14, padding: "12px 24px", width: "100%", minHeight: 48 }}
            onClick={() => inputRef.current?.click()}
            disabled={loading || busy || !ready || !scope.canImport}
          >
            {loading || busy ? (
              <>
                <span className="spinner spinner-sm" aria-hidden="true" /> Processing file…
              </>
            ) : (
              <>
                <Icon name="upload" size={16} /> {preview ? "Choose another file" : "Choose file"}
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            id="file-input-modal"
            accept=".xlsx,.xlsm,.csv,.json"
            tabIndex={-1}
            aria-hidden="true"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFile(file);
              e.target.value = "";
            }}
          />
        </div>

        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 14 }} aria-live="polite">
          {loading || busy ? "Processing on the server. Readings are saved only after confirmation…" : (daily ? "Excel or CSV · Drag & drop also supported" : "Excel or JSON · Drag & drop also supported")}
        </div>

        {failure?.kind === "scope" ? (
          <div className="dataset-banner dataset-banner-warn upload-notice" role="status">
            {failure.messages[0]}
          </div>
        ) : failure ? (
          <div className="error-banner upload-errors" role="alert" data-failure-kind={failure.kind}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Icon name="alert-triangle" size={16} />
              <h3 style={{ margin: 0 }}>{failure.title}</h3>
            </div>
            <ul>
              {failure.messages.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>{failure.hint}</div>
          </div>
        ) : null}

        <div className="upload-secondary">
          <Link href="/dataentry" className="upload-link upload-link-accent" onClick={closeUpload}>
            <Icon name="edit-3" size={12} /> Fill online
          </Link>
          <span aria-hidden="true" style={{ color: "var(--border-strong)" }}>•</span>
          <button type="button" className="upload-link" onClick={downloadBlankTemplate}>
            <Icon name="download" size={11} /> MRV template
          </button>
          <button type="button" className="upload-link" onClick={downloadDailyTemplate}><Icon name="download" size={11} /> Daily totals template</button>
        </div>

        <details className="upload-help">
          <summary>File requirements &amp; import details</summary>
          <p className="upload-note">{daily
            ? "Use Production, Fuel and Electricity sheets, with optional Setup, Constants and Readme sheets. Use the template for column names."
            : "Use the TRACE FORCE MRV collection workbook or a JSON data export. Presentation report exports cannot be imported."}</p>
          <p className="upload-note">Daily totals must cover complete days in {scope.facility?.timezone || "the factory timezone"}. Rates, cumulative counters and unknown SCADA tags need mapping first. Electricity in kWh is converted to MWh.</p>
          <p className="upload-note">Files are private. Re-imports do not duplicate readings; changed values create revisions. Activity-only uploads preserve setup and constants. Missing factors remain flagged.</p>
          {ready && isSynthetic ? <button type="button" className="upload-link" onClick={() => void loadSample()} disabled={loading || busy || !scope.canImport}>
            <Icon name="play" size={12} /> Load synthetic demo data
          </button> : null}
        </details>

        <div className="upload-footer">
          <button type="button" className="btn btn-secondary btn-sm" onClick={close} disabled={loading || busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
