import { HttpError } from "@/lib/server/authz/errors";
import type { ExecutorKey } from "@/lib/mrv/executorSign";

/**
 * Trusted calculation executor key (Directive 06 §2). Server environment only — never NEXT_PUBLIC_*.
 * Without it, imports and calculations are refused (stored runs stay readable); there is no fallback path.
 */
export function executorKey(): ExecutorKey {
  const keyId = process.env.MRV_EXECUTOR_KEY_ID?.trim();
  const hex = process.env.MRV_EXECUTOR_KEY?.trim();
  if (!keyId || !hex || !/^[a-z0-9_-]{1,40}$/.test(keyId) || !/^[0-9a-f]{60,}$/i.test(hex) || hex.length % 2) {
    throw new HttpError(
      503,
      "The trusted calculation executor is not configured on this server (MRV_EXECUTOR_KEY_ID / MRV_EXECUTOR_KEY). Imports and calculations are disabled; stored results remain readable."
    );
  }
  return { keyId, secret: Buffer.from(hex, "hex") };
}
