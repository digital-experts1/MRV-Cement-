import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Short-lived signed download tokens. A token binds tenant, facility, object id and the requesting user; it is
 * NOT a bearer credential on its own — the download endpoint also re-checks the caller's current authorization.
 */
export interface DownloadClaims {
  kind: "evidence" | "report";
  tenantId: string;
  facilityId: string;
  objectId: string;
  userId: string;
  exp: number;
}

export function createSigner(secret: string) {
  const sign = (payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");
  return {
    issue(claims: Omit<DownloadClaims, "exp">, ttlSeconds = 300, now = Date.now()): string {
      const payload = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(now / 1000) + ttlSeconds })).toString("base64url");
      return `${payload}.${sign(payload)}`;
    },
    verify(token: string, now = Date.now()): DownloadClaims | null {
      const [payload, sig] = token.split(".");
      if (!payload || !sig) return null;
      const expected = Buffer.from(sign(payload));
      const given = Buffer.from(sig);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      try {
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as DownloadClaims;
        return claims.exp > Math.floor(now / 1000) ? claims : null;
      } catch {
        return null;
      }
    },
  };
}

export type Signer = ReturnType<typeof createSigner>;

export function signerFromEnv(): Signer {
  const secret = process.env.DOWNLOAD_SIGNING_SECRET;
  if (secret && secret.length >= 32) return createSigner(secret);
  if (process.env.NODE_ENV === "production") throw new Error("DOWNLOAD_SIGNING_SECRET is not configured");
  return createSigner(randomBytes(32).toString("hex"));
}
