import {describe,it,expect} from 'vitest';
import {createEmptyInput} from '../lib/types';
import {evidenceCoverage,saveEvidenceReference,safeEvidenceUrl} from '../lib/evidenceReview';
describe('evidence reference workflow',()=>{
 it('distinguishes absent and unknown IDs',()=>{const input=createEmptyInput('demo');input.production=[{}, {'Evidence ID':'unknown'}];const r=evidenceCoverage(input);expect(r.noId).toHaveLength(1);expect(r.unknown).toHaveLength(1);expect(r.linked).toHaveLength(0);});
 it('links only eligible rows, preserves other IDs and original inputs',()=>{const input=createEmptyInput('demo');input.electricity=[{'Interval Start':'2026-01-01','Interval End':'2026-01-01'},{'Interval Start':'2026-01-02','Interval End':'2026-01-02','Evidence ID':'other'}];const r=saveEvidenceReference(input,{'Evidence ID':'EV1',Description:'Invoice',Owner:'Utilities'},null,{key:'electricity',start:'2026-01-01',end:'2026-01-31'});expect(r.linked).toBe(1);expect(r.input.electricity[1]['Evidence ID']).toBe('other');expect(r.input.evidence[0].Status).toBe('Mapped');expect(input.evidence).toHaveLength(0);});
 it('blocks unsafe URLs, duplicate IDs and renaming',()=>{expect(safeEvidenceUrl('javascript:alert(1)')).toBeNull();expect(safeEvidenceUrl('https://name:secret@example.com')).toBeNull();const input=createEmptyInput('demo');input.evidence=[{'Evidence ID':'EV1'}];expect(()=>saveEvidenceReference(input,{'Evidence ID':'EV1',Description:'x',Owner:'y'},null)).toThrow();expect(()=>saveEvidenceReference(input,{'Evidence ID':'EV2',Description:'x',Owner:'y'},'EV1')).toThrow();});
});
