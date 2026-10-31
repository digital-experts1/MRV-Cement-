"use client";
import { useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/context/StoreContext';
import { useScope } from '@/context/ScopeContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { BarChart } from '@/components/charts/ChartCanvas';
import { MappingWorkbench } from '@/components/dcs/MappingWorkbench';
import { sourceCoverage, sourceMapping } from '@/lib/mrv/sourceOverview';
import { setupDisplay } from '@/lib/setupView';
import type { Store, SheetRow } from '@/lib/types';

const CATEGORIES=[['Production','production'],['Kiln fuel','kilnFuel'],['Electricity','electricity'],['Raw materials','rawMaterial']] as const;
function SourceReview({s}:{s:Store}) {
  const [category,setCategory]=useState(0);const [search,setSearch]=useState('');const [day,setDay]=useState('');const [page,setPage]=useState(0);
  const [mapStatus,setMapStatus]=useState('');
  const start=String(s.setup['Period start']??''),end=String(s.setup['Period end']??'');
  const series=CATEGORIES.map(([label,key])=>({label,key,...sourceCoverage(s.inputs[key],start,end)}));
  const active=series[category];const readings=s.inputs[active.key];
  const filtered=readings.filter(row=>(!day||row['Interval Start']===day)&&JSON.stringify(row).toLowerCase().includes(search.toLowerCase()));
  const files=new Set(CATEGORIES.flatMap(([,key])=>s.inputs[key].map(row=>{const src=row._source as Record<string,unknown>|undefined;return src?.file ? String(src.file):'';})).filter(Boolean));
  const mappings=new Map<string,Record<string,unknown>>();
  for(const [,key] of CATEGORIES)for(const row of s.inputs[key]){const m=sourceMapping(row);if(m)mappings.set(JSON.stringify(m),m);}
  const mappedRows=s.dcsMap.filter(row=>mapStatus===''||String(row['Mapped Status']??'').trim().toLowerCase()===mapStatus);
  function exportRows(){const blob=new Blob([JSON.stringify({period:{start,end},synthetic:s.meta.synthetic,category:active.label,rows:filtered},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`MRV_Source_Readings_${active.key}_${start}_${end}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <>
    <section className="section-card dcs-summary"><div><strong>{files.size}</strong><span>Source filenames in this calculation</span></div><div><strong>{mappings.size}</strong><span>Recorded column mappings</span></div><div><strong>{s.dcsMap.length}</strong><span>Workbook boundary mappings</span></div><div><strong>File-based</strong><span>Live connection not established by this page</span></div></section>
    <section className="section-card dcs-review"><h2>Reading availability</h2><p>{start} to {end}. Counts below describe the displayed calculation’s inputs, not every record in the database. A day with readings does not establish coverage of every meter or required field.</p>
      <div className="dcs-chart" role="img" aria-label={series.map(x=>`${x.label}: ${x.counts.filter(Boolean).length} days with daily readings`).join('; ')}><BarChart labels={series.map(x=>x.label)} data={series.map(x=>x.counts.filter(Boolean).length)} horizontal yUnit="days with daily readings" /></div>
      <div className="dcs-category-tabs">{series.map((x,i)=><button key={x.key} className="btn btn-secondary" aria-pressed={i===category} onClick={()=>{setCategory(i);setDay('');setPage(0);}}>{x.label} · {s.inputs[x.key].length} rows</button>)}</div>
      <p>{active.counts.filter(Boolean).length} of {active.days.length} calendar days have daily rows · {active.intervals} longer-interval rows · {active.invalid} rows without valid interval dates.</p>
      <details><summary>Daily availability — click a date to inspect readings</summary><p>Blue: at least one daily row. Grey: no daily row. Longer intervals are not spread into invented daily values.</p><div className="dcs-calendar">{active.days.map((date,i)=><button key={date} title={`${date}: ${active.counts[i]} daily rows`} aria-label={`${date}: ${active.counts[i]} daily rows`} aria-pressed={day===date} className={active.counts[i]?'has-readings':''} onClick={()=>{setDay(day===date?'':date);setPage(0);}}>{date.slice(5)}</button>)}</div></details>
      <div className="dcs-filter"><label>Search source readings<input type="search" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} placeholder="File, tag, value or evidence ID" /></label><button className="btn btn-secondary" onClick={()=>{setSearch('');setDay('');setPage(0);}}>Clear filters</button><button className="btn btn-secondary" onClick={exportRows} disabled={!filtered.length}>Export filtered source JSON</button></div>
      {day&&<p>Selected date: {day}</p>}
      <div className="dcs-scroll"><table className="data-table"><thead><tr><th>Interval</th><th>Source / identity</th><th>File</th><th>Evidence reference</th><th>All values & provenance</th></tr></thead><tbody>{filtered.slice(page*20,page*20+20).map((row,i)=>{const src=row._source as Record<string,unknown>|undefined;return <tr key={page*20+i}><td>{setupDisplay(row['Interval Start'])} – {setupDisplay(row['Interval End'])}</td><td>{setupDisplay(row['Meter / Source']??row['Fuel Type']??row['Kiln Line']??row['Material'])}</td><td>{setupDisplay(src?.file)}<small>{src?.sheet?` / ${src.sheet} / row ${src.row??'unknown'}`:''}</small></td><td>{setupDisplay(row['Evidence ID'])}</td><td><details><summary>Inspect reading</summary><pre>{JSON.stringify(row,null,2)}</pre></details></td></tr>;})}{!filtered.length&&<tr><td colSpan={5}>No readings match this selection.</td></tr>}</tbody></table></div>
      <div className="dcs-filter"><span>{filtered.length} matching rows</span><button className="btn btn-secondary" disabled={!page} onClick={()=>setPage(page-1)}>Previous</button><button className="btn btn-secondary" disabled={(page+1)*20>=filtered.length} onClick={()=>setPage(page+1)}>Next</button></div>
    </section>
    <section className="section-card dcs-review"><h2>Recorded source mappings</h2><p>Column mappings below were saved with imported readings. Workbook declarations are shown separately; “Mapped” is not a connection or verification status.</p>
      {mappings.size===0?<p>No column mappings are recorded for these readings. Imported MRV-format files can contain valid readings without a plant-tag map.</p>:[...mappings.values()].map((m,i)=><details key={i}><summary>{String(m.source)} · {String(m.section)} · Owner: {String(m.owner)}</summary><pre>{JSON.stringify(m,null,2)}</pre></details>)}
      <h3>Workbook boundary map</h3><label>Declared status<select value={mapStatus} onChange={e=>setMapStatus(e.target.value)}><option value="">All statuses</option>{[...new Set(s.dcsMap.map(r=>String(r['Mapped Status']??'').trim().toLowerCase()))].map(v=><option key={v} value={v}>{v||'Not declared'}</option>)}</select></label>
      {s.dcsMap.length===0?<p>No boundary map was supplied. Use the mapping workbench above for new daily files; do not invent plant tags for historical readings.</p>:<div className="dcs-scroll"><table className="data-table"><thead><tr>{['Boundary Area','Source System','DCS/ERP/Lab Tag','MRV Field','Unit','Frequency','Mapped Status','Owner','Evidence Required','Calculation Use','QA/QC Rule'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{mappedRows.map((row:SheetRow,i)=><tr key={i}>{['Boundary Area','Source System','DCS/ERP/Lab Tag','MRV Field','Unit','Frequency','Mapped Status','Owner','Evidence Required','Calculation Use','QA/QC Rule'].map(h=><td key={h}>{setupDisplay(row[h])}</td>)}</tr>)}</tbody></table></div>}
    </section>
  </>;
}
export default function DcsPage(){const {store}=useStore();const scope=useScope();return <div className="page-container dcs-workspace">
  <PageHeader icon="network" title="Data Sources & Mapping" desc="Connect file columns to daily MRV readings, inspect source evidence and identify reporting gaps." />
  <div className="dcs-intro"><strong>File import workspace</strong><span>SCADA / DCS, ERP and lab exports · No live connection implied</span></div>
  <MappingWorkbench key={`${scope.tenantId}/${scope.facilityId}`} />
  {store?._valid?<SourceReview key={`${scope.activeKey}/${store.meta.revision}`} s={store}/>:<section className="section-card dcs-review"><h2>No calculation selected</h2><p>You can map and preview a file above. Select a factory and reporting period to inspect saved source readings.</p></section>}
  <section className="section-card dcs-review"><h2>CBAM evidence handoff</h2><p>This page supports source-data traceability. It does not establish CBAM compliance, external verification or submission to the CBAM Registry.</p><div className="dcs-cbam-grid">
    <div><h3>Activity data</h3><p>Production, fuel quantities and electricity need documented units, reporting intervals and source evidence. Check missing days per source, not only factory totals.</p><Link href="/setup">Review facility & process boundaries</Link></div>
    <div><h3>Calculation basis</h3><p>Daily activity totals alone are insufficient. Review calcination data, fuel NCV and emission factors, electricity factors, relevant precursors and process allocation.</p><Link href="/constants">Review factors & NCV</Link></div>
    <div><h3>Monitoring & verification</h3><p>Retain the monitoring plan, measurement methodology, calibration and laboratory records, and the applicable verification report. An evidence ID is only a reference.</p><Link href="/evidence">Open evidence register</Link></div>
  </div><div className="dcs-filter"><Link href="/qaqc">Review QA/QC findings</Link><a href="https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism/cbam-verification_en" target="_blank" rel="noreferrer">European Commission: CBAM verification</a><a href="https://eur-lex.europa.eu/eli/reg_impl/2025/2547/oj/eng" target="_blank" rel="noreferrer">EU calculation & monitoring methodology</a></div></section>
</div>;}
