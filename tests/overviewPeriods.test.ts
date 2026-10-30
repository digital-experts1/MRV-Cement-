import { describe, expect, it } from 'vitest';
import { rangeWithDefaults } from '../lib/mrv/rangeDefaults';
import { resolveRange, specForDates } from '../lib/mrv/dateRanges';
import { createEmptyInput } from '../lib/types';
import { toReadingDrafts, toConfigDrafts } from '../lib/mrv/readings';
import { parseMapping } from '../lib/mrv/importMapping';
import { planRun } from '../lib/mrv/executorPayload';
import { SYNTH_SETUP, SYNTH_PRODUCTION, SYNTH_FUEL, SYNTH_ELECTRICITY, SYNTH_CONSTANTS } from './fixtures/synthetic';

describe('Overview historical reporting periods', () => {
  const timezone = 'Africa/Cairo';
  it('keeps the resolved historical year when switching a custom period to a calendar year', () => {
    const spec = { preset: 'custom' as const, start: '2025-01-01', end: '2025-12-31' };
    expect(rangeWithDefaults('year', spec, timezone, resolveRange(spec, { timezone }))).toEqual({ preset: 'year', year: 2025 });
  });
  it('keeps the previous-year selection when switching to calendar month or custom dates', () => {
    const spec = { preset: 'previous_year' as const };
    const resolved = resolveRange({ preset: 'year', year: 2025 }, { timezone });
    expect(rangeWithDefaults('month', spec, timezone, resolved)).toEqual({ preset: 'month', year: 2025, month: 1 });
    expect(rangeWithDefaults('custom', spec, timezone, resolved)).toEqual({ preset: 'custom', start: '2025-01-01', end: '2025-12-31' });
  });
  it('calculates all twelve monthly intervals and scopes a month without counting the rest of the year', () => {
    const input = createEmptyInput('demo');
    input.meta.synthetic = true;
    input.setup = { ...SYNTH_SETUP, 'Period end': '2025-12-31' };
    input.constants = SYNTH_CONSTANTS;
    for (let month=1; month<=12; month++) {
      const r=resolveRange({preset:'month',year:2025,month},{timezone});
      input.production.push({...SYNTH_PRODUCTION,Date:r.end});
      input.kilnFuel.push({...SYNTH_FUEL,Date:r.end});
      input.electricity.push({...SYNTH_ELECTRICITY,Date:r.end});
    }
    const drafts=toReadingDrafts(input,parseMapping('calendar_month_of_date'));
    expect(drafts.errors).toEqual([]);
    const readings=drafts.readings.map((r,i)=>({...r,id:String(i),quality_state:'accepted' as const,synthetic:true}));
    const docs=toConfigDrafts(input).map((d,i)=>({...d,id:String(i),effective_from:'2025-01-01',effective_to:'2025-12-31',created_at:'2026-01-01'}));
    for (const months of [1,12]) {
      const range=resolveRange(months===12?specForDates('2025-01-01','2025-12-31'):{preset:'month',year:2025,month:6},{timezone});
      const plan=planRun({readings,docs,range,facility:{code:'SYNTHETIC',synthetic:true}});
      expect(plan.kind).toBe('run');
      if(plan.kind!=='run') throw new Error(plan.note);
      expect(plan.coverage.complete).toBe(true);
      expect(plan.coverage.includedCount).toBe(months*3);
      expect(plan.store.calculations['Cement Produced'].Value).toBe(months*680000);
      expect(plan.store.setup['Period end']).toBe(range.end);
    }
  });
});
