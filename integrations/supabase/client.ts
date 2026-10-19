// Supabase connection for the development project (ref vbxvhbnhstdfbkgjuzgs), selected via the Dyad integration.
// The publishable key is a public client key: all data access is enforced by RLS + server authorization.
// Deployments may override both values with NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://vbxvhbnhstdfbkgjuzgs.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_2-EQGjV6RW5A-zQ6C6wrPg_yTmH29oP";
export const PRIVATE_BUCKET = "mrv-private";

let browserClient: SupabaseClient | null = null;

/** Browser client (cookie-based session shared with server route handlers). Import like:
 *  import { getBrowserSupabase } from "@/integrations/supabase/client";
 */
export function getBrowserSupabase(): SupabaseClient {
  if (!browserClient) browserClient = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return browserClient;
}
