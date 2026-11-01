import { describe, it, expect } from 'vitest';
import { factorIssues, factorSourceUrl, groupFactorRows } from '../lib/mrv/factorReview';
describe('factor workspace review', () => {
  it('never parses numeric prefixes as valid factors', () => {
    expect(factorIssues({Value:'12oops'})).toContain('Invalid number');
    expect(factorIssues({Value:0})).not.toContain('Missing value');
    expect(factorIssues({Value:null})).toContain('Missing value');
  });
  it('only links web sources', () => {
    expect(factorSourceUrl('javascript:alert(1)')).toBeNull();
    expect(factorSourceUrl('data:text/html,bad')).toBeNull();
    expect(factorSourceUrl('https://example.com/source')).toBe('https://example.com/source');
  });
  it('preserves distinct units and missing factors in grouped readings', () => {
    const rows = [{Unit:'t',EF:0},{Unit:'t',EF:0},{Unit:'Nm3',EF:0},{Unit:'t',EF:null}];
    const groups=groupFactorRows(rows,['Unit','EF']);
    expect(groups.map(g=>g.count)).toEqual([2,1,1]);
    expect(groups[2].row.EF).toBeNull();
  });
});
