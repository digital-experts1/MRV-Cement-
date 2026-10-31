import type { MrvInput,SheetRow } from './types';
import { toIsoDate } from './dates';
export const EVIDENCE_SECTIONS=[['Production','production','03_Production_Input'],['Raw materials','rawMaterial','04_Raw_Material_Input'],['Kiln fuel','kilnFuel','05_Kiln_Fuel_Input'],['Electricity','electricity','06_Electricity_Input']] as const;
export function evidenceCoverage(input:MrvInput){
 const register=new Map(input.evidence.map(r=>[String(r['Evidence ID']??'').trim(),r]));
 const readings=EVIDENCE_SECTIONS.flatMap(([label,key])=>input[key].map((row,index)=>({label,key,index,row,id:String(row['Evidence ID']??'').trim()})));
 return {readings,noId:readings.filter(r=>!r.id),unknown:readings.filter(r=>r.id&&!register.has(r.id)),linked:readings.filter(r=>r.id&&register.get(r.id)?.Status==='Mapped')};
}
export function safeEvidenceUrl(value:unknown):string|null{try{const u=new URL(String(value??''));return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function saveEvidenceReference(input:MrvInput,record:SheetRow,editId:string|null,link?:{key:typeof EVIDENCE_SECTIONS[number][1];start:string;end:string}) {
 const id=String(record['Evidence ID']??'').trim(); if(!id)throw new Error('Evidence ID is required.');
 if(!String(record.Description??'').trim()||!String(record.Owner??'').trim())throw new Error('Description and owner are required.');
 if(editId&&id!==editId)throw new Error('Existing evidence IDs cannot be renamed; this preserves reading links.');
 if(input.evidence.some(r=>String(r['Evidence ID']??'').trim()===id&&id!==editId))throw new Error('That evidence ID already exists.');
 if(record['Document URL']&&!safeEvidenceUrl(record['Document URL']))throw new Error('Document URL must be an HTTPS link without embedded credentials.');
 const copy=structuredClone(input);let linked=0;
 if(link){if(!toIsoDate(link.start)||!toIsoDate(link.end)||link.start>link.end)throw new Error('Choose a valid evidence coverage period.');
  copy[link.key]=copy[link.key].map(row=>{const a=toIsoDate(row['Interval Start']),b=toIsoDate(row['Interval End']);if(!a||!b||a<link.start||b>link.end)return row;
   const existing=String(row['Evidence ID']??'').trim();if(existing&&existing!==id)return row;linked++;return {...row,'Evidence ID':id};});
  if(!linked)throw new Error('No eligible readings: existing links to other evidence are preserved.');
 }
 const references=evidenceCoverage(copy).readings.filter(r=>r.id===id).length;
 const saved={...record,'Evidence ID':id,...(link?{'Mapped Sheet':EVIDENCE_SECTIONS.find(s=>s[1]===link.key)?.[2]}:{}),Status:references?'Mapped':'Pending'};
 const index=copy.evidence.findIndex(r=>String(r['Evidence ID']??'').trim()===editId);
 if(index>=0)copy.evidence[index]=saved;else copy.evidence.push(saved);
 return {input:copy,linked};
}
