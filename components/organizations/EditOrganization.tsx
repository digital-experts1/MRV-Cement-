"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { mrvFetch } from "@/lib/apiClient";
import { ORGANIZATION_TYPES } from "@/lib/tenancy/onboarding";

interface Details { name: string; country: string; organizationType: string; registrationNumber: string }
interface Organization { name: string; synthetic: boolean; profile: Partial<Details>; profile_version: number }

export function EditOrganization({ tenantId, onClose, onSaved }: { tenantId: string; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [details, setDetails] = useState<Details>({ name: "", country: "", organizationType: "", registrationNumber: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const controller = new AbortController();
    void mrvFetch<Organization>(`/orgs/${tenantId}`, { signal: controller.signal }).then(org => {
      setOrganization(org);
      setDetails({ name: org.name, country: org.profile.country ?? "", organizationType: org.profile.organizationType ?? "", registrationNumber: org.profile.registrationNumber ?? "" });
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load organization."); });
    return () => { controller.abort(); previous?.focus(); };
  }, [tenantId]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!organization || saving) return;
    setSaving(true); setError("");
    try {
      await mrvFetch(`/orgs/${tenantId}`, { method: "PATCH", json: { details, version: organization.profile_version } });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save. Please try again."); setSaving(false); }
  }
  return <dialog ref={dialog} className="organization-editor" aria-labelledby="organization-editor-title" onCancel={e => { e.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={save}>
      <header><div><span className="scope-muted">ORGANIZATION SETTINGS</span><h2 id="organization-editor-title">Edit organization</h2></div><button type="button" className="btn btn-secondary" aria-label="Close editor" disabled={saving} onClick={onClose}>×</button></header>
      <div className="organization-editor-body">
        <p className="scope-muted">Keep your organization’s name and business details up to date.</p>
        {error && <p role="alert" className="organization-editor-error">{error}</p>}
        {!organization && !error && <p role="status">Loading organization…</p>}
        {organization && <fieldset disabled={saving}>
          <label>Organization name<input autoComplete="organization" required minLength={2} maxLength={120} value={details.name} onChange={e => setDetails({ ...details, name: e.target.value })} /></label>
          <label>Country<input autoComplete="country-name" required minLength={2} maxLength={80} value={details.country} onChange={e => setDetails({ ...details, country: e.target.value })} /></label>
          <label>Organization type<select required value={details.organizationType} onChange={e => setDetails({ ...details, organizationType: e.target.value })}><option value="">Select organization type</option>{ORGANIZATION_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
          <label>Registration number <span className="scope-muted">(optional)</span><input maxLength={80} value={details.registrationNumber} onChange={e => setDetails({ ...details, registrationNumber: e.target.value })} /></label>
          <div className="organization-editor-note"><strong>Workspace type</strong><p>{organization.synthetic ? "Demo · synthetic data" : "Live organization"}</p><small>Workspace type is fixed. Factory data and saved calculations are preserved.</small></div>
          <p className="scope-muted">Only organization administrators can edit these details. Changes are recorded in the audit history.</p>
        </fieldset>}
      </div>
      <footer><button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={saving || !organization}>{saving ? "Saving…" : "Save changes"}</button></footer>
    </form>
  </dialog>;
}
