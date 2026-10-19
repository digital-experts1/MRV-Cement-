/** Browser client for /api/v1. Authorization is decided server-side; the client only renders what it is given. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export function apiFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  return request<T>(`/api/v1${path}`, init);
}

/** Supabase-backed MRV API. */
export function mrvFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  return request<T>(`/api/mrv${path}`, init);
}

async function request<T>(url: string, init: RequestInit & { json?: unknown }): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return data as T;
}
