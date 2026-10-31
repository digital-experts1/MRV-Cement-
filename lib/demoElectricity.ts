import Decimal from 'decimal.js';
import { toIsoDate } from './dates';
import type { MrvInput } from './types';
export function varyDemoElectricity(input:MrvInput):MrvInput {
 if(!input.meta.synthetic)throw new Error('Variations are restricted to synthetic demo data.');
 if(!input.electricity.length)throw new Error('No electricity readings in the selected period.');
 const copy=structuredClone(input);
 copy.electricity=copy.electricity.map(row=>{
  const date=toIsoDate(row['Interval Start']);
  if(!date||date!==toIsoDate(row['Interval End']))throw new Error('Demo variations require explicitly declared daily readings.');
  const d=new Date(`${date}T00:00:00Z`);const day=Math.floor((d.getTime()-Date.UTC(d.getUTCFullYear(),0,1))/86400000);
  const season=12*Math.sin((day-85)*2*Math.PI/365);const weekly=[-7,2,4,1,3,-2,-5][d.getUTCDay()];const fluctuation=5*Math.sin(day*1.7);
  const maintenance=d.getUTCMonth()===3&&d.getUTCDate()>=12&&d.getUTCDate()<=18;
  const value=new Decimal(100).plus(season.toFixed(6)).plus(weekly).plus(fluctuation.toFixed(6)).mul(maintenance?'0.55':1).toDecimalPlaces(2).toNumber();
  return {...row,'Grid MWh':value,Notes:'SYNTHETIC DEMO: seasonal/weekly demand and April maintenance profile; not measured factory consumption.',_source:{origin:'demo',file:'SYNTHETIC_ELECTRICITY_VARIATION_V1',row:day+2,raw:{Date:date,'Grid MWh':value},previous:row._source}};
 });return copy;
}
