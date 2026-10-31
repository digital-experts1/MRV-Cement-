import * as XLSX from 'xlsx';
import { DAILY_HEADERS, parseDailyTotals, type DailyImport } from './dailyTotals';
import { calculateStore } from '@/lib/calcEngine';
export type DailySection = keyof typeof DAILY_HEADERS;
export interface ColumnMapping { version: 'trace-columns/v1'; sheet: string; section: DailySection; measurement: 'daily_total'; source: string; owner: string; columns: Record<string,string>; }
export function readSource(buffer: ArrayBuffer) {
  const wb = XLSX.read(buffer,{type:'array',raw:true});
  return wb.SheetNames.map(name => {
    const data = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name],{header:1,defval:null,blankrows:true});
    const headers = (data[0] ?? []).map(v=>String(v??'').trim());
    if (!headers.length || headers.some(h=>!h) || new Set(headers).size!==headers.length) throw new Error(`${name}: row 1 must have unique, non-empty column headers.`);
    return {name,headers,rows:data.slice(1)};
  });
}
export function mappingFrom(value: unknown): ColumnMapping {
  const m = typeof value === 'string' ? JSON.parse(value) : value;
  if(!m || m.version!=='trace-columns/v1' || !Object.hasOwn(DAILY_HEADERS,m.section) || m.measurement!=='daily_total' || typeof m.sheet!=='string' || typeof m.source!=='string' || !m.source.trim() || typeof m.owner!=='string' || !m.owner.trim() || !m.columns || typeof m.columns!=='object' || Array.isArray(m.columns)) throw new Error('Choose a source, owner, section and daily-total measurement type.');
  if(Object.keys(m).some(k=>!['version','sheet','section','measurement','source','owner','columns'].includes(k)))throw new Error('Unknown column mapping option.');
  const allowed = new Set<string>([...DAILY_HEADERS[m.section as DailySection], 'Measurement Type','Notes','Interval Start','Interval End',...(m.section==='Electricity'?['Grid kWh','Grid MWh']:[])]);
  const targets = Object.values(m.columns);
  if(targets.some(v=>typeof v!=='string'||(v!==''&&!allowed.has(v as string))))throw new Error('Unknown MRV target field.');
  const used=targets.filter(Boolean); if(new Set(used).size!==used.length)throw new Error('Two source columns cannot map to the same MRV field.');
  if(!used.includes('Date'))throw new Error('Map a reporting Date column.');
  return m as ColumnMapping;
}
export function parseMappedDaily(buffer: ArrayBuffer, filename: string, value: unknown): DailyImport {
  const mapping=mappingFrom(value); const sheets=readSource(buffer); const sheet=sheets.find(s=>s.name===mapping.sheet);
  if(!sheet)throw new Error('Selected worksheet does not exist.');
  if(Object.keys(mapping.columns).length!==sheet.headers.length || sheet.headers.some(h=>!Object.hasOwn(mapping.columns,h)))throw new Error('Map or explicitly ignore every source column.');
  const indices=sheet.headers.map((h,i)=>({h,i,target:mapping.columns[h]})).filter(x=>x.target);
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([indices.map(x=>x.target),...sheet.rows.map(row=>indices.map(x=>row[x.i]??null))]),mapping.section);
  const result=parseDailyTotals(XLSX.write(wb,{type:'array',bookType:'xlsx'}), 'mapped.xlsx');
  if(!result.store._valid)return result;
  const input=result.store.inputs; input.meta.filename=filename;
  const section=({Production:'production',Fuel:'kilnFuel',Electricity:'electricity'} as const)[mapping.section];
  for(const row of input[section]) {
    const src=row._source as {row:number}; const cells=sheet.rows[src.row-2];
    row._source={origin:'workbook',file:filename,sheet:sheet.name,row:src.row,raw:Object.fromEntries(sheet.headers.map((h,i)=>[h,cells[i]??null])),columnMapping:mapping};
  }
  result.store=calculateStore(input,'workbook'); return result;
}
