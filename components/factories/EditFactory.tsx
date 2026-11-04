"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { mrvFetch } from "@/lib/apiClient";

interface Details { name: string; country: string; city: string; address: string; siteType: string; registrationNumber: string }
interface Factory { name: string; code: string; timezone: string; reporting_boundary: string; profile: Partial<Details>; profile_version: number }
const TYPES = ["Integrated cement plant", "Clinker plant", "Cement grinding plant", "Other"];

export function EditFactory({ tenantId, facilityId, onClose, onSaved }: { tenantId: string; facilityId: string; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const [factory, setFactory] = useState<Factory | null>(null);
  const [details, setDetails] = useState<Details>({ name: "", country: "", city: "", address: "", siteType: "", registrationNumber: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const controller = new AbortController();
    void mrvFetch<Factory>(`/orgs/${tenantId}/facilities/${facilityId}/profile`, { signal: controller.signal }).then(f => {
      if (controller.signal.aborted) return;
      setFactory(f);
      setDetails({ name: f.name, country: f.profile.country ?? "", city: f.profile.city ?? "", address: f.profile.address ?? "", siteType: f.profile.siteType ?? "", registrationNumber: f.profile.registrationNumber ?? "" });
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load factory."); });
    return () => { alive.current = false; controller.abort(); previous?.focus(); };
  }, [tenantId, facilityId]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!factory || saving) return;
    if (details.name.trim().length < 2) { setError("Enter a factory name with at least two characters."); return; }
    setSaving(true); setError("");
    try {
      await mrvFetch(`/orgs/${tenantId}/facilities/${facilityId}/profile`, { method: "PATCH", json: { details, version: factory.profile_version } });
      if (alive.current) onSaved();
    } catch (e) { if (alive.current) { setError(e instanceof Error ? e.message : "Unable to save. Please try again."); setSaving(false); } }
  }
  return <dialog ref={dialog} className="organization-editor" aria-labelledby="factory-editor-title" onCancel={e => { e.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={save}>
      <header><div><span className="scope-muted">FACTORY PROFILE</span><h2 id="factory-editor-title">Edit factory</h2></div><button type="button" className="btn btn-secondary" aria-label="Close factory editor" disabled={saving} onClick={onClose}>×</button></header>
      <div className="organization-editor-body">
        <p className="scope-muted">Update the factory’s identity and site location. Optional fields can be completed later.</p>
        {error && <p role="alert" className="organization-editor-error">{error}</p>}
        {!factory && !error && <p role="status">Loading factory…</p>}
        {factory && <fieldset disabled={saving}>
          <label>Factory name<input required minLength={2} maxLength={120} value={details.name} onChange={e => setDetails({ ...details, name: e.target.value })} /></label>
          <label>Country<input autoComplete="country-name" maxLength={80} value={details.country} onChange={e => setDetails({ ...details, country: e.target.value })} /></label>
          <label>City / region<input autoComplete="address-level2" maxLength={120} value={details.city} onChange={e => setDetails({ ...details, city: e.target.value })} /></label>
          <label>Site address<input autoComplete="street-address" maxLength={300} value={details.address} onChange={e => setDetails({ ...details, address: e.target.value })} /></label>
          <label>Site type<select value={details.siteType} onChange={e => setDetails({ ...details, siteType: e.target.value })}><option value="">Not specified</option>{TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
          <label>Registration / reference number<input maxLength={80} value={details.registrationNumber} onChange={e => setDetails({ ...details, registrationNumber: e.target.value })} /></label>
          <div className="organization-editor-note"><strong>Reporting identity · read-only</strong><p>Code: {factory.code}<br />Timezone: {factory.timezone}<br />Boundary: {factory.reporting_boundary}</p><small>These settings affect imports and reporting. Profile edits preserve existing readings and saved calculation snapshots. Site type is descriptive and does not change the calculation method.</small></div>
          <p className="scope-muted">Only organization administrators can edit this profile. Changes are recorded in audit history.</p>
        </fieldset>}
      </div>
      <footer><button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={saving || !factory}>{saving ? "Saving…" : "Save changes"}</button></footer>
    </form>
  </dialog>;
}
