"use client";
import { useRef, useState } from 'react';
import { useScope } from '@/context/ScopeContext';
import { DAILY_HEADERS, downloadDailyTemplate, type DailyImport } from '@/lib/mrv/dailyTotals';
import { readSource, parseMappedDaily, type ColumnMapping, type DailySection } from '@/lib/mrv/columnMapping';

export function MappingWorkbench() {
  const scope=useScope(); const sequence=useRef(0);
  const [file,setFile]=useState<File|null>(null); const [buffer,setBuffer]=useState<ArrayBuffer|null>(null);
  const [sheets,setSheets]=useState<ReturnType<typeof readSource>>([]); const [sheet,setSheet]=useState('');
  const [section,setSection]=useState<DailySection>('Production'); const [measurement,setMeasurement]=useState('');
  const [source,setSource]=useState(''); const [owner,setOwner]=useState(''); const [columns,setColumns]=useState<Record<string,string>>({});
  const [preview,setPreview]=useState<DailyImport|null>(null); const [message,setMessage]=useState(''); const [busy,setBusy]=useState(false);
  const selected=sheets.find(s=>s.name===sheet); const targets=[...DAILY_HEADERS[section],'Measurement Type','Notes',...(section==='Electricity'?['Grid kWh','Grid MWh']:[])];
  const invalidate=()=>{setPreview(null);setMessage('');};
  async function choose(f:File) {
    const ticket=++sequence.current; invalidate();setFile(null);setBuffer(null);setSheets([]);setBusy(true);
    try {if(!/\.(xlsx|csv)$/i.test(f.name))throw new Error('Choose an Excel .xlsx or CSV file.');if(f.size>10*1024*1024)throw new Error('Choose a file smaller than 10 MB.');
      const bytes=await f.arrayBuffer();const all=readSource(bytes);if(ticket!==sequence.current)return;
      setFile(f);setBuffer(bytes);setSheets(all);setSheet(all[0]?.name??'');setColumns({});
    }catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  function spec():ColumnMapping {return {version:'trace-columns/v1',sheet,section,measurement:measurement as 'daily_total',source,owner,columns};}
  function validate() {invalidate();try {if(!file||!buffer)throw new Error('Choose a file first.');const r=parseMappedDaily(buffer,file.name,spec());setPreview(r);if(!r.store._valid)setMessage(r.store._errors.join('\n'));}catch(e){setMessage(e instanceof Error?e.message:String(e));}}
  async function save() {if(!file||!preview?.store._valid||!scope.canImport)return;setBusy(true);setMessage('');try{const r=await scope.importFile(file,JSON.stringify(spec()),'daily-totals');if(!r.accepted)setMessage(r.errors.join('\n'));else {setPreview(null);setMessage('Import accepted. Readings and original file were saved. Review calculation status above.');}}catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  const previewRows=preview?.store.inputs[({Production:'production',Fuel:'kilnFuel',Electricity:'electricity'} as const)[section]]??[];
  return <section className="section-card dcs-workbench"><div className="section-header"><h2>Map a daily readings file</h2><button className="btn btn-secondary" onClick={downloadDailyTemplate}>Download input template</button></div>
    <p>Preview one worksheet at a time. Original files, source rows and your mapping are retained when you import. Existing setup and emission factors are preserved.</p>
    <fieldset disabled={busy}><div className="dcs-form-grid">
      <label>Excel or CSV<input type="file" accept=".xlsx,.csv" onChange={e=>{const f=e.target.files?.[0];if(f)void choose(f);e.target.value='';}} /></label>
      <label>Source system<input value={source} onChange={e=>{setSource(e.target.value);invalidate();}} placeholder="e.g. Kiln daily production export" /></label>
      <label>Responsible owner<input value={owner} onChange={e=>{setOwner(e.target.value);invalidate();}} placeholder="Name or department" /></label>
      <label>MRV category<select value={section} onChange={e=>{setSection(e.target.value as DailySection);setColumns({});invalidate();}}>{Object.keys(DAILY_HEADERS).map(v=><option key={v}>{v}</option>)}</select></label>
      <label>Measurement type<select value={measurement} onChange={e=>{setMeasurement(e.target.value);invalidate();}}><option value="">Select explicitly</option><option value="daily_total">Daily totals</option><option value="counter">Cumulative meter counter — unsupported</option><option value="rate">Instantaneous rate — unsupported</option></select></label>
      {sheets.length>0&&<label>Worksheet<select value={sheet} onChange={e=>{setSheet(e.target.value);setColumns({});invalidate();}}>{sheets.map(s=><option key={s.name}>{s.name}</option>)}</select></label>}
    </div>
    {selected&&<><p><strong>{file?.name}</strong> · {selected.rows.filter(r=>r.some(v=>v!==null&&v!=='')).length} source rows. Only “{sheet}” will be imported; other worksheets are excluded.</p>
      <div className="dcs-scroll"><table className="data-table"><thead><tr><th>Source column / tag</th><th>First non-empty value</th><th>MRV field</th></tr></thead><tbody>{selected.headers.map((h,i)=><tr key={h}><th scope="row">{h}</th><td>{String(selected.rows.find(r=>r[i]!=null&&r[i]!=='')?.[i]??'Missing')}</td><td><select aria-label={`Map ${h}`} value={columns[h]??'__unmapped'} onChange={e=>{setColumns({...columns,[h]:e.target.value});invalidate();}}><option value="__unmapped">Select a field</option><option value="">Ignore this column explicitly</option>{targets.map(t=><option key={t}>{t}</option>)}</select></td></tr>)}</tbody></table></div>
      <p>Production quantities must be tonnes. Map Fuel Unit and matching NCV units; electricity accepts kWh or MWh and is stored as MWh. Missing factors are never invented.</p><button className="btn btn-secondary" type="button" onClick={validate}>Validate & preview</button></>}
    </fieldset>
    {message&&<div className="dcs-message" role="status">{message}</div>}
    {preview?.store._valid&&<div className="dcs-preview"><h3>Preview: {preview.start} to {preview.end}</h3><p>{previewRows.length} valid source rows · {preview.configKinds.length ? 'Includes configuration' : 'Activity readings only'} · Target: {scope.facility?.name??'Select a factory'}</p>
      <p>Structural validation passed. Final calculations use the factory’s saved settings and factors. This is not a CBAM verification result.</p>
      <details><summary>Inspect first 10 normalized readings and source mappings</summary><pre>{JSON.stringify(previewRows.slice(0,10),null,2)}</pre></details>
      <button className="btn btn-primary" disabled={busy||!scope.canImport} onClick={()=>void save()}>{busy?'Saving…':'Import validated readings'}</button>
      {!scope.canImport&&<p>Sign in with upload permission for the selected factory to save.</p>}
    </div>}
  </section>;
}
