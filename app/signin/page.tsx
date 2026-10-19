"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { useScope } from "@/context/ScopeContext";
import { apiFetch } from "@/lib/apiClient";

interface DevUser {
  email: string;
  name: string;
}

/**
 * Development sign-in with SYNTHETIC identities. The production identity provider is not yet selected; the
 * endpoint behind this page returns 404 in production builds.
 */
export default function SignInPage() {
  const router = useRouter();
  const { reload } = useScope();
  const [users, setUsers] = useState<DevUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<DevUser[]>("/dev/users")
      .then(setUsers)
      .catch(() => setError("Sign-in is not available in this deployment: no identity provider is configured yet."));
  }, []);

  async function signIn(email: string) {
    setBusy(email);
    setError(null);
    try {
      await apiFetch("/auth/dev-login", { method: "POST", json: { email } });
      reload();
      router.push("/overview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page-container">
      <PageHeader icon="lock" title="Sign in (development)" desc="Synthetic identities for testing tenant isolation. Not available in production." />
      <div className="dataset-banner dataset-banner-synthetic" role="note">
        All organizations, factories and users listed here are SYNTHETIC test fixtures held in an in-memory development database.
      </div>
      {error ? <div className="dataset-banner dataset-banner-warn">{error}</div> : null}
      {users ? (
        <div className="signin-list">
          {users.map((u) => (
            <button key={u.email} type="button" className="btn btn-secondary signin-user" disabled={!!busy} onClick={() => signIn(u.email)}>
              <span>{u.name}</span>
              <small>{u.email}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
