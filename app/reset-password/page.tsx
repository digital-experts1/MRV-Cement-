"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { getBrowserSupabase } from "@/integrations/supabase/client";

/** Password recovery landing page: the recovery link establishes a session, then the user sets a new password. */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) setReady(true);
        else setError("This reset link is invalid or has expired. Request a new one from the sign-in page.");
      });
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await getBrowserSupabase().auth.updateUser({ password });
    setBusy(false);
    if (err) setError(err.message);
    else router.replace("/overview");
  }

  return (
    <div className="page-container">
      <PageHeader icon="lock" title="Set a new password" />
      {error ? <div className="dataset-banner dataset-banner-warn" role="alert">{error}</div> : null}
      {ready ? (
        <form className="section-card auth-card" onSubmit={submit}>
          <div className="section-card-body auth-form">
            <label className="auth-field">
              <span>New password</span>
              <input className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Update password"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
