"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "@/context/StoreContext";
import { ApiError, apiFetch } from "@/lib/apiClient";
import { createScopeGuard, LOCAL_SCOPE, scopeId, type ActiveScope } from "@/lib/tenancy/scopeKeys";

export interface ScopeUser {
  id: string;
  email: string;
  displayName: string;
  isPlatformAdmin: boolean;
}
export interface ScopeMembership {
  tenantId: string;
  name: string;
  synthetic: boolean;
}
export interface ScopeFacility {
  id: string;
  code: string;
  name: string;
  reporting_boundary: string;
  permissions: string[];
}
export interface ScopePeriod {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  status: string;
}

export class StaleScopeError extends Error {
  constructor() {
    super("Scope changed before the response arrived");
  }
}

interface ScopeValue {
  status: "loading" | "signed-out" | "ready";
  error: string | null;
  user: ScopeUser | null;
  memberships: ScopeMembership[];
  tenantId: string | null;
  tenantPermissions: string[];
  facilities: ScopeFacility[];
  facilityId: string | null;
  periods: ScopePeriod[];
  periodId: string | null;
  active: ActiveScope;
  activeKey: string;
  selectTenant: (id: string) => void;
  selectFacility: (id: string) => void;
  selectPeriod: (id: string) => void;
  signOut: () => Promise<void>;
  reload: () => void;
  /** Fetch bound to the current scope; rejects with StaleScopeError if the user switched scope meanwhile. */
  scopedFetch: <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;
}

const ScopeContext = createContext<ScopeValue | null>(null);
const selectionKey = (userId: string) => `trace|scope-selection|${userId}`;

export function ScopeProvider({ children }: { children: ReactNode }) {
  const { clearStore } = useStore();
  const guard = useRef(createScopeGuard());
  const abort = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<ScopeValue["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<ScopeUser | null>(null);
  const [memberships, setMemberships] = useState<ScopeMembership[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantPermissions, setTenantPermissions] = useState<string[]>([]);
  const [facilities, setFacilities] = useState<ScopeFacility[]>([]);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [periods, setPeriods] = useState<ScopePeriod[]>([]);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  /** Starts a new scope generation: aborts in-flight requests and clears the previous factory's dataset. */
  const beginSwitch = useCallback(() => {
    abort.current?.abort();
    abort.current = new AbortController();
    clearStore();
    return { token: guard.current.next(), signal: abort.current.signal };
  }, [clearStore]);

  const remember = useCallback((u: ScopeUser | null, sel: { tenantId: string | null; facilityId: string | null; periodId: string | null }) => {
    if (u) sessionStorage.setItem(selectionKey(u.id), JSON.stringify(sel));
  }, []);

  const loadPeriods = useCallback(
    async (u: ScopeUser, t: string, f: string, token: number, signal: AbortSignal, preferred: string | null) => {
      const list = await apiFetch<ScopePeriod[]>(`/tenants/${t}/facilities/${f}/periods`, { signal });
      if (!guard.current.isCurrent(token)) return;
      setPeriods(list);
      const p = list.find((x) => x.id === preferred)?.id ?? list[0]?.id ?? null;
      setPeriodId(p);
      remember(u, { tenantId: t, facilityId: f, periodId: p });
    },
    [remember]
  );

  const loadTenant = useCallback(
    async (u: ScopeUser, t: string, token: number, signal: AbortSignal, preferred: { facilityId: string | null; periodId: string | null }) => {
      const res = await apiFetch<{ facilities: ScopeFacility[]; tenantPermissions: string[] }>(`/tenants/${t}/facilities`, { signal });
      if (!guard.current.isCurrent(token)) return;
      setFacilities(res.facilities);
      setTenantPermissions(res.tenantPermissions);
      const f = res.facilities.find((x) => x.id === preferred.facilityId)?.id ?? res.facilities[0]?.id ?? null;
      setFacilityId(f);
      if (f) await loadPeriods(u, t, f, token, signal, preferred.periodId);
      else remember(u, { tenantId: t, facilityId: null, periodId: null });
    },
    [loadPeriods, remember]
  );

  const resetTenantState = () => {
    setFacilities([]);
    setFacilityId(null);
    setPeriods([]);
    setPeriodId(null);
    setTenantPermissions([]);
  };

  const handleError = useCallback((e: unknown, token: number) => {
    if (!guard.current.isCurrent(token) || (e instanceof DOMException && e.name === "AbortError")) return;
    if (e instanceof ApiError && e.status === 401) {
      setStatus("signed-out");
      setUser(null);
      return;
    }
    setError(e instanceof Error ? e.message : String(e));
  }, []);

  useEffect(() => {
    const { token, signal } = beginSwitch();
    setStatus("loading");
    setError(null);
    (async () => {
      try {
        const me = await apiFetch<{ user: ScopeUser; memberships: ScopeMembership[] }>("/me", { signal });
        if (!guard.current.isCurrent(token)) return;
        setUser(me.user);
        setMemberships(me.memberships);
        resetTenantState();
        let saved: { tenantId?: string; facilityId?: string; periodId?: string } = {};
        try {
          saved = JSON.parse(sessionStorage.getItem(selectionKey(me.user.id)) ?? "{}");
        } catch {
          /* ignore */
        }
        const t = me.memberships.find((m) => m.tenantId === saved.tenantId)?.tenantId ?? me.memberships[0]?.tenantId ?? null;
        setTenantId(t);
        setStatus("ready");
        if (t) await loadTenant(me.user, t, token, signal, { facilityId: saved.facilityId ?? null, periodId: saved.periodId ?? null });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setUser(null);
          setMemberships([]);
          setTenantId(null);
          resetTenantState();
          setStatus("signed-out");
        } else handleError(e, token);
      }
    })();
  }, [reloadTick, beginSwitch, loadTenant, handleError]);

  const selectTenant = useCallback(
    (id: string) => {
      if (!user || id === tenantId) return;
      const { token, signal } = beginSwitch();
      setTenantId(id);
      resetTenantState();
      setError(null);
      loadTenant(user, id, token, signal, { facilityId: null, periodId: null }).catch((e) => handleError(e, token));
    },
    [user, tenantId, beginSwitch, loadTenant, handleError]
  );

  const selectFacility = useCallback(
    (id: string) => {
      if (!user || !tenantId || id === facilityId) return;
      const { token, signal } = beginSwitch();
      setFacilityId(id);
      setPeriods([]);
      setPeriodId(null);
      setError(null);
      loadPeriods(user, tenantId, id, token, signal, null).catch((e) => handleError(e, token));
    },
    [user, tenantId, facilityId, beginSwitch, loadPeriods, handleError]
  );

  const selectPeriod = useCallback(
    (id: string) => {
      if (id === periodId) return;
      beginSwitch();
      setPeriodId(id);
      remember(user, { tenantId, facilityId, periodId: id });
    },
    [periodId, beginSwitch, remember, user, tenantId, facilityId]
  );

  const signOut = useCallback(async () => {
    beginSwitch();
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
    setReloadTick((n) => n + 1);
  }, [beginSwitch]);

  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  const scopedFetch = useCallback(async <T,>(path: string, init?: RequestInit & { json?: unknown }) => {
    const token = guard.current.current();
    const result = await apiFetch<T>(path, { signal: abort.current?.signal, ...init });
    if (!guard.current.isCurrent(token)) throw new StaleScopeError();
    return result;
  }, []);

  const active = useMemo<ActiveScope>(
    () => (user ? { userId: user.id, tenantId, facilityId, periodId } : LOCAL_SCOPE),
    [user, tenantId, facilityId, periodId]
  );

  const value = useMemo<ScopeValue>(
    () => ({
      status, error, user, memberships, tenantId, tenantPermissions, facilities, facilityId, periods, periodId,
      active, activeKey: scopeId(active), selectTenant, selectFacility, selectPeriod, signOut, reload, scopedFetch,
    }),
    [status, error, user, memberships, tenantId, tenantPermissions, facilities, facilityId, periods, periodId, active, selectTenant, selectFacility, selectPeriod, signOut, reload, scopedFetch]
  );

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope() {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useScope must be used within ScopeProvider");
  return ctx;
}
