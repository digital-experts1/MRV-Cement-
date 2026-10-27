"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { StaleScopeError, useScope } from "@/context/ScopeContext";
import { useStore } from "@/context/StoreContext";
import { downloadBlankTemplate } from "@/lib/export";
import { importFailureFrom, rejectedImport, scopeChangedDuringImport, type ImportFailure } from "@/lib/mrv/importFailure";
import { MappingSelect } from "./MappingSelect";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), [tabindex]:not([tabindex="-1"])';
const SUPPORTED = /\.(xlsx|xlsm|json)$/i;

export function UploadPrompt() {
  const { uploadOpen, closeUpload, loading, parseError } = useStore();
  const scope = useScope();
  const isSynthetic = scope.memberships.find((m) => m.tenantId === scope.tenantId)?.synthetic ?? false;
  const ready = scope.status === "ready" && !!scope.facility;
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [busy, setBusy] = useState(false);
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
      if (!loading) closeUpload();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [uploadOpen, loading, closeUpload]);

  if (!uploadOpen) return null;

  function close() {
    if (!loading) closeUpload();
  }

  async function importFile(file: File) {
    if (!SUPPORTED.test(file.name)) {
      setFailure(rejectedImport([`"${file.name}" is not a supported file. Choose an .xlsx/.xlsm workbook or a TRACE FORCE MRV data export (.json).`]));
      return;
    }
    setFailure(null);
    setBusy(true);
    try {
      const result = await scope.importFile(file, mapping || null);
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
        className="upload-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-dialog-title"
        aria-describedby="upload-dialog-desc"
        aria-busy={loading}
      >
        <button type="button" className="upload-close" aria-label="Close upload dialog" title="Close" onClick={close} disabled={loading}>
          <Icon name="x" size={18} />
        </button>

        <div className="uc-logo-mark" aria-hidden="true">
          <Icon name="upload" size={30} />
        </div>
        <h2 id="upload-dialog-title">Upload Readings File</h2>
        <div id="upload-dialog-desc">
          <p>
            Choose a completed TRACE FORCE MRV cement workbook (.xlsx or .xlsm) or a data export (.json). Inputs are validated
            and emissions are recalculated by the platform; workbook totals and statuses are used for comparison only.
          </p>
          <p className="upload-note">
            SCADA, DCS, ERP or lab readings must first be entered into the workbook template — raw SCADA exports are not imported directly.
          </p>
          {ready ? (
            <p className="upload-note">
              Target: <strong>{scope.facility?.code} · {scope.facility?.name}</strong>. Readings are stored as history (re-imports never duplicate;
              changed values become new revisions) and the original file is kept privately.
            </p>
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

        {ready ? <MappingSelect id="upload-mapping" value={mapping} onChange={setMapping} /> : null}

        <div style={{ margin: "18px 0 10px" }}>
          <button
            ref={chooseRef}
            type="button"
            className="btn btn-primary"
            style={{ fontSize: 13, padding: "10px 24px" }}
            onClick={() => inputRef.current?.click()}
            disabled={loading || busy || !ready || !scope.canImport}
          >
            {loading || busy ? (
              <>
                <span className="spinner spinner-sm" aria-hidden="true" /> Reading workbook…
              </>
            ) : (
              <>
                <Icon name="upload" size={16} /> Choose file (.xlsx, .xlsm, .json)
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            id="file-input-modal"
            accept=".xlsx,.xlsm,.json"
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
          {loading || busy ? "Uploading, validating, storing readings and calculating on the server…" : "or drag & drop the workbook onto this dialog"}
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
          {ready && isSynthetic ? (
            <>
              <button type="button" className="upload-link" onClick={() => void loadSample()} disabled={loading || busy || !scope.canImport}>
                <Icon name="play" size={11} /> Load synthetic demo data
              </button>
              <span aria-hidden="true" style={{ color: "var(--border-strong)" }}>•</span>
            </>
          ) : null}
          <button type="button" className="upload-link" onClick={downloadBlankTemplate}>
            <Icon name="download" size={11} /> Blank template
          </button>
        </div>

        <div className="uc-steps" aria-hidden="true">
          <div className="uc-step">
            <span className="uc-step-num">1</span>
            <span>Upload workbook</span>
          </div>
          <div className="uc-step-arrow">
            <Icon name="chevron-right" size={13} />
          </div>
          <div className="uc-step">
            <span className="uc-step-num">2</span>
            <span>Auto-parse &amp; validate</span>
          </div>
          <div className="uc-step-arrow">
            <Icon name="chevron-right" size={13} />
          </div>
          <div className="uc-step">
            <span className="uc-step-num">3</span>
            <span>Explore dashboard</span>
          </div>
        </div>

        <div className="upload-footer">
          <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "left" }}>
            Supports: <strong style={{ color: "var(--text-secondary)" }}>TRACE_FORCE_MRV_Cement_QAQC_V28_Collection_Workbook</strong>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={close} disabled={loading}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
