"use client";

import Link from 'next/link';
import { useState } from 'react';
import { useScope } from '@/context/ScopeContext';
import { Chip } from '@/components/ui/Chip';
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader';
import { RequireWorkbook } from '@/components/ui/RequireWorkbook';
import { BarChart } from '@/components/charts/ChartCanvas';
import { parseStrictNumber, strictNumberOrNull } from '@/lib/numeric';
import { factorIssues, factorSourceUrl, groupFactorRows } from '@/lib/mrv/factorReview';
import type { SheetRow, Store } from '@/lib/types';

function Value({ value }: { value: unknown }) {
  const p = parseStrictNumber(value);
  return p.kind === 'ok' ? <span className="mono">{p.value.toString()}</span> : <span className="badge badge-warn" title={p.kind === 'invalid' ? p.reason : undefined}>{p.kind === 'blank' ? 'Missing' : 'Invalid'}</span>;
}
const fuelFields = ['Fuel Type', 'Unit', 'NCV GJ/unit', 'EF tCO2/TJ', 'Oxidation Factor', 'Biomass Fraction'];
const electricityFields = ['Meter / Source', 'Grid EF tCO2/MWh', 'Self-generation EF'];
function FactorTable({ rows, fields }: { rows: SheetRow[]; fields: string[] }) {
  const groups = groupFactorRows(rows, fields);
  return <div className="table-wrapper"><table className="data-table"><thead><tr>{fields.map(f => <th key={f}>{f}</th>)}<th>Readings</th></tr></thead><tbody>{groups.map(({row, count}, i) => <tr key={i}>{fields.map(f => <td key={f}>{['Fuel Type', 'Unit', 'Meter / Source'].includes(f) ? String(row[f] ?? '—') : <Value value={row[f]} />}</td>)}<td>{count}</td></tr>)}</tbody></table>{!groups.length && <p className="section-card-body">No readings in this section for the displayed calculation.</p>}</div>;
}
function ConstantsContent({ s }: { s: Store }) {
  const scope = useScope();
  const [query, setQuery] = useState('');
  const [attention, setAttention] = useState(false);
  const [tab, setTab] = useState('constants');
  const [metric, setMetric] = useState('EF tCO2/TJ');
  const [unit, setUnit] = useState('');
  const matches = (r: SheetRow) => Object.entries(r).filter(([key]) => key !== '_source').some(([,v]) => String(v ?? '').toLowerCase().includes(query.toLowerCase()));
  const constants = s.constants.filter(r => matches(r) && (!attention || factorIssues(r).length));
  const fuels = s.inputs.kilnFuel.filter(matches);
  const electricity = s.inputs.electricity.filter(matches);
  const units = [...new Set(fuels.map(r => String(r.Unit ?? '')))].filter(Boolean);
  const selectedUnit = units.includes(unit) ? unit : units[0];
  const chartRows = groupFactorRows(fuels.filter(r => metric !== 'NCV GJ/unit' || r.Unit === selectedUnit), fuelFields).filter(({row}) => { const n = strictNumberOrNull(row[metric]); return n !== null && n >= 0; });
  const issueCount = s.constants.filter(r => factorIssues(r).length).length;
  const editorTab = tab === 'fuel' ? 'kilnfuel' : tab === 'electricity' ? 'electricity' : 'constants';
  return <>
    <PageHeader icon="sliders" title="Factors & calculation settings" desc="Inspect the values behind your results and maintain their sources." actions={scope.canImport && tab !== 'defaults' ? <Link className="btn btn-primary" href={`/dataentry#${editorTab}`}>Edit {tab === 'fuel' ? 'fuel readings' : tab === 'electricity' ? 'electricity readings' : 'constants'}</Link> : <span className="badge badge-info">{tab === 'defaults' ? 'Reference values' : 'Read-only access'}</span>} />
    <div className="factor-context" role="note"><div><strong>{s.meta.synthetic ? 'Synthetic demo · ' : ''}Selected calculation</strong><p>{scope.run ? `${scope.run.range_start} to ${scope.run.range_end}` : 'Loaded dataset'}{scope.run?.stale ? ' · Results need recalculation' : ''}</p></div><p>Fuel and electricity calculations use factors on each reading. Reference defaults do not override those values.</p></div>
    <div className="factor-review-strip"><span><strong>{s.constants.length}</strong> constants</span><span><strong>{s.inputs.kilnFuel.length}</strong> fuel readings</span><span><strong>{s.inputs.electricity.length}</strong> electricity readings</span><span><strong>{issueCount}</strong> constants with value or source gaps</span></div>
    <div className="factor-toolbar"><nav aria-label="Factor sections">{[['constants','Constants & bounds'],['fuel','Fuel factors in use'],['electricity','Electricity factors'],['defaults','Reference defaults']].map(([key,label]) => <button type="button" key={key} className={`btn ${tab === key ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</nav><label>Search factors<input className="form-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, unit, source or fuel…" /></label></div>
    {tab === 'constants' && <section className="section-card"><SectionHeader icon="sliders" title="General constants & QA bounds" /><div className="section-card-body"><label><input type="checkbox" checked={attention} onChange={e => setAttention(e.target.checked)} /> Show value or source gaps only</label><p>Some constants are reference-only, as described in their source rationale. Fixed chemistry uses the engine’s versioned factor set. These checks identify documentation gaps, not regulatory approval. Review the supplied status and source before using a factor.</p></div><div className="table-wrapper"><table className="data-table"><thead><tr><th>Constant / factor</th><th>Value</th><th>Unit</th><th>Used in</th><th>Source & review</th></tr></thead><tbody>{constants.map((r,i) => <tr key={i}><td><strong>{String(r['Constant / Factor'] ?? 'Unnamed')}</strong></td><td><Value value={r.Value} /></td><td>{String(r.Unit ?? '—')}</td><td>{String(r['Used in'] ?? '—')}</td><td><Chip status={r.Status} /><details><summary>Source and change control{factorIssues(r).length ? ` · ${factorIssues(r).length} gaps` : ''}</summary><p>{String(r['Source / rationale'] ?? 'No source supplied')}</p><p>Change control: {String(r['Change control'] ?? 'Not supplied')}</p>{factorSourceUrl(r['Source URL']) && <a href={factorSourceUrl(r['Source URL'])!} target="_blank" rel="noopener noreferrer">Open source</a>}{factorIssues(r).length > 0 && <ul>{factorIssues(r).map(issue => <li key={issue}>{issue}</li>)}</ul>}</details></td></tr>)}</tbody></table>{!constants.length && <p className="section-card-body">No constants match these filters.</p>}</div></section>}
    {tab === 'fuel' && <><section className="section-card mb-lg"><SectionHeader icon="flame" title="Compare entered fuel factors" /><div className="section-card-body"><div className="factor-toolbar"><label>Compare<select className="form-input" value={metric} onChange={e => setMetric(e.target.value)}><option value="EF tCO2/TJ">Emission factor (tCO₂/TJ)</option><option value="NCV GJ/unit">Net calorific value (GJ per fuel unit)</option></select></label>{metric === 'NCV GJ/unit' && <label>Fuel quantity unit<select className="form-input" value={selectedUnit ?? ''} onChange={e => setUnit(e.target.value)}>{units.map(u => <option key={u}>{u}</option>)}</select></label>}</div><p>Each bar is an entered factor combination. Missing and invalid values are excluded; factors with different NCV units are kept separate.</p>{chartRows.length ? <div style={{height: Math.max(240, chartRows.length * 38)}} role="img" aria-label="Fuel factor comparison. Exact values are in the table below."><BarChart horizontal labels={chartRows.map(({row},i) => `${String(row['Fuel Type'])} · ${i+1}`)} datasets={[{label: metric === 'NCV GJ/unit' ? `NCV GJ/${selectedUnit}` : 'EF tCO₂/TJ', data: chartRows.map(({row}) => strictNumberOrNull(row[metric])!), color:'#1677ff'}]} /></div> : <p>No valid factors available for this comparison.</p>}</div></section><section className="section-card"><SectionHeader icon="flame" title="Fuel factors on readings" /><FactorTable rows={fuels} fields={fuelFields} /></section></>}
    {tab === 'electricity' && <section className="section-card"><SectionHeader icon="sliders" title="Electricity factors on readings" /><div className="section-card-body">Grid and self-generation emission factors are in tCO₂/MWh. Identical combinations are grouped with their reading counts.</div><FactorTable rows={electricity} fields={electricityFields} /></section>}
    {tab === 'defaults' && <section className="section-card"><SectionHeader icon="flame" title="Imported reference defaults" /><div className="section-card-body">Reference values supplied with this dataset. Check the factors in use before changing readings; editing a reference does not update historical readings.</div><div className="table-wrapper"><table className="data-table"><thead><tr>{['Fuel Type','Default NCV','NCV Unit','Default EF','EF Unit','Default Ox.','Default Biomass %','Notes'].map(f => <th key={f}>{f}</th>)}</tr></thead><tbody>{s.fuelDefaults.filter(matches).map((r,i) => <tr key={i}>{['Fuel Type','Default NCV','NCV Unit','Default EF','EF Unit','Default Ox.','Default Biomass %','Notes'].map(f => <td key={f}>{['Default NCV','Default EF','Default Ox.','Default Biomass %'].includes(f) ? <Value value={r[f]} /> : String(r[f] ?? '—')}</td>)}</tr>)}</tbody></table>{!s.fuelDefaults.filter(matches).length && <p className="section-card-body">No reference defaults match these filters.</p>}</div></section>}
    <details className="factor-context"><summary>How to change factors safely</summary><p>Open the editor, update values and source documentation, then review and save. Saving uses the existing factory-scoped import and server calculation flow. Previous calculation snapshots remain available; a saved change is not an approval.</p><Link href="/calculations">Review calculation results</Link></details>
  </>;
}
export default function ConstantsPage() { return <RequireWorkbook title="Constants & Factors">{s => <ConstantsContent key={s.meta.revision ?? 'loaded'} s={s} />}</RequireWorkbook>; }
