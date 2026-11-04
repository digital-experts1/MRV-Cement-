"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useScope, type ScopeFacility } from "@/context/ScopeContext";
import { mrvFetch } from "@/lib/apiClient";
import { PageHeader } from "@/components/ui/PageHeader";
import { ScopeNotice } from "@/components/ui/ScopeNotice";
import { Fmt } from "@/components/ui/Fmt";
import { PortfolioPerformance } from "@/components/charts/PortfolioPerformance";
import { PORTFOLIO_METRICS, portfolioIssues, portfolioSum, portfolioValue } from "@/lib/mrv/portfolio";
import type { CalcResponse, RunView } from "@/lib/mrv/clientTypes";

type FactoryResult = { facility: ScopeFacility; view: RunView | null; error?: string };

export default function PortfolioPage() {
  const scope = useScope();
  if (scope.status !== "ready" || !scope.tenantId) return <div className="page-container"><PageHeader icon="trending-up" title="Factory portfolio" /><ScopeNotice signIn={scope.status === "signed-out"} title={scope.status === "loading" ? "Loading organization…" : "Select an organization to view its factories"} desc="Only factories you are authorized to access are included." /></div>;
  if (!scope.range) return <div className="page-container"><PageHeader icon="trending-up" title="Factory portfolio" /><p>Select a factory and reporting period in the workspace controls. If no factories are available, ask your tenant administrator to assign access.</p></div>;
  // Remount before rendering any data from a previous user, tenant, permission set or date range.
  const key = JSON.stringify([scope.user?.id, scope.tenantId, scope.range.start, scope.range.end, scope.facilities]);
  return <PortfolioContent key={key} tenantId={scope.tenantId} start={scope.range.start} end={scope.range.end} />;
}

function PortfolioContent({ tenantId, start, end }: { tenantId: string; start: string; end: string }) {
  const { memberships, facilities, selectFacility, run } = useScope();
  const router = useRouter();
  const [rows, setRows] = useState<FactoryResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const org = memberships.find(m => m.tenantId === tenantId);
  const authorized = useMemo(() => facilities.filter(f => f.permissions.includes("facility.read")), [facilities]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setRows([]);
    const spec = encodeURIComponent(JSON.stringify({ preset: "custom", start, end }));
    void (async () => {
      const results: FactoryResult[] = [];
      // Limit concurrent requests for organizations with many plants.
      for (let i = 0; i < authorized.length; i += 4) {
        const batch = await Promise.all(authorized.slice(i, i + 4).map(async facility => {
          try {
            const result = await mrvFetch<{ view: RunView | null }>(`/orgs/${tenantId}/facilities/${facility.id}/runs/latest?range=${spec}`, { signal: controller.signal });
            if ((!result.view || result.view.run.stale) && facility.permissions.includes("calculation.run")) {
              const calculated = await mrvFetch<CalcResponse>(`/orgs/${tenantId}/facilities/${facility.id}/runs`, {
                method: "POST", json: { range: { preset: "custom", start, end } }, signal: controller.signal,
              });
              return { facility, view: calculated.view, ...(!calculated.view && calculated.note ? { error: calculated.note } : {}) };
            }
            return { facility, view: result.view };
          } catch (e) {
            return { facility, view: null, error: e instanceof Error ? e.message : "Could not load this factory. Try Refresh." };
          }
        }));
        if (controller.signal.aborted) return;
        results.push(...batch);
      }
      setRows(results);
      setLoading(false);
    })();
    return () => controller.abort();
  }, [authorized, tenantId, start, end, refresh, run?.id]);

  const issues = (r: FactoryResult) => r.error ? [r.error] : portfolioIssues(r.view, start, end);
  const current = rows.filter(r => r.view && !r.error && r.view.run.range_start === start && r.view.run.range_end === end && !r.view.run.stale && !r.view.run.archived && r.view.run.integrity.stored === "intact" && r.view.run.integrity.sameEngine && r.view.run.integrity.recomputeMatches);
  const ready = rows.filter(r => !issues(r).length);
  const visible = rows.filter(r => `${r.facility.name} ${r.facility.code}`.toLowerCase().includes(query.toLowerCase()) && (!onlyIssues || issues(r).length > 0));
  const allComparable = rows.length > 0 && ready.length === rows.length && new Set(rows.map(r => r.facility.reporting_boundary)).size === 1 && new Set(rows.map(r => r.view?.run.methodology_version)).size === 1 && new Set(rows.map(r => r.view?.run.synthetic)).size === 1;
  const open = (r: FactoryResult) => { selectFacility(r.facility.id); router.push("/overview"); };

  return <div className="page-container portfolio-page">
    <PageHeader icon="trending-up" title="Factory portfolio" desc={`${org?.name ?? "Organization"} — operating performance across your authorized factories`} actions={<button className="btn btn-primary" disabled={loading} onClick={() => setRefresh(v => v + 1)}>{loading ? "Loading results…" : "Refresh results"}</button>} />
    <div className="portfolio-period"><div><strong>{start} — {end}</strong><p>Use Reporting range above to change the period. Dates apply in each factory’s local timezone.</p></div><span className="badge badge-info">{org?.synthetic || rows.some(r => r.view?.run.synthetic) ? "Includes synthetic demo data" : "Management comparison"}</span></div>
    {loading ? <p role="status" className="portfolio-loading">Loading factory results and calculating missing periods where permitted…</p> : <>
      <section className="portfolio-summary" aria-label="Portfolio coverage">
        <div><strong>{rows.length}</strong><span>Authorized factories</span></div>
        <div><strong>{current.length}</strong><span>Current saved results</span></div>
        <div><strong>{ready.length}</strong><span>Ready for internal review</span></div>
        <div><strong>{rows.length - ready.length}</strong><span>Need attention</span></div>
      </section>
      <div className="portfolio-toolbar"><label>Find a factory<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Factory name or code" /></label><label className="portfolio-toggle"><input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)} /> Show only factories needing attention</label></div>
      <PortfolioPerformance allowTotals={allComparable} start={start} end={end} factories={visible.map(r => ({
        id: r.facility.id, name: r.facility.name, code: r.facility.code, current: current.includes(r), issues: issues(r).length,
        values: Object.fromEntries(PORTFOLIO_METRICS.map(m => [m.key, current.includes(r) ? portfolioValue(r.view, m.key) : null])),
      }))} openFactory={id => { const row = visible.find(r => r.facility.id === id); if (row) open(row); }} />
      <section className="section-card"><div className="portfolio-chart-header"><h2>Factory results</h2><span>{visible.length} of {rows.length} factories</span></div><div className="table-wrapper"><table className="data-table"><caption className="portfolio-caption">Saved results for {start} — {end}. Missing values are not zero. Search filters affect the chart and table, not the portfolio summary.</caption><thead><tr><th>Factory / boundary</th><th>Period status</th>{PORTFOLIO_METRICS.map(m => <th key={m.key} className="num">{m.label}<br />{m.unit}</th>)}<th>Readings / quality</th><th>Action</th></tr></thead><tbody>{visible.map(r => <tr key={r.facility.id}><td><strong>{r.facility.name}</strong><br />{r.facility.code}<br />{r.facility.reporting_boundary}<br />{r.facility.timezone}{r.view?.run.synthetic && <><br /><span className="badge badge-info">Synthetic demo</span></>}</td><td>{issues(r).length ? <details><summary className="portfolio-attention">Needs attention ({issues(r).length})</summary><ul>{issues(r).map(issue => <li key={issue}>{issue}</li>)}</ul></details> : <span className="badge badge-success">Ready for internal review</span>}{r.view && <small>Calculated {new Date(r.view.run.created_at).toLocaleString()}</small>}</td>{PORTFOLIO_METRICS.map(m => <td key={m.key} className="num">{current.includes(r) ? <Fmt value={portfolioValue(r.view, m.key)} unit={m.unit} /> : "—"}</td>)}<td>{r.view ? <>{r.view.run.readings} readings<br />QA: {r.view.run.qa_overall}<br />Inputs: {r.view.store.completeness.pct}%<br />Evidence references: {r.view.store.evidence.length}<small>References are not external verification.</small></> : "No result"}</td><td><button className="btn btn-secondary" onClick={() => open(r)}>Open factory</button></td></tr>)}</tbody></table></div>{!visible.length && <p className="portfolio-empty">{rows.length ? "No factories match your filters." : "No factories are authorized for this account."}</p>}</section>
      <section className="section-card portfolio-totals"><h2>Factory sums</h2><p>All authorized factories, before inter-factory transfer reconciliation. These are management figures, not consolidated regulatory totals.</p>{allComparable ? <dl>{PORTFOLIO_METRICS.slice(0, 6).map(m => <div key={m.key}><dt>{m.label}</dt><dd><Fmt value={portfolioSum(rows.map(r => r.view!), m.key)} unit={m.unit} /> <small>{m.unit}</small></dd></div>)}</dl> : <p className="portfolio-attention">Sums withheld: every factory must have current results, complete coverage and inputs, internal-review readiness, matching methodology and reporting boundaries, and the same demo/real-data status.</p>}<details><summary>How to interpret this portfolio</summary><p>Factory intensities use each factory’s own calculation. They are never averaged. Group intensity is withheld until inter-factory transfers and product boundaries can be reconciled from persisted records. Reporting approval and external verification are separate from internal-review readiness.</p><p>Saved calculations are reused. Missing or outdated periods are calculated automatically where your permissions allow. Open a factory to resolve data issues or inspect its individual readings. Refresh afterwards.</p></details></section>
    </>}
  </div>;
}
