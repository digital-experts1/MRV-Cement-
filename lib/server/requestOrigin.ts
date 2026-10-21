/** Canonical public origin of this deployment; override for other installations. */
const PRODUCTION_ORIGIN = "https://cementmrv.traceforce.net";

function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Check browser writes against deployment configuration, never untrusted proxy headers.
 * Next.js may expose the loopback upstream in req.url behind Apache/TLS termination.
 * Requests without Origin retain the existing policy; authentication is still mandatory.
 */
export function isAllowedRequestOrigin(req: Request): boolean {
  if (['GET', 'HEAD'].includes(req.method.toUpperCase())) return true;
  const supplied = req.headers.get('origin');
  if (supplied === null) return true;
  const expected = process.env.MRV_APP_ORIGIN ??
    (process.env.NODE_ENV === 'production' ? PRODUCTION_ORIGIN : new URL(req.url).origin);
  const origin = parseOrigin(supplied);
  const trusted = parseOrigin(expected);
  return origin !== null && trusted !== null && origin === trusted;
}
