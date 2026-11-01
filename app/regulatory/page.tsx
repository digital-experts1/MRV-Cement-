"use client";
import Link from 'next/link';
import { useState } from 'react';
import { useScope } from '@/context/ScopeContext';
import { useStore } from '@/context/StoreContext';
import { Chip } from '@/components/ui/Chip';
import { PageHeader } from '@/components/ui/PageHeader';
import { factorSourceUrl } from '@/lib/mrv/factorReview';
import { referenceIssues, referenceMatches } from '@/lib/mrv/regulatoryReview';

export default function RegulatoryPage() {
  const scope = useScope();
  const {store, loading} = useStore();
  const [query,setQuery] = useState('');
  const [status,setStatus] = useState('');
  const [gaps,setGaps] = useState(false);
  const refs = store?._valid ? store.regulatory : [];
  const statuses = [...new Set(refs.map(r=>String(r.Status ?? '')).filter(Boolean))];
  const visible = refs.filter(r=>referenceMatches(r,query) && (!status || String(r.Status) === status) && (!gaps || referenceIssues(r).length));
  return <>
    <PageHeader icon="book-open" title="Regulatory reference register" desc="Trace the sources and methodology references attached to your factory’s calculation." actions={scope.canImport && store?._valid ? <Link className="btn btn-primary" href="/dataentry#regulatory">Manage references</Link> : undefined} />
    <div className="factor-context" role="note"><strong>{store?.meta.synthetic ? 'Synthetic demo · ' : ''}Reference documentation, not a compliance determination</strong><p>Source links and review dates are supplied by your team. A status label does not verify a publisher, confirm legal applicability or approve a report.</p>{scope.run && <p>Calculation period: {scope.run.range_start} to {scope.run.range_end}{scope.run.stale ? ' · Calculation needs updating' : ''}</p>}</div>
    {loading || scope.status === 'loading' ? <p role="status">Loading reference register…</p> : !store?._valid ? <section className="section-card"><div className="section-card-body"><h3>No calculation selected</h3><p>Select a factory and reporting period to load its saved reference register. References are preserved with calculation snapshots.</p>{scope.summary?.latestCalculation && <button className="btn btn-primary" onClick={scope.openLatestSaved}>Open latest saved results</button>}<Link className="btn btn-secondary" href="/setup">Review reporting setup</Link></div></section> : <>
      <div className="factor-review-strip"><span><strong>{refs.length}</strong> references</span><span><strong>{refs.filter(r=>factorSourceUrl(r['Official source URL'])).length}</strong> source links</span><span><strong>{refs.filter(r=>referenceIssues(r).length).length}</strong> with documentation gaps</span></div>
      <div className="factor-toolbar"><label>Search references<input className="form-input" placeholder="Title, methodology, section or notes" value={query} onChange={e=>setQuery(e.target.value)} /></label><label>Recorded status<select className="form-input" value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{statuses.map(s=><option key={s}>{s}</option>)}</select></label><label><span><input type="checkbox" checked={gaps} onChange={e=>setGaps(e.target.checked)} /> Documentation gaps only</span></label><button className="btn btn-secondary" onClick={()=>{setQuery('');setStatus('');setGaps(false);}}>Clear filters</button></div>
      <p role="status">Showing {visible.length} of {refs.length} references</p>
      {!visible.length && <section className="section-card"><div className="section-card-body"><h3>{refs.length ? 'No matching references' : 'Build this factory’s reference register'}</h3><p>{refs.length ? 'Change the search or clear the filters.' : 'Add source links, version or section details, and explain how each reference supports your methodology. Daily readings do not supply these automatically.'}</p>{!refs.length && scope.canImport && <Link className="btn btn-primary" href="/dataentry#regulatory">Add references</Link>}</div></section>}
      <div className="reg-register">{visible.map((r,i)=>{const issues=referenceIssues(r);const url=factorSourceUrl(r['Official source URL']);return <article className="section-card" key={i}><div className="section-card-body"><div className="reg-meta"><Chip status={r.Status} /><span>Recorded review: {String(r['Last checked'] || 'Not supplied')}</span></div><h3>{String(r.Reference || 'Untitled reference')}</h3><p>{String(r['Workbook application'] || 'Application not documented')}</p><dl><dt>Version / section</dt><dd>{String(r['Page / section pointer'] || 'Not recorded')}</dd><dt>Applies to</dt><dd>{String(r['Applied sheets'] || 'Not recorded')}</dd></dl>{url ? <a className="btn btn-secondary" href={url} target="_blank" rel="noopener noreferrer">Open source document</a> : <span className="badge badge-warn">No usable source link</span>}<details><summary>Notes & documentation checks{issues.length ? ` (${issues.length})` : ''}</summary><p>{String(r.Notes || 'No notes recorded')}</p>{issues.length ? <ul>{issues.map(issue=><li key={issue}>{issue}</li>)}</ul> : <p>Core documentation fields are filled. Applicability still requires review.</p>}</details></div></article>})}</div>
      <div className="factor-context"><strong>Maintain a reproducible reporting basis</strong><p>Record the document version and relevant provision before saving. Changes are saved through Data Entry Studio with the selected factory’s inputs and recalculated results; earlier calculation snapshots retain their reference list.</p><Link href="/evidence">Open supporting evidence</Link></div>
    </>}
  </>;
}
