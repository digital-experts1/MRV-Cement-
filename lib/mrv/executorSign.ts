/**
 * Trusted-executor signatures (Directive 06 §2). Server/test only (node:crypto). Must match
 * mrv_private.verify_executor in db/supabase/0003_mrv_trusted_execution.sql exactly.
 */
import { createHash, createHmac } from "node:crypto";

export type ExecutorPurpose = "import" | "run" | "withdraw";

export interface ExecutorKey {
  keyId: string;
  secret: Buffer;
}

export interface ExecutorAuth {
  key_id: string;
  issued_at: number;
  signature: string;
}

export function signExecutorRequest(
  key: ExecutorKey,
  purpose: ExecutorPurpose,
  ctx: { userId: string; tenantId: string; facilityId: string },
  body: string,
  issuedAt = Math.floor(Date.now() / 1000)
): ExecutorAuth {
  const bodySha = createHash("sha256").update(body, "utf8").digest("hex");
  const msg = ["trace-mrv-exec/v1", purpose, key.keyId, ctx.userId.toLowerCase(), ctx.tenantId.toLowerCase(), ctx.facilityId.toLowerCase(), String(issuedAt), bodySha].join("|");
  return { key_id: key.keyId, issued_at: issuedAt, signature: createHmac("sha256", key.secret).update(msg, "utf8").digest("hex") };
}
