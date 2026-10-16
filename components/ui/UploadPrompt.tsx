"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { useStore } from "@/context/StoreContext";
import { downloadBlankTemplate } from "@/lib/export";
import { calculateStore, createSampleDataset } from "@/lib/calcEngine";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), [tabindex]:not([tabindex="-1"])';
const SUPPORTED = /\.(xlsx|xlsm)$/i;

export function UploadPrompt() {
  const { uploadOpen, closeUpload, handleFile, setStoreData, loading, parseError } = useStore();
  const [errors, setErrors] = useState<string[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the primary action on open; restore focus to the trigger on close.
  useEffect(() => {
    if (!uploadOpen) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Show errors from a page-level drag & drop that opened this dialog.
    setErrors(parseError ? parseError.split("\n") : []);
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
      setErrors([`"${file.name}" is not a supported file. Please choose an .xlsx or .xlsm workbook.`]);
      return;
    }
    setErrors([]);
    const result = await handleFile(file);
    if (result.length === 0) closeUpload();
    else setErrors(result);
  }

  function loadSample() {
    setStoreData(calculateStore(createSampleDataset()));
    closeUpload();
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
        if (file && !loading) importFile(file);
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
            Choose a completed TRACE FORCE MRV cement workbook (.xlsx or .xlsm). All 14 sheets are validated, QA/QC checks run,
            and emissions are calculated in your browser.
          </p>
          <p className="upload-note">
            SCADA, DCS, ERP or lab readings must first be entered into the workbook template — raw SCADA exports are not imported directly.
          </p>
        </div>

        <div style={{ margin: "18px 0 10px" }}>
          <button
            ref={chooseRef}
            type="button"
            className="btn btn-primary"
            style={{ fontSize: 13, padding: "10px 24px" }}
            onClick={() => inputRef.current?.click()}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner spinner-sm" aria-hidden="true" /> Reading workbook…
              </>
            ) : (
              <>
                <Icon name="upload" size={16} /> Choose workbook (.xlsx, .xlsm)
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            id="file-input-modal"
            accept=".xlsx,.xlsm"
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
          {loading ? "Parsing sheets and running QA/QC checks…" : "or drag & drop the workbook onto this dialog"}
        </div>

        {errors.length > 0 ? (
          <div className="error-banner upload-errors" role="alert">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Icon name="alert-triangle" size={16} />
              <h3 style={{ margin: 0 }}>We couldn&apos;t import this workbook</h3>
            </div>
            <ul>
              {errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>
              Any previously loaded data has been kept. Fix the file and try again.
            </div>
          </div>
        ) : null}

        <div className="upload-secondary">
          <Link href="/dataentry" className="upload-link upload-link-accent" onClick={closeUpload}>
            <Icon name="edit-3" size={12} /> Fill online
          </Link>
          <span aria-hidden="true" style={{ color: "var(--border-strong)" }}>•</span>
          <button type="button" className="upload-link" onClick={loadSample} disabled={loading}>
            <Icon name="play" size={11} /> Load demo data
          </button>
          <span aria-hidden="true" style={{ color: "var(--border-strong)" }}>•</span>
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
