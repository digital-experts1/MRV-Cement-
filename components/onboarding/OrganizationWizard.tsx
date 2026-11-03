"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useScope } from "@/context/ScopeContext";
import { mrvFetch } from "@/lib/apiClient";
import { Icon } from "@/components/icons/Icon";
import { todayIn } from "@/lib/mrv/dateRanges";
import { onboardingError, ORGANIZATION_TYPES, type OrganizationDraft } from "@/lib/tenancy/onboarding";
import styles from "./OrganizationWizard.module.css";

const steps = [
  ["Organization", "Set your company details and workspace type"],
  ["First factory", "Add your first cement factory and location"],
  ["Reporting setup", "Define your first reporting period"],
  ["Review & create", "Confirm your details and create the workspace"],
];
const initialDraft = (): OrganizationDraft => {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const today = todayIn(timezone);
  return { name: "", country: "", organizationType: "Cement manufacturer", registrationNumber: "", facilityCode: "", facilityName: "", timezone, synthetic: false, start: `${today.slice(0, 7)}-01`, end: today };
};

export function OrganizationWizard() {
  const { reload } = useScope();
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const request = useRef<{ id: string; payload: string } | null>(null);
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const update = <K extends keyof OrganizationDraft>(key: K, value: OrganizationDraft[K]) => { setDraft(d => ({ ...d, [key]: value })); setError(null); };
  function go(next: number) {
    setStep(next); setError(null);
    requestAnimationFrame(() => heading.current?.focus());
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || created) return;
    const message = onboardingError(draft, step === 3 ? undefined : step);
    if (message) { setError(message); return; }
    if (step < 3) { go(step + 1); return; }
    submitting.current = true; setBusy(true); setError(null);
    const payload = JSON.stringify(draft);
    if (!request.current || request.current.payload !== payload) request.current = { id: crypto.randomUUID(), payload };
    try {
      await mrvFetch("/onboarding", { method: "POST", json: { requestId: request.current.id, details: draft } });
      setCreated(true);
      reload();
      router.replace("/overview");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the workspace. Please try again."); }
    finally { submitting.current = false; setBusy(false); }
  }
  const field = (label: string, key: Exclude<keyof OrganizationDraft, "synthetic">, options: { required?: boolean; maxLength?: number; type?: string; placeholder?: string } = {}) => (
    <label className={styles.field}><span>{label}{options.required ? <b aria-hidden="true"> *</b> : null}</span>
      <input {...options} value={draft[key]} onChange={e => update(key, e.target.value)} disabled={busy || created} />
    </label>
  );
  const initials = draft.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "CO";
  return <div className={styles.shell}>
    <aside className={styles.rail}>
      <div className={styles.brand}><svg viewBox="240 304 1000 360" role="img" aria-label="EgyTrace Systems — Measure, Report, Verify"><image href="/images/egytrace-logo-white.png" width="1536" height="1024" /></svg><small>Cement MRV</small></div>
      <Link href="/portfolio" className={styles.back}>← Back to portfolio</Link>
      <ol className={styles.steps}>{steps.map(([title, desc], i) => <li key={title} aria-current={step === i ? "step" : undefined} className={step === i ? styles.active : ""}>
        <span>{i < step ? "✓" : `0${i + 1}`}</span><div><strong>{title}</strong><small>{desc}</small></div>
      </li>)}</ol>
      <div className={styles.railNote}><Icon name="factory" size={80} /><p>Built for cement operations</p></div>
    </aside>
    <div className={styles.workspace}>
      <header className={styles.topbar}><strong>Cement MRV</strong><span>Organization setup</span></header>
      <div className={styles.content}>
        <span className={styles.eyebrow}>YOUR ORGANIZATION · YOUR WORKSPACE</span>
        <h1>Build your organization workspace</h1>
        <p className={styles.intro}>Connect your company, factories and reporting team in one place.</p>
        <form onSubmit={submit} noValidate>
          <div className={styles.columns}>
            <section className={styles.card} aria-labelledby="onboarding-heading">
              <div className={styles.cardHeading}><h2 id="onboarding-heading" ref={heading} tabIndex={-1}>{["Organization profile", "Your first factory", "Reporting setup", "Review your workspace"][step]}</h2><span>Step {step + 1} of 4</span></div>
              {step === 0 && <>
                <div className={styles.identity}><div className={styles.monogram} aria-hidden="true">{initials}</div><div>{field("Organization name", "name", { required: true, maxLength: 120, placeholder: "e.g. Nile Cement Group" })}<small>Use your registered company name.</small></div></div>
                <div className={styles.grid}>{field("Country", "country", { required: true, maxLength: 80, placeholder: "e.g. Egypt" })}
                  <label className={styles.field}><span>Organization type *</span><select value={draft.organizationType} onChange={e => update("organizationType", e.target.value)} disabled={busy}>{ORGANIZATION_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
                </div>
                {field("Registration number (optional)", "registrationNumber", { maxLength: 80, placeholder: "Company registration number" })}
                <fieldset className={styles.choices}><legend>Choose your workspace</legend><div className={styles.grid}>{[false, true].map(synthetic => <label key={String(synthetic)} className={draft.synthetic === synthetic ? styles.selected : ""}>
                  <input type="radio" name="workspace" checked={draft.synthetic === synthetic} onChange={() => update("synthetic", synthetic)} />
                  <span><strong>{synthetic ? "Demo workspace" : "Live operations"}</strong><small>{synthetic ? "For synthetic data and testing." : "Start with your own factory data."}</small></span>
                </label>)}</div></fieldset>
                <p className={styles.note}>{draft.synthetic ? "Demo data stays labelled synthetic. Creating this workspace does not generate sample readings." : "Start with an empty workspace. Only upload operational readings intended for this organization."}</p>
              </>}
              {step === 1 && <>
                <p className={styles.note}>Add one factory now. You can add more sites from Access Management after setup.</p>
                {field("Factory name", "facilityName", { required: true, maxLength: 120, placeholder: "e.g. Suez Cement Plant" })}
                {field("Factory code", "facilityCode", { required: true, maxLength: 20, placeholder: "e.g. SUEZ-01" })}
                <p className={styles.note}>A short code unique within this organization. Letters, numbers, hyphens and underscores only.</p>
                {field("Factory timezone", "timezone", { required: true, maxLength: 80, placeholder: "e.g. Africa/Cairo" })}
                <p className={styles.note}>Use an IANA timezone, such as Africa/Cairo, Asia/Dubai or UTC. Reporting dates follow the factory’s local day.</p>
              </>}
              {step === 2 && <>
                <p className={styles.note}>Choose the initial date range for this factory. You can change the reporting view later.</p>
                <div className={styles.grid}>{field("Reporting start", "start", { required: true, type: "date" })}{field("Reporting end", "end", { required: true, type: "date" })}</div>
                <div className={styles.callout}><strong>Start with a clear reporting period</strong><p>Your workspace opens on these dates. Calculation methodology, factors and approval settings are configured separately in Setup & Reporting Period.</p></div>
                <p className={styles.note}>Factory timezone: <strong>{draft.timezone}</strong></p>
              </>}
              {step === 3 && <>
                <p className={styles.note}>Review the details below. Creating the workspace gives you administrator access to this new organization.</p>
                <dl className={styles.review}>
                  {[["Organization",draft.name],["Country",draft.country],["Type",draft.organizationType],["Registration",draft.registrationNumber || "Not provided"],["Workspace",draft.synthetic ? "Demo · synthetic data" : "Live operations"],["Factory",`${draft.facilityCode.toUpperCase()} · ${draft.facilityName}`],["Timezone",draft.timezone],["Reporting period",`${draft.start} → ${draft.end}`]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl>
                <div className={styles.callout}><strong>Private to your organization</strong><p>Access is controlled by organization membership and factory permissions. Invite your team after creation. No readings are copied from your other workspaces.</p></div>
              </>}
              {error && <div className={styles.error} role="alert">{error}</div>}
              {created && <p role="status">Workspace created. Opening your overview…</p>}
            </section>
            <aside className={styles.preview} aria-label="Workspace preview">
              <div className={styles.card}><div className={styles.cardHeading}><h2>Workspace preview</h2><span>Not created yet</span></div>
                <div className={styles.previewBrand}><b>{initials}</b><div><strong>{draft.name || "Your organization"}</strong><small>{draft.country || "Country"} · {draft.organizationType}</small></div></div>
                <div className={styles.previewRow}><strong>Organization</strong><span>{onboardingError(draft,0) ? "Add details" : "Details entered"}</span></div>
                <div className={styles.previewRow}><strong>First factory</strong><span>{draft.facilityName || "Next step"}</span></div>
                <div className={styles.previewRow}><strong>Reporting period</strong><span>{step >= 2 ? `${draft.start} — ${draft.end}` : "Review in step 3"}</span></div>
                <div className={styles.previewRow}><strong>Team members</strong><span>Invite after setup</span></div>
                <div className={styles.factory}><Icon name="factory" size={34} /><strong>{draft.facilityCode || "Your first factory"}</strong><small>{draft.facilityName || "Your factory will appear here"}</small></div>
              </div>
              <div className={styles.callout}><strong>Start small. Expand later.</strong><p>Add one factory now. Connect more sites and invite your team after setup.</p></div>
            </aside>
          </div>
          <footer className={styles.actions}>
            {step > 0 ? <button type="button" className="btn btn-secondary" onClick={() => go(step - 1)} disabled={busy || created}>← Back</button> : <Link href="/portfolio" className="btn btn-secondary">Cancel</Link>}
            <span>Nothing is created until final review</span>
            <button type="submit" className="btn btn-primary" disabled={busy || created}>{created ? "Opening workspace…" : busy ? "Creating workspace…" : ["Continue to first factory →", "Continue to reporting →", "Review workspace →", "Create organization"][step]}</button>
          </footer>
        </form>
      </div>
    </div>
  </div>;
}
