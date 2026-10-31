"use client";
import { useState } from 'react';
import { useScope } from '@/context/ScopeContext';
import { varyDemoElectricity } from '@/lib/demoElectricity';
import type { MrvInput,Store } from '@/lib/types';
export function DemoElectricity({s}:{s:Store}){
 const scope=useScope();const [draft,setDraft]=useState<MrvInput|null>(null);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
 const synthetic=scope.memberships.find(m=>m.tenantId===scope.tenantId)?.synthetic;
 if(!synthetic||!s.meta.synthetic||!scope.canImport)return null;
 function preview(){try{setDraft(varyDemoElectricity(s.inputs));setMessage('');}catch(e){setMessage(e instanceof Error?e.message:String(e));}}
 async function apply(){if(!draft)return;setBusy(true);try{const result=await scope.saveManual(draft);if(!result.accepted)setMessage(result.errors.join(' '));else{setDraft(null);setMessage('Synthetic electricity variations saved as revisions. Review the recalculated results.');}}catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 const numbers=draft?.electricity.map(r=>Number(r['Grid MWh']))??[];
 return <section className="section-card dcs-review"><h3>Synthetic demo electricity profile</h3><p>Replace electricity values in the selected period with seasonal demand, weekly variation and an April maintenance dip. Existing meter identities and emission factors are retained. Saved reading history is preserved.</p>
 <button className="btn btn-secondary" disabled={busy||scope.calculating} onClick={preview}>Preview demo variations</button>
 {draft&&<><p>{numbers.length} daily readings · {Math.min(...numbers)}–{Math.max(...numbers)} MWh per reading. These are generated demo values, not measured consumption.</p><button className="btn btn-primary" disabled={busy||scope.calculating} onClick={()=>void apply()}>{busy?'Saving revisions…':'Apply synthetic variations to this period'}</button><button className="btn btn-secondary" disabled={busy} onClick={()=>setDraft(null)}>Cancel</button></>}
 {message&&<p role="status">{message}</p>}</section>;
}
