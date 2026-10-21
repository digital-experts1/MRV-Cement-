import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowedRequestOrigin } from "../lib/server/requestOrigin";

afterEach(() => vi.unstubAllEnvs());

const request = (origin?: string, extra: Record<string, string> = {}) => new Request('http://127.0.0.1:3010/api/mrv/preference', {
  method: 'PUT', headers: { ...(origin === undefined ? {} : { origin }), ...extra },
});

describe('reverse proxy browser origin protection', () => {
  it('accepts the canonical HTTPS site behind a loopback upstream', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MRV_APP_ORIGIN', undefined);
    expect(isAllowedRequestOrigin(request('https://cementmrv.traceforce.net'))).toBe(true);
  });

  it.each(['https://evil.example', 'http://cementmrv.traceforce.net', 'https://cementmrv.traceforce.net:444',
    'https://cementmrv.traceforce.net.evil.example', 'null', 'not-a-url', '',
    'https://user@cementmrv.traceforce.net', 'https://cementmrv.traceforce.net/path'])('rejects %s despite spoofed proxy headers', (origin) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MRV_APP_ORIGIN', undefined);
    expect(isAllowedRequestOrigin(request(origin, { host: 'evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }))).toBe(false);
  });

  it('uses an explicit installation origin instead of the production default', () => {
    vi.stubEnv('MRV_APP_ORIGIN', 'https://staging.example:8443');
    expect(isAllowedRequestOrigin(request('https://staging.example:8443'))).toBe(true);
    expect(isAllowedRequestOrigin(request('https://cementmrv.traceforce.net'))).toBe(false);
  });

  it.each(['*', '', 'null', 'https://example.com/path'])('fails closed for invalid configuration %s', (config) => {
    vi.stubEnv('MRV_APP_ORIGIN', config);
    expect(isAllowedRequestOrigin(request('https://cementmrv.traceforce.net'))).toBe(false);
  });

  it('preserves origin-less API clients and read requests', () => {
    expect(isAllowedRequestOrigin(request())).toBe(true);
    expect(isAllowedRequestOrigin(new Request('http://localhost/api/mrv/me'))).toBe(true);
  });

  it('supports local development without proxy trust', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MRV_APP_ORIGIN', undefined);
    expect(isAllowedRequestOrigin(request('http://127.0.0.1:3010'))).toBe(true);
    expect(isAllowedRequestOrigin(request('http://localhost:3010'))).toBe(false);
  });
});
