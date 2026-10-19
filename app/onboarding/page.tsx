"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { ScopeNotice } from "@/components/ui/ScopeNotice";
import { useScope } from "@/context/ScopeContext";
import { mrvFetch } from "@/lib/apiClient";

const guessTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** Creates an organization with its first factory. The creator becomes tenant admin, facility manager and MRV analyst. */
export default function OnboardingPage() {
  const router = useRouter();
  const { status, reload } = useScope();
  const [name, setName] = useState("");
  const [facilityCode, setFacilityCode] = useState("");
  const [facilityName, setFacilityName] = useState("");
  const [timezone, setTimezone] = useState(guessTimezone);
  const [synthetic, setSynthetic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "signed-out") {
    return (
      <div className="page-container">
        <PageHeader icon="factory" title="Create organization" />
        <ScopeNotice signIn title="Sign in first" desc="Organizations belong to signed-in users." />
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await mrvFetch("/orgs", { method: "POST", json: { name, facilityCode, facilityName, timezone, synthetic } });
      reload();
      router.push("/overview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-container">
      <PageHeader icon="factory" title="Create organization" desc="An organization (customer) owns one or more factories. Data is isolated per organization and factory." />
      <form className="section-card auth-card" onSubmit={submit}>
        <div className="section-card-body auth-form">
          <label className="auth-field">
            <span>Organization name</span>
            <input className="input" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="auth-field">
            <span>First factory code (e.g. PLANT-1)</span>
            <input className="input" required pattern="[A-Za-z0-9_\-]{1,20}" value={facilityCode} onChange={(e) => setFacilityCode(e.target.value)} />
          </label>
          <label className="auth-field">
            <span>Factory name</span>
            <input className="input" required minLength={2} maxLength={120} value={facilityName} onChange={(e) => setFacilityName(e.target.value)} />
          </label>
          <label className="auth-field">
            <span>Factory timezone (IANA, used for date ranges)</span>
            <input className="input" required value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </label>
          <label className="auth-check">
            <input type="checkbox" checked={synthetic} onChange={(e) => setSynthetic(e.target.checked)} />
            <span>Synthetic demo organization (for fictitious data; everything stored in it is labelled SYNTHETIC and is never treated as plant data)</span>
          </label>
          {error ? <div className="dataset-banner dataset-banner-warn" role="alert">{error}</div> : null}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create organization"}
          </button>
        </div>
      </form>
    </div>
  );
}
