import { hostedGuard } from "@/tests/hosted/cases";

/**
 * Runtime guard for development/test endpoints (defence in depth — the route wrappers in app/api/dev/* import these
 * implementations only inside a statically-false-in-production `NODE_ENV === "development"` branch, see next.config.ts):
 *  - never in production;
 *  - loopback host only (also defeats DNS-rebinding: the Host header must be localhost/127.0.0.1/[::1]);
 *  - no cross-site browser requests (Sec-Fetch-Site / Origin must be same-origin when present);
 *  - `hosted`: explicit test configuration and the designated project reference (tests/hosted/cases.ts hostedGuard).
 * Returns a Response to send when access is refused, otherwise null.
 */
export function devGuard(req: Request, opts: { hosted?: boolean } = {}): Response | null {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const deny = (reason: string) => Response.json({ error: `development endpoint refused: ${reason}` }, { status: 403, headers: { "cache-control": "no-store" } });
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return deny("loopback host required");
  const forwarded = req.headers.get("x-forwarded-host");
  if (forwarded && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(forwarded)) return deny("forwarded host not allowed");
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return deny("cross-site request");
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== host) return deny("cross-origin request");
    } catch {
      return deny("invalid origin");
    }
  }
  if (opts.hosted) {
    const g = hostedGuard();
    if (!g.ok) return deny(g.reason);
  }
  return null;
}
