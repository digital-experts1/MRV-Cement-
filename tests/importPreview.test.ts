import { describe, expect, it, vi } from 'vitest';
import { importFile } from '../lib/server/mrv/service';
import { buildWorkbook } from './fixtures/synthetic';
import { buildDataPackage } from '../lib/dataPackage';
import { parseDailyTotals } from '../lib/mrv/dailyTotals';
import { toReadingDrafts } from '../lib/mrv/readings';
import type { MrvCaller } from '../lib/server/supabase/auth';

const tenant = '11111111-1111-4111-8111-111111111111';
const facility = '22222222-2222-4222-8222-222222222222';
const csv = 'Section,Date,Kiln Line,Cement Type,Clinker Produced t,Cement Produced t\nProduction,2026-10-01,K1,CEM I,80,100';
const bytes = new TextEncoder().encode(csv);
function caller(rows: unknown[] = [], allowed = true) {
  const writes = vi.fn(() => { throw new Error('Preview must never write'); });
  const tables: string[] = [];
  const rpc = vi.fn(async (name: string) => {
    if (name !== 'mrv_has_permission') throw new Error(`Unexpected RPC: ${name}`);
    return { data: allowed, error: null };
  });
  const db = { rpc, from(table: string) {
    tables.push(table);
    if (!['facility', 'activity_reading'].includes(table)) throw new Error(`Unexpected table: ${table}`);
    const q = { select() { return q; }, eq() { return q; }, lte() { return q; }, gte() { return q; }, order() { return q; },
      maybeSingle: async () => ({ data: { id: facility, code: 'F1', name: 'Factory', timezone: 'Africa/Cairo', tenant: { synthetic: false } }, error: null }),
      range: async () => ({ data: rows, error: null, count: rows.length }), insert: writes, update: writes, delete: writes };
    return q;
  }, storage: { from: writes } };
  return { value: { db } as unknown as MrvCaller, writes, tables, rpc };
}
const file = { filename: 'daily.csv', bytes, mapping: null, format: 'daily-totals', preview: true };
describe('read-only import review', () => {
  it('validates and summarizes a daily file without writing a batch, storage object or run', async () => {
    const c = caller();
    const review = await importFile(c.value, tenant, facility, file);
    expect(review).toMatchObject({ errors: [], count: 1, start: '2026-10-01', end: '2026-10-01', missingEvidence: 1, configKinds: [], unchanged: 0, revisions: 0 });
    expect(c.writes).not.toHaveBeenCalled();
    expect(c.tables).toEqual(['facility', 'activity_reading']);
  });
  it('distinguishes unchanged records, revised values and overlapping intervals', async () => {
    const parsed = parseDailyTotals(bytes.buffer, 'daily.csv');
    const r = toReadingDrafts(parsed.store.inputs, null).readings[0];
    for (const [stored, expected] of [
      [{ ...r }, { unchanged: 1, revisions: 0, overlaps: 0 }],
      [{ ...r, content_hash: 'changed', payload: { ...r.payload, 'Cement Produced t': 99 } }, { unchanged: 0, revisions: 1, overlaps: 0 }],
      [{ ...r, record_key: 'another', interval_end: '2026-10-31' }, { unchanged: 0, revisions: 0, overlaps: 1 }],
    ] as const) {
      const c = caller([stored]);
      expect(await importFile(c.value, tenant, facility, file)).toMatchObject(expected);
      expect(c.writes).not.toHaveBeenCalled();
    }
  });
  it('returns invalid-file issues without saving rejected batches', async () => {
    const c = caller();
    const review = await importFile(c.value, tenant, facility, { ...file, bytes: new TextEncoder().encode('bad,data\n1,2') });
    expect('errors' in review && review.errors.length).toBeGreaterThan(0);
    expect(c.tables).toEqual(['facility']);
    expect(c.writes).not.toHaveBeenCalled();
  });
  it('reports gaps between daily readings without claiming complete factory coverage', async () => {
    const c = caller();
    const gap = new TextEncoder().encode(csv + '\nProduction,2026-10-03,K1,CEM I,80,100');
    expect(await importFile(c.value, tenant, facility, { ...file, bytes: gap })).toMatchObject({ count: 2, missingDailyReadings: 1 });
    expect(c.writes).not.toHaveBeenCalled();
  });
  it('reviews JSON data exports through the same validation path', async () => {
    const c = caller();
    const store = parseDailyTotals(bytes.buffer, 'daily.csv').store;
    const json = new TextEncoder().encode(JSON.stringify(buildDataPackage(store)));
    expect(await importFile(c.value, tenant, facility, { ...file, filename: 'inputs.json', bytes: json, format: undefined })).toMatchObject({ errors: [], count: 1 });
    expect(c.writes).not.toHaveBeenCalled();
  });
  it('requires explicit workbook interval mapping before import and accepts a reviewed mapping', async () => {
    const c = caller();
    const workbook = { ...file, filename: 'collection.xlsx', bytes: new Uint8Array(buildWorkbook()), format: undefined };
    const unresolved = await importFile(c.value, tenant, facility, workbook);
    expect('errors' in unresolved && unresolved.errors.length).toBeGreaterThan(0);
    const resolved = await importFile(c.value, tenant, facility, { ...workbook, mapping: 'calendar_month_of_date' });
    expect(resolved).toMatchObject({ errors: [] });
    expect('count' in resolved && resolved.count).toBeGreaterThan(0);
    expect(c.writes).not.toHaveBeenCalled();
  });
  it('requires import permission even for preview', async () => {
    const c = caller([], false);
    await expect(importFile(c.value, tenant, facility, file)).rejects.toThrow('Missing permission');
    expect(c.writes).not.toHaveBeenCalled();
  });
});
