"use client";
/**
 * Evidence Register. Reference rows persist through the normal import flow (scope.saveManual → the
 * evidence_register configuration document); uploaded document FILES are stored in the private bucket as
 * evidence_document rows. References can be registered before any calculation exists — no readings are fabricated.
 * "Mapped" always means linked only: neither the register nor a stored document establishes external verification.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useScope } from "@/context/ScopeContext";
import { useStore } from "@/context/StoreContext";
import { LoadingState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { evidenceCoverage, EVIDENCE_SECTIONS, saveEvidenceReference, safeEvidenceUrl } from "@/lib/evidenceReview";
import { setupDisplay } from "@/lib/setupView";
import { createEmptyInput, type SheetRow, type Store } from "@/lib/types";
import type { EvidenceDocumentView } from "@/lib/mrv/clientTypes";
import { EvidenceDocuments, uploadEvidenceDocumentFile } from "./EvidenceDocuments";
import styles from "./EvidenceWorkspace.module.css";

const FIELDS = ["Evidence ID", "Evidence Type", "Description", "Source System", "Owner", "Reviewer", "Frequency", "Document URL", "Notes"];

function EvidenceContent({ s, fallbackRegister, documents, onRegisterChanged, onDocumentsChanged }: {
  s: Store | null;
  fallbackRegister: SheetRow[];
  documents: EvidenceDocumentView[] | null;
  onRegisterChanged: () => void;
  onDocumentsChanged: () => void;
}) {
  const scope = useScope();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("id") ?? "");
  const [status, setStatus] = useState("");
  const [fileFilter, setFileFilter] = useState("");
  const [draft, setDraft] = useState<SheetRow | null>(null);
  const draftPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (draft) draftPanel.current?.querySelector<HTMLInputElement>("input:not([readonly])")?.focus();
  }, [!!draft]);
  const [editId, setEditId] = useState<string | null>(null);
  const [link, setLink] = useState(false);
  const [category, setCategory] = useState<(typeof EVIDENCE_SECTIONS)[number][1]>("production");
  const [attach, setAttach] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const registerRows = s ? s.inputs.evidence : fallbackRegister;
  const emptyInput = useMemo(() => ({ ...createEmptyInput("manual"), evidence: fallbackRegister }), [fallbackRegister]);
  const input = s ? s.inputs : emptyInput;
  const hasReadings = EVIDENCE_SECTIONS.some(([, key]) => input[key].length > 0);
  const [start, setStart] = useState(String(s?.setup["Period start"] ?? ""));
  const [end, setEnd] = useState(String(s?.setup["Period end"] ?? ""));

  const coverage = evidenceCoverage(input);
  const currentDocuments = documents?.filter((d) => d.isCurrent) ?? [];
  const attachedIds = new Set(currentDocuments.map((d) => d.evidenceId));
  const total = coverage.readings.length;
  const linkedPercent = total ? Math.round(coverage.linked.length / total * 100) : 0;
  const pending = total - coverage.linked.length - coverage.noId.length - coverage.unknown.length;
  const fmt = (value: number) => value.toLocaleString();
  const clearFilters = () => { setSearch(""); setStatus(""); setFileFilter(""); };
  const rows = registerRows.filter(
    (r) => (!status || r.Status === status)
      && (!fileFilter || (fileFilter === "attached" ? attachedIds.has(String(r["Evidence ID"] ?? "").trim()) : !attachedIds.has(String(r["Evidence ID"] ?? "").trim())))
      && JSON.stringify(r).toLowerCase().includes(search.toLowerCase())
  );

  function edit(row?: SheetRow) {
    setDraft(row ? { ...row } : { "Evidence ID": "", "Evidence Type": "", Description: "", Owner: "", Status: "Pending" });
    setEditId(row ? String(row["Evidence ID"]) : null);
    setLink(false);
    setAttach(null);
    setMessage("");
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setMessage("");
    try {
      const updated = saveEvidenceReference(input, draft, editId, link && hasReadings ? { key: category, start, end } : undefined);
      // Without a stored calculation the save carries no readings, so it must declare the selected reporting
      // period explicitly — the register is then stored for that period (nothing is invented).
      const result = await scope.saveManual(updated.input, undefined, s || !scope.range ? undefined : { start: scope.range.start, end: scope.range.end });
      if (!result.accepted) {
        setMessage(result.errors.join(" "));
      } else {
        const id = (editId ?? String(draft["Evidence ID"] ?? "")).trim();
        if (attach) {
          try {
            await uploadEvidenceDocumentFile(
              { tenantId: scope.tenantId, facilityId: scope.facilityId },
              attach,
              { evidenceId: id },
              () => {}
            );
            onDocumentsChanged();
            setMessage("Evidence reference and document saved. Review the updated calculation and linkage checks.");
          } catch (e) {
            setMessage(`Reference saved, but the document upload failed: ${e instanceof Error ? e.message : "unknown error"}. Retry from the reference's Documents panel.`);
          }
        } else {
          setMessage(updated.linked ? `Evidence reference saved and linked to ${updated.linked} readings. Review the updated calculation and linkage checks.` : "Evidence reference saved. Review the updated calculation and linkage checks.");
        }
        setDraft(null);
        setAttach(null);
        if (!s) onRegisterChanged();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function exportRegister() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              period: s ? { start: s.setup["Period start"], end: s.setup["Period end"] } : null,
              synthetic: s?.meta.synthetic ?? false,
              verification: "Not established by this register",
              evidence: rows,
            },
            null,
            2
          ),
        ],
        { type: "application/json" }
      )
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "MRV_Evidence_References.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className={`page-container dcs-workspace ${styles.workspace}`}>
      <div className={styles.heading}>
      <div>
      <span className={styles.eyebrow}>REPORTS & ASSURANCE</span>
      <PageHeader
        icon="folder"
        title="Evidence Register"
        desc="Manage document references, upload their files and trace links to the selected calculation’s readings."
      />
      </div>
      <div className={`dcs-intro ${styles.actions}`}>
        <button className="btn btn-primary" disabled={!scope.canImport || busy} onClick={() => edit()}>
          Add evidence
        </button>
        <button className="btn btn-secondary" disabled={!rows.length} onClick={exportRegister}>
          Export filtered register
        </button>
        <Link href="/qaqc">Review evidence QA/QC</Link>
      </div>

      </div>
      <section aria-label="Evidence summary" className={`section-card dcs-summary ${styles.metrics}`}>
        <div>
          <strong>{fmt(registerRows.length)}</strong>
          <span>Registered references</span>
        </div>
        <div>
          <strong>{fmt(coverage.linked.length)}</strong>
          <span>Readings linked to mapped references</span>
        </div>
        <div>
          <strong>{fmt(coverage.noId.length)}</strong>
          <span>Readings without an evidence ID</span>
        </div>
        <div>
          <strong>{fmt(coverage.unknown.length)}</strong>
          <span>Readings citing an unknown ID</span>
        </div>
      </section>

      <div className={styles.overview}>
        <section className={styles.panel} aria-labelledby="evidence-coverage-title">
          <div className={styles.panelHeading}><div><span className={styles.eyebrow}>READING TRACEABILITY</span><h2 id="evidence-coverage-title">Evidence linkage</h2></div><span className={styles.scopeTag}>Selected calculation</span></div>
          <div className={styles.coverageBody}>
            <div className={styles.ring} role="img" aria-label={total ? `${linkedPercent}% of ${fmt(total)} readings link to mapped references` : "No readings available"} style={{ background: `conic-gradient(#198178 ${linkedPercent}%, #edf1f5 0)` }}>
              <div><strong>{total ? `${linkedPercent}%` : "—"}</strong><span>{total ? "linked to mapped" : "No readings"}</span></div>
            </div>
            <dl className={styles.legend}>
              <div><dt><i className={styles.mapped} />Mapped reference</dt><dd>{fmt(coverage.linked.length)}</dd></div>
              <div><dt><i className={styles.pending} />Reference needs mapping</dt><dd>{fmt(pending)}</dd></div>
              <div><dt><i className={styles.missing} />No evidence ID</dt><dd>{fmt(coverage.noId.length)}</dd></div>
              <div><dt><i className={styles.unknown} />Unknown evidence ID</dt><dd>{fmt(coverage.unknown.length)}</dd></div>
            </dl>
          </div>
          <p className={styles.caption}>Linkage tracks references, not document validity or external verification.</p>
        </section>
        <section className={styles.panel} aria-labelledby="evidence-next-title">
          <span className={styles.eyebrow}>NEXT STEPS</span><h2 id="evidence-next-title">Build a traceable evidence trail</h2>
          <ol className={styles.steps}>
            <li><span>01</span><div><strong>Register the source</strong><p>Give each invoice, certificate or measurement record a unique evidence ID.</p></div></li>
            <li><span>02</span><div><strong>Attach the supporting file</strong><p>Keep documents private, with previous versions retained.</p></div></li>
            <li><span>03</span><div><strong>Connect the readings</strong><p>Link only the input category and dates supported by that document.</p></div></li>
          </ol>
          <a href="#evidence-gaps" className={styles.textLink}>Inspect evidence gaps ↓</a>
        </section>
      </div>
      <details className={styles.assurance}>
        <summary>Scope, privacy & verification</summary>
        <p>Counts cover production, raw materials, fuel and electricity in the displayed calculation. “Mapped” means linked only. Document contents, reviewer names and URLs do not establish external verification. {s ? "" : "No calculation exists yet for this factory. References are kept for use when readings arrive. "}Evidence files are stored privately; preview links are short-lived and available only to signed-in organization members.</p>
      </details>
      {message && (
        <div className="dcs-message" role="status">
          {message}
        </div>
      )}

      {draft && (
        <section ref={draftPanel} className="section-card dcs-review">
          <h2>{editId ? "Edit evidence reference" : "Add evidence"}</h2>
          <fieldset disabled={busy}>
            <div className="dcs-form-grid">
              {FIELDS.map((field) => (
                <label key={field}>
                  {field}{["Evidence ID", "Description", "Owner"].includes(field) ? " *" : ""}
                  <input
                    required={["Evidence ID", "Description", "Owner"].includes(field)}
                    value={String(draft[field] ?? "")}
                    readOnly={field === "Evidence ID" && !!editId}
                    type={field === "Document URL" ? "url" : "text"}
                    onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <label className="dcs-filter">
              <input type="checkbox" checked={link} disabled={!hasReadings} onChange={(e) => setLink(e.target.checked)} />
              Link this reference to readings in a coverage period{!hasReadings ? " (available once readings exist)" : ""}
            </label>
            {link && hasReadings && (
              <>
                <div className="dcs-form-grid">
                  <label>
                    Input category
                    <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
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
                <p>
                  {input[category].filter(
                    (r) => String(r["Interval Start"] ?? "") >= start && String(r["Interval End"] ?? "") <= end && !!r["Interval Start"] && !!r["Interval End"] && (!r["Evidence ID"] || r["Evidence ID"] === draft["Evidence ID"])
                  ).length}{" "}
                  eligible readings. Links only rows wholly inside these dates and leaves links to other evidence unchanged. Confirm the document supports every selected reading; recording a link does not validate its contents.
                </p>
              </>
            )}
            <div className="dcs-form-grid">
              <label>
                Evidence file
                <input type="file" accept=".pdf,.xlsx,.xlsm,.csv,.jpg,.jpeg,.png" onChange={(e) => setAttach(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            {attach ? <p className="evidence-doc-meta">“{attach.name}” will be uploaded to the private evidence store after the reference is saved.</p> : null}
            <p>Saving creates persisted configuration/reading revisions through the existing import workflow and recalculates the selected inputs.</p>
            <button className="btn btn-primary" disabled={busy || !scope.canImport} onClick={() => void save()}>
              {busy ? "Saving…" : "Save reference & selected links"}
            </button>
            <button className="btn btn-secondary" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </fieldset>
        </section>
      )}

      <section className={`section-card dcs-review ${styles.register}`} aria-labelledby="document-references-title">
        <div className={styles.panelHeading}><div><span className={styles.eyebrow}>DOCUMENT LIBRARY</span><h2 id="document-references-title">Document references</h2></div><span className={styles.scopeTag}>{rows.length} of {registerRows.length} references</span></div>
        <div className="dcs-filter">
          <label>
            Search references
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID, description, owner or source" />
          </label>
          <label>
            Linkage status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {[...new Set(registerRows.map((r) => String(r.Status ?? "")))].filter(Boolean).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Supporting file
            <select value={fileFilter} disabled={documents === null} onChange={(e) => setFileFilter(e.target.value)}>
              <option value="">All references</option><option value="attached">File attached</option><option value="missing">No file attached</option>
            </select>
          </label>
          <button className="btn btn-secondary" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
        {documents === null && <p role="status" className={styles.caption}>Document information is unavailable or still loading. <button type="button" className={styles.textLink} onClick={onDocumentsChanged}>Refresh documents</button></p>}
        {!rows.length ? (
          <div className={styles.empty}>
            <span className={styles.eyebrow}>EVIDENCE WORKSPACE</span>
            <h3>{registerRows.length ? "No matching references" : "No evidence references registered"}</h3>
            <p>
              {registerRows.length ? "Try another search or clear the filters to see your registered references." : "Start with an electricity invoice, fuel delivery record, laboratory certificate or calibration record. Synthetic demo readings are not documentary evidence."}
            </p>
            <button className="btn btn-primary" disabled={!registerRows.length && (!scope.canImport || busy)} onClick={registerRows.length ? clearFilters : () => edit()}>{registerRows.length ? "Clear filters" : "Add your first evidence reference"}</button>
          </div>
        ) : (
          <div className="dcs-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Evidence ID</th>
                  <th>Type / description</th>
                  <th>Source & owner</th>
                  <th>Declared status</th>
                  <th>Linked readings</th>
                  <th>Documents</th>
                  <th>Details / action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const id = String(r["Evidence ID"] ?? "");
                  const associated = coverage.readings.filter((x) => x.id === id);
                  const url = safeEvidenceUrl(r["Document URL"]);
                  return (
                    <tr key={`${id}-${i}`}>
                      <th scope="row">{id}</th>
                      <td>
                        {setupDisplay(r["Evidence Type"])}
                        <p>{setupDisplay(r.Description)}</p>
                      </td>
                      <td>
                        {setupDisplay(r["Source System"])}
                        <p>{setupDisplay(r.Owner)}</p>
                      </td>
                      <td><span className={r.Status === "Mapped" ? styles.mappedBadge : styles.pendingBadge}>{setupDisplay(r.Status)}</span></td>
                      <td>
                        <details>
                          <summary>{associated.length} reading links</summary>
                          <pre>{JSON.stringify(associated.map((x) => ({ category: x.label, row: x.index + 1, reading: x.row })), null, 2)}</pre>
                        </details>
                      </td>
                      <td>
                        {documents === null ? <span>Document information unavailable</span> : <EvidenceDocuments evidenceId={id} docs={documentsFor(id)} onChanged={onDocumentsChanged} canUpload={scope.canImport} />}
                      </td>
                      <td>
                        {url && (
                          <a href={url} target="_blank" rel="noreferrer">
                            Open external HTTPS link
                          </a>
                        )}
                        <details>
                          <summary>All reference fields</summary>
                          <pre>{JSON.stringify(r, null, 2)}</pre>
                        </details>
                        <button className="btn btn-secondary" disabled={!scope.canImport || busy} onClick={() => edit(r)}>
                          Edit reference
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section id="evidence-gaps" className={`section-card dcs-review ${styles.gaps}`}>
        <div className={styles.panelHeading}><div><span className={styles.eyebrow}>COVERAGE BY INPUT</span><h2>Evidence gaps by input</h2></div><Link href="/dcs" className={styles.textLink}>Explore source readings →</Link></div>
        <div className={styles.categoryGrid}>
          {EVIDENCE_SECTIONS.map(([label, key]) => {
            const count = input[key].length;
            const linked = coverage.linked.filter((x) => x.key === key).length;
            const percent = count ? Math.round(linked / count * 100) : 0;
            return <div key={key} className={styles.category}><div><strong>{label}</strong><span>{count ? `${percent}%` : "No readings"}</span></div><progress aria-label={`${label} mapped reading linkage`} max={count || 1} value={linked} /><p>{fmt(linked)} of {fmt(count)} readings linked to mapped references</p></div>;
          })}
        </div>
        <div className="dcs-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Input</th>
                <th>Rows</th>
                <th>No ID</th>
                <th>Unknown ID</th>
                <th>Inspect readings</th>
              </tr>
            </thead>
            <tbody>
              {EVIDENCE_SECTIONS.map(([label, key]) => (
                <tr key={key}>
                  <th>{label}</th>
                  <td>{input[key].length}</td>
                  <td>{coverage.noId.filter((x) => x.key === key).length}</td>
                  <td>{coverage.unknown.filter((x) => x.key === key).length}</td>
                  <td>
                    <Link href="/dcs">Open source readings</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Retain the monitoring plan, measurement records, calculation basis and applicable verification report for CBAM evidence handoff. This register does not submit a
          CBAM declaration.
        </p>
      </section>
    </div>
  );

  function documentsFor(id: string): EvidenceDocumentView[] {
    return documents?.filter((d) => d.evidenceId === id) ?? [];
  }
}

export default function EvidencePage() {
  const scope = useScope();
  const { store, loading } = useStore();
  const s = store && store._valid ? store : null;
  const [fallbackRegister, setFallbackRegister] = useState<SheetRow[]>([]);
  const [documents, setDocuments] = useState<EvidenceDocumentView[] | null>(null);
  const ready = scope.status === "ready" && !!scope.tenantId && !!scope.facilityId;

  const loadRegister = useCallback(async () => {
    if (!ready) return;
    try {
      const r = await scope.scopedFetch<{ rows: SheetRow[] }>(`/orgs/${scope.tenantId}/facilities/${scope.facilityId}/evidence-register`);
      setFallbackRegister(r.rows);
    } catch {
      setFallbackRegister([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.activeKey, ready]);

  const loadDocuments = useCallback(async () => {
    if (!ready) return;
    try {
      setDocuments(await scope.scopedFetch<EvidenceDocumentView[]>(`/orgs/${scope.tenantId}/facilities/${scope.facilityId}/evidence-documents`));
    } catch {
      setDocuments(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.activeKey, ready]);

  useEffect(() => {
    void loadDocuments();
    if (!s) void loadRegister();
  }, [loadDocuments, loadRegister, s]);

  if (loading || scope.status === "loading") return <LoadingState />;

  return (
    <Suspense fallback={null}>
      <EvidenceContent
        key={`${scope.activeKey}/${s?.meta.revision ?? "none"}/${s?.meta.run?.id ?? "none"}`}
        s={s}
        fallbackRegister={fallbackRegister}
        documents={documents}
        onRegisterChanged={() => void loadRegister()}
        onDocumentsChanged={() => void loadDocuments()}
      />
    </Suspense>
  );
}