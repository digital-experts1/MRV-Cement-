"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { ScopeNotice } from "@/components/ui/ScopeNotice";
import { useScope } from "@/context/ScopeContext";
import { mrvFetch } from "@/lib/apiClient";
import { ROLE_LABELS, type Role } from "@/lib/tenancy/permissions";

const guessTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

interface InvitationPreview {
  tenantId: string;
  tenantName: string;
  email: string;
  role: string;
  facilityId: string | null;
  expiresAt: string;
}

/** Creates an organization with its first factory, and accepts organization invitations (?invite=<token>). */
export default function OnboardingPage() {
  const router = useRouter();
  const { status, reload, facilities, memberships } = useScope();
  const [name, setName] = useState("");
  const [facilityCode, setFacilityCode] = useState("");
  const [facilityName, setFacilityName] = useState("");
  const [timezone, setTimezone] = useState(guessTimezone);
  const [synthetic, setSynthetic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invitation token comes from the URL (?invite=…); read from location so the page stays prerenderable.
  const [token, setToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [previewChecked, setPreviewChecked] = useState(false);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("invite");
    if (t && /^[0-9a-f]{64}$/.test(t)) setToken(t);
  }, []);

  useEffect(() => {
    if (!token || status === "signed-out" || status === "loading") return;
    void mrvFetch<InvitationPreview | null>(`/invitations/preview?token=${token}`)
      .then((p) => {
        setPreview(p);
        setPreviewChecked(true);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setPreviewChecked(true);
      });
  }, [token, status]);

  const facilityScope = (p: InvitationPreview) => {
    if (p.facilityId === null) return "all factories of the organization";
    const f = facilities.find((x) => x.id === p.facilityId);
    return f ? `${f.code} · ${f.name}` : "one factory of the organization";
  };

  async function accept() {
    if (!token) return;
    setAccepting(true);
    setError(null);
    try {
      await mrvFetch("/invitations/accept", { method: "POST", json: { token } });
      reload();
      router.push("/overview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAccepting(false);
    }
  }

  const invitationCard = token ? (
    <div className="section-card mb-lg">
      <SectionHeader icon="mail" title="Organization invitation" />
      <div className="section-card-body">
        {status === "signed-out" ? (
          <div className="dataset-banner dataset-banner-warn" role="note">
            This link contains an organization invitation. Sign in — or create an account with the invited email address — and
            open this link again to accept it. The link is single-use and expires after 7 days.
          </div>
        ) : !previewChecked ? (
          <p>Checking the invitation…</p>
        ) : preview ? (
          <>
            <p>
              You are invited to join <strong>{preview.tenantName}</strong> as{" "}
              <strong>{ROLE_LABELS[preview.role as Role] ?? preview.role}</strong> ({facilityScope(preview)}). The invitation is
              bound to the email address <span className="mono">{preview.email}</span> and expires{" "}
              {new Date(preview.expiresAt).toLocaleDateString()}.
            </p>
            {error ? <div className="dataset-banner dataset-banner-error" role="alert">{error}</div> : null}
            <button type="button" className="btn btn-primary" disabled={accepting} onClick={() => void accept()}>
              {accepting ? "Joining…" : "Accept invitation and join"}
            </button>
          </>
        ) : (
          <div className="dataset-banner dataset-banner-error" role="alert">
            This invitation link is invalid, expired, revoked or was already used.
          </div>
        )}
      </div>
    </div>
  ) : null;

  if (status === "signed-out") {
    return (
      <div className="page-container">
        <PageHeader icon="factory" title="Create organization" />
        {invitationCard}
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

  const hasOrg = memberships.length > 0;

  return (
    <div className="page-container">
      <PageHeader
        icon="factory"
        title={hasOrg ? "Create another organization" : "Create organization"}
        desc="An organization (customer) owns one or more factories. Data is isolated per organization and factory."
      />
      {invitationCard}
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