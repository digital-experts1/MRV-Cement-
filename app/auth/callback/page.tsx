"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/integrations/supabase/client";

/** Return URL for email confirmation links. The browser client exchanges the PKCE code from the URL during init. */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") router.replace("/reset-password");
    });
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get("error_description");
    if (urlError) {
      setError(urlError);
      return () => data.subscription.unsubscribe();
    }
    supabase.auth.getSession().then(({ data: s, error: err }) => {
      if (err || !s.session) setError(err?.message ?? "This link is invalid or has expired. Please sign in again.");
      else router.replace("/overview");
    });
    return () => data.subscription.unsubscribe();
  }, [router]);

  return <div className="page-container">{error ? <div className="dataset-banner dataset-banner-warn">{error}</div> : "Completing sign-in…"}</div>;
}
