import { describe,it,expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseMappedDaily, type ColumnMapping } from '../lib/mrv/columnMapping';
import { sourceCoverage } from '../lib/mrv/sourceOverview';
import { varyDemoElectricity } from '../lib/demoElectricity';
import { createEmptyInput } from '../lib/types';
const mapping:ColumnMapping={version:'trace-columns/v1',sheet:'SCADA',section:'Electricity',measurement:'daily_total',source:'Demo meter',owner:'Demo operator',columns:{Day:'Date',Tag:'Meter / Source',Energy:'Grid kWh'}};
function file(rows:unknown[][]){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Day','Tag','Energy'],...rows]),'SCADA');return XLSX.write(wb,{type:'array',bookType:'xlsx'}) as ArrayBuffer;}
describe('mapped daily files',()=>{
 it('converts kWh and retains original source headers, values and mapping',()=>{const r=parseMappedDaily(file([['2026-01-01','M1',125000]]),'source.xlsx',mapping);expect(r.store._valid).toBe(true);const row=r.store.inputs.electricity[0];expect(row['Grid MWh']).toBe(125);expect(row._source).toMatchObject({file:'source.xlsx',sheet:'SCADA',row:2,raw:{Energy:125000},columnMapping:mapping});expect(r.configKinds).toEqual([]);});
 it('rejects duplicate daily identities',()=>{expect(parseMappedDaily(file([['2026-01-01','M1',1],['2026-01-01','M1',2]]),'source.xlsx',mapping).store._valid).toBe(false);});
 it('rejects counters, duplicate target mappings and undeclared columns',()=>{expect(()=>parseMappedDaily(file([]),'a.xlsx',{...mapping,measurement:'counter'})).toThrow();expect(()=>parseMappedDaily(file([]),'a.xlsx',{...mapping,columns:{Day:'Date',Tag:'Date',Energy:'Grid kWh'}})).toThrow();expect(()=>parseMappedDaily(file([]),'a.xlsx',{...mapping,columns:{Day:'Date'}})).toThrow();});
 it('does not turn longer intervals into daily coverage',()=>{const r=sourceCoverage([{'Interval Start':'2026-01-01','Interval End':'2026-01-31'}],'2026-01-01','2026-01-31');expect(r.intervals).toBe(1);expect(r.counts.every(n=>n===0)).toBe(true);});
 it('restricts variations to synthetic data and preserves identity and factors',()=>{const input=createEmptyInput('demo');input.meta.synthetic=false;expect(()=>varyDemoElectricity(input)).toThrow();input.meta.synthetic=true;input.electricity=[{'Interval Start':'2026-01-01','Interval End':'2026-01-01','Meter / Source':'M1','Grid MWh':100,'Grid EF tCO2/MWh':0.4}];const out=varyDemoElectricity(input);expect(out.electricity[0]['Grid MWh']).not.toBe(100);expect(out.electricity[0]['Grid EF tCO2/MWh']).toBe(0.4);expect(input.electricity[0]['Grid MWh']).toBe(100);expect(varyDemoElectricity(input)).toEqual(out);});
});
