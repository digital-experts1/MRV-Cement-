/**
 * Trusted-executor signatures (Directive 06 §2, 06B §2). Server/test only (node:crypto). Must match
 * mrv_private.verify_executor in db/supabase/0003_mrv_trusted_execution.sql exactly.
 *
 * Signed message (v2): version | operation | key id | actor (auth user id) | tenant | facility | issued_at | nonce | sha256(body)
 *  - operation: import | run | withdraw | archive (a signature for one RPC is useless for another);
 *  - actor: the database compares it with auth.uid() of the JWT that calls the RPC;
 *  - body: the complete request text (results, inputs, reading ids, …), hashed byte-for-byte;
 *  - issued_at: valid for EXECUTOR_TTL_SECONDS, at most EXECUTOR_MAX_SKEW_SECONDS in the future;
 *  - nonce: random UUID consumed once (replay protection, independent of body/time).
 */
import { createHash, createHmac, randomUUID } from "node:crypto";

export const EXECUTOR_PROTOCOL = "trace-mrv-exec/v2";
export const EXECUTOR_TTL_SECONDS = 120;
export const EXECUTOR_MAX_SKEW_SECONDS = 30;

export type ExecutorPurpose = "import" | "run" | "withdraw" | "archive";

export interface ExecutorKey {
  keyId: string;
  secret: Buffer;
}

export interface ExecutorAuth {
  v: 2;
  key_id: string;
  issued_at: number;
  nonce: string;
  signature: string;
}

export function signExecutorRequest(
  key: ExecutorKey,
  purpose: ExecutorPurpose,
  ctx: { userId: string; tenantId: string; facilityId: string },
  body: string,
  opts: { issuedAt?: number; nonce?: string } = {}
): ExecutorAuth {
  const issuedAt = opts.issuedAt ?? Math.floor(Date.now() / 1000);
  const nonce = (opts.nonce ?? randomUUID()).toLowerCase();
  const bodySha = createHash("sha256").update(body, "utf8").digest("hex");
  const msg = [EXECUTOR_PROTOCOL, purpose, key.keyId, ctx.userId.toLowerCase(), ctx.tenantId.toLowerCase(), ctx.facilityId.toLowerCase(), String(issuedAt), nonce, bodySha].join("|");
  return { v: 2, key_id: key.keyId, issued_at: issuedAt, nonce, signature: createHmac("sha256", key.secret).update(msg, "utf8").digest("hex") };
}
