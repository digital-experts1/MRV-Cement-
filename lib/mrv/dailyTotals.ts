import * as XLSX from 'xlsx';
import { calculateStore } from '@/lib/calcEngine';
import { toIsoDate } from '@/lib/dates';
import { parseStrictNumber } from '@/lib/numeric';
import { createEmptyInput, createEmptyStore, type SheetRow, type Store } from '@/lib/types';

export const DAILY_FORMAT_VERSION = 'trace-daily-totals/v1';
export const DAILY_HEADERS = {
  Production: ['Date', 'Kiln Line', 'Cement Type', 'Clinker Produced t', 'Cement Produced t', 'Clinker Used t', 'Gypsum t', 'Limestone Additive t', 'Other Additives t', 'Evidence ID', 'Quality'],
  Fuel: ['Date', 'Fuel Type', 'Quantity', 'Unit', 'NCV GJ/unit', 'EF tCO2/TJ', 'Oxidation Factor', 'Biomass Fraction', 'Evidence ID', 'Quality'],
  Electricity: ['Date', 'Meter / Source', 'Electricity', 'Unit', 'Grid EF tCO2/MWh', 'Self-generation MWh', 'Self-generation EF', 'Renewable MWh', 'Evidence ID', 'Quality'],
} as const;
type Section = keyof typeof DAILY_HEADERS;
const sections = { Production: 'production', Fuel: 'kilnFuel', Electricity: 'electricity' } as const;
const key = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[_\s]+/g, ' ');
const aliases: Record<string, string> = {
  day: 'Date', 'production date': 'Date', 'reading date': 'Date',
  kiln: 'Kiln Line', line: 'Kiln Line', product: 'Cement Type',
  'clinker tonnes': 'Clinker Produced t', 'clinker production t': 'Clinker Produced t',
  'cement tonnes': 'Cement Produced t', 'cement production t': 'Cement Produced t',
  fuel: 'Fuel Type', 'fuel consumption': 'Quantity', consumption: 'Quantity',
  meter: 'Meter / Source', source: 'Meter / Source', 'electricity consumption': 'Electricity',
  'grid kwh': 'Grid kWh', 'grid mwh': 'Grid MWh', status: 'Quality',
};
const names = new Map<string, string>();
for (const h of [...Object.values(DAILY_HEADERS).flat(), 'Section', 'Measurement Type', 'Grid kWh', 'Grid MWh', 'Notes', 'Interval Start', 'Interval End']) names.set(key(h), h);
for (const [a,b] of Object.entries(aliases)) names.set(a,b);

export interface DailyImport { store: Store; configKinds: string[]; counts: Record<string, number>; start: string | null; end: string | null }

/** Explicit daily-total mode only. Never guesses totals from rates, counters or timestamps. */
export function parseDailyTotals(buffer: ArrayBuffer, filename: string): DailyImport {
  const input = createEmptyInput('workbook');
  input.meta.filename = filename;
  input.meta.importedAt = new Date().toISOString();
  const errors: string[] = [];
  const configKinds: string[] = [];
  const dates: string[] = [];
  const identities = new Set<string>();
  let wb: XLSX.WorkBook;
  const result = (): DailyImport => {
    const store = errors.length ? createEmptyStore() : calculateStore(input, 'workbook');
    if (errors.length) { store._errors = errors.slice(0,50); store.meta.filename = filename; }
    return {store,configKinds,counts:Object.fromEntries(Object.entries(sections).map(([s,k])=>[s,input[k].length])),start:dates.length ? dates.reduce((a,b)=>a<b?a:b) : null,end:dates.length ? dates.reduce((a,b)=>a>b?a:b) : null};
  };
  try { wb = XLSX.read(buffer,{type:'array',raw:true,cellDates:false}); }
  catch { errors.push('Could not read daily totals. Choose a CSV or Excel workbook.'); return result(); }
  if (wb.SheetNames.includes('_EXPORT_INFO')) { errors.push('This is a presentation report. Upload source daily readings, not a report export.');return result(); }
  const csv = /\.csv$/i.test(filename);
  for(const sheet of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet],{header:1,defval:null,blankrows:true});
    if (!rows.some(r=>r.some(v=>v!==null&&v!==''))) continue;
    if (!csv && key(sheet)==='readme') continue;
    // Optional, explicit configuration sheets. Activity-only files never overwrite existing factory configuration.
    if (!csv && ['setup','constants'].includes(key(sheet))) {
      const records = XLSX.utils.sheet_to_json<SheetRow>(wb.Sheets[sheet],{defval:null});
      if(key(sheet)==='setup') {
        if(!rows[0]?.includes('Parameter')||!rows[0]?.includes('Value')) errors.push('Setup requires Parameter and Value headers on row 1.');
        const seen = new Set<string>();
        for(const r of records) { const p=String(r.Parameter??'').trim();if(!p)continue;if(seen.has(p))errors.push(`Duplicate Setup parameter: ${p}`);seen.add(p);input.setup[p]=r.Value; }
        if(Object.keys(input.setup).length)configKinds.push('setup');
        if(input.setup['Dataset type']==='SYNTHETIC DEMO')input.meta.synthetic=true;
      } else {
        if(!rows[0]?.includes('Constant / Factor')||!rows[0]?.includes('Value'))errors.push('Constants requires Constant / Factor and Value headers on row 1.');
        input.constants=records;
        if(records.length)configKinds.push('constants');
      }
      continue;
    }
    const fixed = (Object.keys(sections) as Section[]).find(s=>key(s)===key(sheet));
    if(!csv&&!fixed) { errors.push(`Unrecognised sheet "${sheet}". Use Production, Fuel, Electricity, optional Setup/Constants, and Readme.`);continue; }
    const rawHeaders=rows[0]??[];
    const headers=rawHeaders.map(h=>names.get(key(h))??String(h??'').trim());
    if(!headers.includes('Date'))errors.push(`${sheet}: row 1 must contain a Date column (YYYY-MM-DD or an Excel date).`);
    if(csv&&!headers.includes('Section'))errors.push('CSV requires Section (Production, Fuel or Electricity).');
    if(new Set(headers.filter(Boolean)).size!==headers.filter(Boolean).length)errors.push(`${sheet}: duplicate or ambiguous column names.`);
    rows.slice(1).forEach((cells,i)=>{
      if(!cells.some(v=>v!==null&&v!==''))return;
      const where=`${sheet} row ${i+2}`;
      const raw=Object.fromEntries(rawHeaders.map((h,j)=>[String(h),cells[j]??null]));
      const r=Object.fromEntries(headers.map((h,j)=>[h,cells[j]??null]));
      const section=fixed??(Object.keys(sections) as Section[]).find(s=>key(s)===key(r.Section));
      if(!section){errors.push(`${where}: Section must be Production, Fuel or Electricity.`);return;}
      const allowed=new Set<string>([...DAILY_HEADERS[section],'Section','Measurement Type','Notes','Interval Start','Interval End',...(section==='Electricity'?['Grid kWh','Grid MWh']:[])]);
      for(const [h,v] of Object.entries(r))if(v!==null&&v!==''&&!allowed.has(h))errors.push(`${where}: unmapped column "${h}". Rename it to a documented daily-total field; it was not imported.`);
      // Date is the factory-local reporting day, not the export timestamp.
      const rawDate=r.Date;
      const date=toIsoDate(rawDate);
      if(!date || (typeof rawDate==='string'&&!/^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())) || (typeof rawDate==='number'&&!Number.isInteger(rawDate))) {errors.push(`${where}: Date must be a daily reporting date, without a time. Use YYYY-MM-DD.`);return;}
      for(const h of ['Interval Start','Interval End'])if(r[h]!=null&&r[h]!==''&&toIsoDate(r[h])!==date)errors.push(`${where}: ${h} does not match Date. This mode accepts one-day totals only.`);
      if(r['Measurement Type']&&!['daily total','daily totals','interval total'].includes(key(r['Measurement Type'])))errors.push(`${where}: rates and cumulative meters are not daily totals.`);
      if(r.Quality&&!['good','valid','accepted','192'].includes(key(r.Quality)))errors.push(`${where}: quality "${r.Quality}" needs review. No rows from this file will be saved.`);
      const out:SheetRow={Date:date,'Interval Start':date,'Interval End':date,'Measurement Type':'interval_total','Daily Import Format':DAILY_FORMAT_VERSION};
      const texts=new Set(['Date','Section','Quality','Unit','Kiln Line','Cement Type','Fuel Type','Meter / Source','Evidence ID','Notes','Measurement Type','Interval Start','Interval End']);
      for(const h of allowed) {
        if(['Date','Section','Measurement Type','Interval Start','Interval End'].includes(h)||r[h]==null||r[h]==='')continue;
        if(texts.has(h)){out[h]=String(r[h]).trim();continue;}
        const n=parseStrictNumber(r[h]);
        if(n.kind!=='ok'||n.value.isNegative()){errors.push(`${where}: ${h} must be an unambiguous non-negative number.`);continue;}
        if(['Biomass Fraction','Oxidation Factor'].includes(h)&&n.value.gt(1))errors.push(`${where}: ${h} must be a fraction from 0 to 1.`);
        out[h]=n.value.toNumber();
      }
      const required=section==='Production'?['Kiln Line','Cement Type']:section==='Fuel'?['Fuel Type','Quantity','Unit']:['Meter / Source'];
      for(const h of required)if(out[h]==null||out[h]==='')errors.push(`${where}: missing ${h}.`);
      if(section==='Production'&&out['Clinker Produced t']==null&&out['Cement Produced t']==null)errors.push(`${where}: supply clinker and/or cement production in tonnes.`);
      if(section==='Fuel'&&!['t','kg','nm3','m3','l','gj'].includes(key(out.Unit)))errors.push(`${where}: fuel Unit must be t, kg, Nm3, m3, L or GJ; NCV must use that same unit.`);
      if(section==='Electricity') {
        const supplied=['Electricity','Grid kWh','Grid MWh'].filter(h=>out[h]!=null);
        if(supplied.length!==1)errors.push(`${where}: supply exactly one of Electricity + Unit, Grid kWh or Grid MWh.`);
        else {
          const h=supplied[0];const unit=h==='Electricity'?key(out.Unit):h==='Grid kWh'?'kwh':'mwh';
          if(!['kwh','mwh'].includes(unit))errors.push(`${where}: electricity Unit must be kWh or MWh.`);
          else { const n=parseStrictNumber(out[h]);if(n.kind==='ok')out['Grid MWh']=n.value.div(unit==='kwh'?1000:1).toNumber(); }
          if(h!=='Electricity'&&out.Unit&&key(out.Unit)!==unit)errors.push(`${where}: Unit contradicts ${h}.`);
        }
        delete out.Electricity; delete out['Grid kWh']; delete out.Unit;
      }
      const id=JSON.stringify([section,date,...(section==='Production'?['Kiln Line','Cement Type']:section==='Fuel'?['Fuel Type','Unit']:['Meter / Source']).map(h=>key(out[h]))]);
      if(identities.has(id))errors.push(`${where}: duplicate daily total for the same source. Combine or correct the source records before importing.`);
      identities.add(id);
      out._source={origin:'workbook',file:filename,sheet,row:i+2,raw};
      input[sections[section]].push(out);dates.push(date);
    });
  }
  if(!dates.length)errors.push('No daily readings found. Headers must be on row 1.');
  return result();
}

export function downloadDailyTemplate() {
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ['Daily totals import — instructions'],
    ['Put headers on row 1. Dates are factory-local YYYY-MM-DD. One daily total per source; no hourly rates or cumulative counters.'],
    ['Production uses tonnes. Fuel Quantity uses Unit and NCV GJ/unit must match. Electricity accepts kWh or MWh and is stored as MWh.'],
    ['Quality: Good, Valid, Accepted or 192; blank means not supplied. Bad/uncertain quality rejects the file.'],
    ['Leave missing values blank; use 0 only for a measured zero. Missing emission factors will be flagged, not invented.'],
    ['Existing factory configuration is preserved. Optional Setup (Parameter, Value) and Constants sheets explicitly version configuration.'],
    ['CSV: add a Section column containing Production, Fuel or Electricity. Recognised aliases are mapped; unknown populated columns are rejected.'],
  ]),'Readme');
  for(const [sheet,headers] of Object.entries(DAILY_HEADERS)){ const ws=XLSX.utils.aoa_to_sheet([[...headers]]);ws['!cols']=headers.map(()=>({wch:24}));XLSX.utils.book_append_sheet(wb,ws,sheet); }
  XLSX.writeFile(wb,'MRV_Daily_Totals_Input.xlsx');
}
