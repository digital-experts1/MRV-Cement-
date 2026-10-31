import { toIsoDate } from '@/lib/dates';
import type { SheetRow } from '@/lib/types';
export function sourceCoverage(rows: SheetRow[], start: string, end: string) {
  const days: string[]=[]; const first=toIsoDate(start),last=toIsoDate(end);
  if(!first||!last||first>last)return {days,counts:[] as number[],invalid:rows.length,intervals:0};
  for(let d=new Date(`${first}T00:00:00Z`);d.toISOString().slice(0,10)<=last&&days.length<3660;d.setUTCDate(d.getUTCDate()+1))days.push(d.toISOString().slice(0,10));
  const counts=days.map(()=>0);let invalid=0,intervals=0;
  for(const row of rows){const a=toIsoDate(row['Interval Start']),b=toIsoDate(row['Interval End']);if(!a||!b||a>b){invalid++;continue;}if(a!==b){intervals++;continue;}const index=days.indexOf(a);if(index>=0)counts[index]++;}
  return {days,counts,invalid,intervals};
}
export function sourceMapping(row: SheetRow): Record<string,unknown>|null {
 const source=row._source;
 if(!source||typeof source!=='object')return null;
 const m=(source as Record<string,unknown>).columnMapping;
 return m&&typeof m==='object'?m as Record<string,unknown>:null;
}
