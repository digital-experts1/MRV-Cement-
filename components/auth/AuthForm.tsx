"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { getBrowserSupabase } from "@/integrations/supabase/client";
import { useScope } from "@/context/ScopeContext";

type Mode = "signin" | "signup" | "reset";

/** Email/password sign-in via Supabase Auth. Sessions are cookie-based so server route handlers can authenticate. */
export function AuthForm({ initialMode = "signin" }: { initialMode?: Mode }) {
  const router = useRouter();
  const { reload } = useScope();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  function changeMode(next: Mode) { setMode(next); setError(null); setInfo(null); setPassword(""); setConfirmPassword(""); setShowPassword(false); }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (mode === "signup" && password !== confirmPassword) { setError("Passwords do not match."); return; }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const supabase = getBrowserSupabase();
      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
        reload();
        router.push("/overview");
      } else if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: new URL("/auth/callback", window.location.origin).href },
        });
        if (err) throw err;
        if (data.session) {
          reload();
          router.push("/onboarding");
        } else setInfo("Check your email to confirm your address, then sign in.");
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: new URL("/reset-password", window.location.origin).href });
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
    <section className="auth-access" aria-labelledby="auth-title">
      <div className="auth-mode-switch" aria-label="Account access">
        <button type="button" disabled={busy} aria-pressed={mode === "signin"} onClick={() => changeMode("signin")}>Sign in</button>
        <button type="button" disabled={busy} aria-pressed={mode === "signup"} onClick={() => changeMode("signup")}>Create account</button>
      </div>
      <h2 id="auth-title">{mode === "signin" ? "Welcome back" : title}</h2>
      <p className="auth-intro">{mode === "signin" ? "Sign in to your organization’s MRV workspace." : mode === "signup" ? "Create your account, then set up your organization or request access to an existing workspace." : "Enter your email to receive a password reset link."}</p>
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field"><span>Email address</span><input type="email" autoComplete="email" required disabled={busy} value={email} onChange={e => setEmail(e.target.value)} /></label>
        {mode !== "reset" && <>
          <label className="auth-field"><span>Password</span><div className="auth-password"><input type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} required disabled={busy} minLength={mode === "signup" ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} /><button type="button" disabled={busy} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide" : "Show"}</button></div></label>
          {mode === "signup" && <><p className="auth-hint">Use at least 8 characters.</p><label className="auth-field"><span>Confirm password</span><input type={showPassword ? "text" : "password"} autoComplete="new-password" required disabled={busy} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label></>}
        </>}
        {mode === "signin" && <button type="button" className="auth-recovery" disabled={busy} onClick={() => changeMode("reset")}>Forgot password?</button>}
        {error && <div className="auth-message auth-message-error" role="alert">{error}</div>}
        {info && <div className="auth-message" role="status">{info}</div>}
        <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "reset" ? "Send reset link" : title}</button>
        {mode === "reset" && <button type="button" className="auth-recovery" disabled={busy} onClick={() => changeMode("signin")}>Back to sign in</button>}
      </form>
      <p className="auth-privacy">Workspace access is controlled by your organization. Creating an account does not grant access to another organization’s data.</p>
    </section>
  );
}

