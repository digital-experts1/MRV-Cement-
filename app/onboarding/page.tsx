"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { ScopeNotice } from "@/components/ui/ScopeNotice";
import { useScope } from "@/context/ScopeContext";
import { mrvFetch } from "@/lib/apiClient";
import { OrganizationWizard } from "@/components/onboarding/OrganizationWizard";
import { ROLE_LABELS, type Role } from "@/lib/tenancy/permissions";

interface InvitationPreview {
  tenantId: string;
  tenantName: string;
  email: string;
  role: string;
  facilityId: string | null;
  expiresAt: string;
}

const subscribeLocation = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
};
const invitationToken = () => {
  const token = new URLSearchParams(window.location.search).get("invite");
  return token && /^[0-9a-f]{64}$/.test(token) ? token : null;
};

/** Creates an organization with its first factory, and accepts organization invitations (?invite=<token>). */
export default function OnboardingPage() {
  const router = useRouter();
  const { status, reload, facilities } = useScope();
  const [error, setError] = useState<string | null>(null);

  // Invitation token comes from the URL (?invite=…); read from location so the page stays prerenderable.
  const token = useSyncExternalStore(subscribeLocation, invitationToken, () => null);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [previewChecked, setPreviewChecked] = useState(false);
  const [accepting, setAccepting] = useState(false);

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

  if (status === "loading") return <div className="page-container" role="status">Loading your workspace…</div>;
  if (token) return <div className="page-container">{invitationCard}</div>;
  return <OrganizationWizard />;
}
