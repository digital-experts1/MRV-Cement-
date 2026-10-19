import { dispatch } from "@/lib/server/api/router";
import { createSyntheticDeps } from "@/lib/server/bootstrap";
import type { SeedOutput, SeedUserKey } from "@/lib/server/db/syntheticSeed";
import { seedPrincipal } from "@/lib/server/db/syntheticSeed";
import type { Caller, ServerDeps } from "@/lib/server/deps";
import { issueSession, SESSION_COOKIE } from "@/lib/server/session";

export interface ApiResult {
  status: number;
  json: unknown;
  text: string;
}

export interface Check {
  label: string;
  pass: boolean;
  detail?: string;
}

export interface IsolationEnv {
  deps: ServerDeps;
  seed: SeedOutput;
  caller(user: SeedUserKey): Caller;
  /** Raw HTTP-level call through the same dispatcher used by the Next.js route. No UI involved. */
  api(user: SeedUserKey | null, method: string, path: string, body?: unknown, extra?: { cookie?: string; headers?: Record<string, string>; raw?: Uint8Array }): Promise<ApiResult>;
}

export async function createIsolationEnv(): Promise<IsolationEnv> {
  const { deps, seed } = await createSyntheticDeps();
  const sessions = new Map<SeedUserKey, string>();
  const cookieFor = async (user: SeedUserKey) => {
    if (!sessions.has(user)) sessions.set(user, await issueSession(deps.db, seedPrincipal(user).userId));
    return `${SESSION_COOKIE}=${encodeURIComponent(sessions.get(user)!)}`;
  };
  const api: IsolationEnv["api"] = async (user, method, path, body, extra = {}) => {
    const [pathname] = path.split("?");
    const headers: Record<string, string> = { ...extra.headers };
    const cookie = extra.cookie ?? (user ? await cookieFor(user) : undefined);
    if (cookie) headers.cookie = cookie;
    let payload: BodyInit | undefined;
    if (extra.raw) payload = new Blob([extra.raw as Uint8Array<ArrayBuffer>]);
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["content-type"] = "application/json";
    }
    const res = await dispatch(deps, new Request(`http://trace.test/api/v1${path}`, { method, headers, body: payload }), pathname);
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON (downloads) */
    }
    return { status: res.status, json, text };
  };
  return {
    deps,
    seed,
    caller: (user) => ({ deps, principal: seedPrincipal(user) }),
    api,
  };
}
