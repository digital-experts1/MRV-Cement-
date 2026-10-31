"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import { useScope } from "@/context/ScopeContext";
import { setupDisplay, setupViewRows } from "@/lib/setupView";
import type { Store } from "@/lib/types";

function SetupContent({ s }: { s: Store }) {
  const scope = useScope();
  const [search, setSearch] = useState("");
  const rows = setupViewRows(s.setup, s.setupRows);
  const filtered = rows.filter(row => Object.values(row).some(v => setupDisplay(v).toLowerCase().includes(search.toLowerCase())));
  const missing = s.completeness.missing.filter(item => item.startsWith("01_Setup:"));
  const values = [
    ["Installation", s.setup["Installation / site"]], ["Country", s.setup.Country],
    ["Primary product", s.setup["Primary product"]], ["Accounting boundary", s.setup["Boundary approach"]],
    ["Calcination method", s.setup["Selected calcination method"]], ["Factory timezone", scope.facility?.timezone],
  ];
  return <>
    <section className="section-card setup-period" aria-label="Reporting period context">
      <div><h3>Selected reporting period</h3><p className="setup-dates">{scope.range?.start ?? setupDisplay(s.setup["Period start"])} <span>to</span> {scope.range?.end ?? setupDisplay(s.setup["Period end"])}</p><p>Use Reporting range above to select a month, quarter, year or custom dates. Results use the stored readings for that range.</p></div>
      <div className="setup-period-actions"><Link className="btn btn-primary" href="/overview">View period results</Link><button className="btn btn-secondary" disabled={!scope.canCalculate || scope.calculating} onClick={scope.recalculate}>{scope.calculating ? "Loading period…" : "Recalculate period"}</button></div>
    </section>
    <section className="section-card">
      <SectionHeader icon="factory" title="Facility & calculation basis" />
      <dl className="setup-facts">{values.map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{setupDisplay(value)}</dd></div>)}</dl>
      <p className="setup-context-note">These are the settings used by the displayed calculation{s.meta.run ? `, created ${s.meta.run.created_at}` : ""}. Editing settings uses Data Entry Studio’s existing validation and save workflow.</p>
    </section>
    <section className="section-card setup-readiness" aria-label="Setup review">
      <h3>{missing.length ? `${missing.length} required setup field${missing.length === 1 ? "" : "s"} need attention` : "Required setup checks complete"}</h3>
      {missing.length ? <ul>{missing.map(item => <li key={item}>{item.replace("01_Setup: ", "")}</li>)}</ul> : <p>This covers required setup fields only. Review QA/QC and evidence separately before using the report.</p>}
      <div className="setup-links"><Link href="/qaqc">Review QA/QC</Link><Link href="/constants">Emission factors & NCV</Link><Link href="/evidence">Evidence register</Link></div>
    </section>
    <section className="section-card">
      <SectionHeader icon="sliders" title={`All setup parameters (${rows.length})`} />
      <div className="setup-search"><label htmlFor="setup-search">Find a parameter</label><input id="setup-search" type="search" className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search values, owners or notes" /></div>
      <div className="setup-table-scroll"><table className="gov-table"><thead><tr><th>Parameter</th><th>Effective value</th><th>Unit</th><th>Requirement</th><th>Owner</th><th>Notes & source</th></tr></thead><tbody>
        {filtered.map((row, i) => <tr key={`${String(row.Parameter)}-${i}`}><th scope="row">{setupDisplay(row.Parameter)}</th><td>{setupDisplay(row.Value)}</td><td>{row.Unit == null || row.Unit === "" ? "—" : setupDisplay(row.Unit)}</td><td>{row["Required?"] === "Yes" ? "Required" : row["Required?"] === "No" ? "Optional" : "Not declared"}</td><td>{setupDisplay(row["Governance owner"])}</td><td>{row.Notes ? setupDisplay(row.Notes) : "—"}{row._source ? <details><summary>Source details</summary><pre>{JSON.stringify(row._source, null, 2)}</pre></details> : null}</td></tr>)}
        {!filtered.length && <tr><td colSpan={6}>No parameters match your search.</td></tr>}
      </tbody></table></div>
      <p className="setup-context-note">{filtered.length} of {rows.length} parameters shown. Undeclared requirements and owners are not inferred.</p>
    </section>
  </>;
}

export default function SetupPage() {
  const scope = useScope();
  return <div className="page-container setup-workspace">
    <PageHeader icon="settings" title="Setup & Reporting Period" desc="Review the facility, accounting boundary and methodology behind your selected results." />
    <div className="setup-toolbar">{scope.canImport ? <Link className="btn btn-primary" href="/dataentry">Edit setup in Data Entry Studio</Link> : <span>Setup changes require import permission for this factory.</span>}<span>Saved calculations retain their original configuration.</span></div>
    <RequireWorkbook title="Setup">{s => <SetupContent key={`${scope.activeKey}:${s.meta.revision}`} s={s} />}</RequireWorkbook>
  </div>;
}
