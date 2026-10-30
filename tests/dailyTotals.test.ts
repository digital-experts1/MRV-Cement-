import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseDailyTotals } from '../lib/mrv/dailyTotals';
import { toReadingDrafts, toConfigDrafts } from '../lib/mrv/readings';
import { planRun } from '../lib/mrv/executorPayload';
import { addDays, resolveRange, daysBetweenInclusive } from '../lib/mrv/dateRanges';
import { SYNTH_SETUP, SYNTH_CONSTANTS } from './fixtures/synthetic';

function file(sheets:Record<string,Record<string,unknown>[]>) {
 const wb=XLSX.utils.book_new();for(const [s,rows] of Object.entries(sheets))XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),s);
 return XLSX.write(wb,{type:'array',bookType:'xlsx'}) as ArrayBuffer;
}
const prod=(date:string)=>({Date:date,'Kiln Line':'K1','Cement Type':'CEM II','Clinker Produced t':760,'Cement Produced t':1000,'Clinker Used t':760,'Gypsum t':50,'Limestone Additive t':190,'Other Additives t':0,Quality:'Good'});
const fuel=(date:string)=>({Date:date,'Fuel Type':'Coal',Quantity:100,Unit:'t','NCV GJ/unit':25.8,'EF tCO2/TJ':94.6,'Oxidation Factor':.99,'Biomass Fraction':0});
const elec=(date:string)=>({Date:date,'Meter / Source':'M1',Electricity:100000,Unit:'kWh','Grid EF tCO2/MWh':.4878});
describe('Daily totals import and arbitrary date ranges',()=>{
 it('converts all 365 days and reconciles daily, weekly, monthly, quarterly, annual and custom ranges',()=>{
  const days=[];for(let d='2025-01-01';d<='2025-12-31';d=addDays(d,1))days.push(d);
  const parsed=parseDailyTotals(file({Production:days.map(prod),Fuel:days.map(fuel),Electricity:days.map(elec)}),'daily.xlsx');
  expect(parsed.store._valid).toBe(true);expect(parsed.configKinds).toEqual([]);
  const drafts=toReadingDrafts(parsed.store.inputs,null);expect(drafts.errors).toEqual([]);expect(drafts.readings).toHaveLength(1095);
  expect(drafts.readings.every(r=>r.granularity==='day'&&r.interval_start===r.interval_end)).toBe(true);
  const rows=drafts.readings.map((r,i)=>({...r,id:String(i),quality_state:'accepted' as const}));
  parsed.store.inputs.setup={...SYNTH_SETUP,'Period end':'2025-12-31'};parsed.store.inputs.constants=SYNTH_CONSTANTS;
  const docs=toConfigDrafts(parsed.store.inputs).map((d,i)=>({...d,id:String(i),effective_from:'2025-01-01',effective_to:'2025-12-31',created_at:'2026-01-01'}));
  const ranges=[['2025-01-01','2025-01-01'],['2025-01-06','2025-01-12'],['2025-02-01','2025-02-28'],['2025-01-01','2025-03-31'],['2025-01-01','2025-12-31'],['2025-02-17','2025-05-09']];
  for(const [start,end] of ranges){
   const p=planRun({readings:rows,docs,range:resolveRange({preset:'custom',start,end},{timezone:'Africa/Cairo'}),facility:{code:'TEST',synthetic:true}});
   expect(p.kind).toBe('run');if(p.kind!=='run')throw Error(p.note);
   const n=daysBetweenInclusive(start,end);
   expect(p.coverage.complete).toBe(true);expect(p.coverage.includedCount).toBe(n*3);
   expect(p.store.calculations['Cement Produced'].Value).toBe(n*1000);
   expect(p.store.calculations['Grid Electricity MWh'].Value).toBe(n*100);
   expect(p.store.calculations['Clinker Factor'].Value).toBe(.76);
   expect(Number(p.store.calculations['Total Embedded CO2'].Value)).toBeCloseTo(n*(760*.5325+100*25.8/1000*94.6*.99+100*.4878),6);
  }
  const gap=planRun({readings:rows.filter(r=>!(r.section==='electricity'&&r.observed_on==='2025-02-20')),docs,range:resolveRange({preset:'month',year:2025,month:2},{timezone:'Africa/Cairo'}),facility:{code:'TEST',synthetic:true}});
  expect(gap.coverage.complete).toBe(false);
 });
 it('reads CSV aliases, converts kWh, preserves raw values and does not manufacture factors',()=>{
  const csv='Section,Day,Meter,Grid kWh,Quality\nElectricity,2025-01-01,M1,125000,Good\n';
  const p=parseDailyTotals(new TextEncoder().encode(csv).buffer,'daily.csv');
  expect(p.store._valid).toBe(true);
  expect(p.store.inputs.electricity[0]['Grid MWh']).toBe(125);
  expect(p.store.inputs.electricity[0]['Grid EF tCO2/MWh']).toBeUndefined();
  expect(p.store.inputs.electricity[0]._source).toMatchObject({row:2,raw:{'Grid kWh':'125000'}});
 });
 it('preserves MWh and measured zero',()=>{
  const p=parseDailyTotals(file({Electricity:[{...elec('2025-01-01'),Electricity:0,Unit:'MWh'}]}),'daily.xlsx');
  expect(p.store._valid).toBe(true);expect(p.store.inputs.electricity[0]['Grid MWh']).toBe(0);
 });
 it.each([
  {Date:'01/02/2025'}, {Date:'2025-02-30'}, {Date:'2025-01-01T12:00:00Z'},
  {'Measurement Type':'cumulative_meter'}, {'Measurement Type':'rate'}, {'Interval End':'2025-01-31'},
  {Quality:'Bad'}, {Electricity:-1}, {Unit:'MW'}, {'Unexpected tag':12}, {'Grid MWh':100},
 ])('rejects ambiguous, non-daily or invalid data: %j',bad=>{
  const p=parseDailyTotals(file({Electricity:[{...elec('2025-01-01'),...bad}]}),'daily.xlsx');expect(p.store._valid).toBe(false);
 });
 it('rejects duplicate source/day rows rather than double counting',()=>{
  expect(parseDailyTotals(file({Production:[prod('2025-01-01'),prod('2025-01-01')]}),'d.xlsx').store._errors.join(' ')).toContain('duplicate daily');
 });
 it('keeps logical record keys stable on repeated imports',()=>{
  const bytes=file({Production:[prod('2025-01-01')]});
  const a=toReadingDrafts(parseDailyTotals(bytes,'a.xlsx').store.inputs,null);
  const b=toReadingDrafts(parseDailyTotals(bytes,'b.xlsx').store.inputs,null);
  expect(a.readings[0].record_key).toBe(b.readings[0].record_key);expect(a.readings[0].content_hash).toBe(b.readings[0].content_hash);
 });
 it('only supplies configuration when explicit sheets are present and retains synthetic labelling',()=>{
  const p=parseDailyTotals(file({Production:[prod('2025-01-01')],Setup:[{Parameter:'Dataset type',Value:'SYNTHETIC DEMO'},...Object.entries(SYNTH_SETUP).map(([Parameter,Value])=>({Parameter,Value}))],Constants:SYNTH_CONSTANTS}),'demo.xlsx');
  expect(p.store._valid).toBe(true);expect(p.store.meta.synthetic).toBe(true);expect(p.configKinds).toEqual(['setup','constants']);
 });
});
