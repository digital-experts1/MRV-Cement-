import { createHash } from "node:crypto";
import { stableStringify } from "@/lib/hash";

/** Server-side SHA-256 of canonical JSON (key-sorted). Used for content hashes and run fingerprints. */
export function sha256Json(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
