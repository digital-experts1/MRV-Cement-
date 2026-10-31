"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { StaleScopeError, useScope } from "@/context/ScopeContext";
import { useStore } from "@/context/StoreContext";
import { downloadBlankTemplate } from "@/lib/export";
import { importFailureFrom, rejectedImport, scopeChangedDuringImport, type ImportFailure } from "@/lib/mrv/importFailure";
import { downloadDailyTemplate, parseDailyTotals, type DailyImport } from "@/lib/mrv/dailyTotals";
import { MappingSelect } from "./MappingSelect";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const SUPPORTED = /\.(xlsx|xlsm|json)$/i;

export function UploadPrompt() {
  const { uploadOpen, closeUpload, loading, parseError } = useStore();
  const scope = useScope();
  const isSynthetic = scope.memberships.find((m) => m.tenantId === scope.tenantId)?.synthetic ?? false;
  const ready = scope.status === "ready" && !!scope.facility;
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [daily, setDaily] = useState(false);
  const [preview, setPreview] = useState<{ file: File; result: DailyImport; target: string } | null>(null);
  const [mapping, setMapping] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the primary action on open; restore focus to the trigger on close.
  useEffect(() => {
    if (!uploadOpen) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Show errors from a page-level drag & drop that opened this dialog.
    setFailure(parseError);
    setPreview(null);
    chooseRef.current?.focus();
    return () => trigger?.focus();
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

  if (!uploadOpen) return null;

  function close() {
    if (!loading && !busy) closeUpload();
  }

  async function importFile(file: File, confirmed = false) {
    if (!(daily ? /\.(csv|xlsx|xlsm)$/i : SUPPORTED).test(file.name)) {
      setFailure(rejectedImport([`"${file.name}" is not a supported file. Choose Excel/JSON in MRV mode, or Excel/CSV in daily totals mode.`]));
      return;
    }
    setFailure(null);
    setBusy(true);
    try {
      const target = `${scope.tenantId}/${scope.facility?.id}`;
      if (daily && !confirmed) {
        const result = parseDailyTotals(await file.arrayBuffer(), file.name);
        if (!result.store._valid) { setFailure(rejectedImport(result.store._errors)); setPreview(null); return; }
        setPreview({ file, result, target });
        return;
      }
      if (daily && preview?.target !== target) {
        setFailure(rejectedImport(["The selected factory changed. Choose the file again to review its destination."]));
        setPreview(null); return;
      }
      const result = await scope.importFile(file, daily ? null : mapping || null, daily ? "daily-totals" : undefined);
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
          <p>Choose your format, then upload a file.</p>
          {ready ? (
            <p className="upload-target">Factory: <strong>{scope.facility?.code} · {scope.facility?.name}</strong></p>
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

        {ready ? <label className="mapping-select">
          <span>Import format</span>
          <select className="form-input" aria-label="Import format" disabled={loading || busy} value={daily ? "daily" : "mrv"}
            onChange={e => { setDaily(e.target.value === "daily"); setPreview(null); setFailure(null); }}>
            <option value="mrv">MRV workbook or JSON data export</option>
            <option value="daily">Daily totals — Excel or CSV</option>
          </select>
        </label> : null}
        {ready && !daily ? <MappingSelect id="upload-mapping" value={mapping} onChange={setMapping} /> : null}
        
        {preview && daily ? <div className="daily-import-preview" role="status">
          <strong>{preview.file.name}</strong>
          <p>{preview.result.start} – {preview.result.end}: {Object.entries(preview.result.counts).map(([s,n]) => `${n} ${s.toLowerCase()} readings`).join(", ")}</p>
          <p>Target: {scope.facility?.code} · {scope.facility?.name}. {preview.result.configKinds.length ? "This file also supplies setup/constants versions." : "Existing setup and constants will be used; configure them first if missing."}</p>
          <button type="button" className="btn btn-primary" disabled={busy || loading || !scope.canImport || preview.target !== `${scope.tenantId}/${scope.facility?.id}`} onClick={() => void importFile(preview.file, true)}>Import daily readings</button>
        </div> : null}

        <div style={{ margin: "18px 0 10px" }}>
          <button
            ref={chooseRef}
            type="button"
            className="btn btn-primary"
            style={{ fontSize: 14, padding: "12px 24px", width: "100%", minHeight: 48 }}
            onClick={() => inputRef.current?.click()}
            disabled={loading || busy || !ready || !scope.canImport}
          >
            {loading || busy ? (
              <>
                <span className="spinner spinner-sm" aria-hidden="true" /> Reading workbook…
              </>
            ) : (
              <>
                <Icon name="upload" size={16} /> Choose file
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            id="file-input-modal"
            accept={daily ? ".xlsx,.xlsm,.csv" : ".xlsx,.xlsm,.json"}
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
          {loading || busy ? "Uploading, validating, storing readings and calculating on the server…" : (daily ? "Excel or CSV · Drag & drop also supported" : "Excel or JSON · Drag & drop also supported")}
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
          <button type="button" className="upload-link" onClick={daily ? downloadDailyTemplate : downloadBlankTemplate}>
            <Icon name="download" size={11} /> {daily ? "Daily totals template" : "Blank template"}
          </button>
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
