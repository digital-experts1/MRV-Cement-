import { describe,it,expect } from 'vitest';
import {referenceIssues,referenceMatches} from '../lib/mrv/regulatoryReview';
import {calculateStore} from '../lib/calcEngine';
import {createEmptyInput} from '../lib/types';
describe('regulatory register',()=>{
  it('flags impossible dates and unsafe sources',()=>{expect(referenceIssues({'Last checked':'2026-02-30','Official source URL':'javascript:bad'})).toContain('Review date missing or invalid'); expect(referenceIssues({'Official source URL':'javascript:bad'})).toContain('Source link missing or invalid');});
  it('searches reference metadata without interpreting official status',()=>{expect(referenceMatches({Reference:'Cement methodology'},' CEMENT ')).toBe(true); expect(referenceIssues({Status:'Official'}).length).toBeGreaterThan(0);});
  it('keeps reference metadata in the calculation snapshot',()=>{const input=createEmptyInput();input.regulatory=[{Reference:'Synthetic test',Notes:'Test only','Last checked':'2026-10-01'}];expect(calculateStore(input,'manual').regulatory).toEqual(input.regulatory);});
});
