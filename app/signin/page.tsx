"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { getBrowserSupabase } from "@/integrations/supabase/client";
import { useScope } from "@/context/ScopeContext";

type Mode = "signin" | "signup" | "reset";

/** Email/password sign-in via Supabase Auth. Sessions are cookie-based so server route handlers can authenticate. */
export default function SignInPage() {
  const router = useRouter();
  const { reload } = useScope();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const supabase = getBrowserSupabase();
    try {
      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        reload();
        router.push("/overview");
      } else if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: new URL("/auth/callback", window.location.origin).href },
        });
        if (err) throw err;
        if (data.session) {
          reload();
          router.push("/onboarding");
        } else setInfo("Check your email to confirm your address, then sign in.");
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: new URL("/reset-password", window.location.origin).href });
        if (err) throw err;
        setInfo("If an account exists for this address, a password reset link has been sent.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Reset password";
  return (
    <div className="page-container">
      <PageHeader icon="lock" title={title} desc="Your organization's readings, calculations and files are stored privately and are only visible to authorized members." />
      <form className="section-card auth-card" onSubmit={submit}>
        <div className="section-card-body auth-form">
          <label className="auth-field">
            <span>Email</span>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {mode !== "reset" ? (
            <label className="auth-field">
              <span>Password</span>
              <input
                className="input"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={mode === "signup" ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          ) : null}
          {error ? <div className="dataset-banner dataset-banner-warn" role="alert">{error}</div> : null}
          {info ? <div className="dataset-banner" role="status">{info}</div> : null}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Please wait…" : title}
          </button>
          <div className="auth-links">
            {mode !== "signin" ? <button type="button" className="upload-link" onClick={() => setMode("signin")}>Sign in</button> : null}
            {mode !== "signup" ? <button type="button" className="upload-link" onClick={() => setMode("signup")}>Create account</button> : null}
            {mode !== "reset" ? <button type="button" className="upload-link" onClick={() => setMode("reset")}>Forgot password?</button> : null}
          </div>
        </div>
      </form>
    </div>
  );
}
