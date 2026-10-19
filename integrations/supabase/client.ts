// Supabase connection. There is NO built-in project fallback (Directive 06 §1): the project must be configured
// explicitly via NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (e.g. in the git-ignored .env.local
// or the deployment environment). Missing configuration fails clearly instead of silently using another project.
// The publishable key is a public client key: all data access is enforced by RLS + server authorization.
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export const PRIVATE_BUCKET = "mrv-private";

// Must be referenced literally so Next.js can inline them into the browser bundle.
const URL_VALUE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY_VALUE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export class SupabaseConfigError extends Error {}

export function supabaseConfig(): { url: string; key: string } {
  const url = URL_VALUE?.trim();
  const key = KEY_VALUE?.trim();
  if (!url || !key) {
    throw new SupabaseConfigError(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. No default project is used."
    );
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
    throw new SupabaseConfigError("NEXT_PUBLIC_SUPABASE_URL is not a valid Supabase project URL.");
  }
  return { url, key };
}

export function isSupabaseConfigured(): boolean {
  try {
    supabaseConfig();
    return true;
  } catch {
    return false;
  }
}

let browserClient: SupabaseClient | null = null;

/** Browser client (cookie-based session shared with server route handlers). Throws SupabaseConfigError when unconfigured. */
export function getBrowserSupabase(): SupabaseClient {
  if (!browserClient) {
    const { url, key } = supabaseConfig();
    browserClient = createBrowserClient(url, key);
  }
  return browserClient;
}
