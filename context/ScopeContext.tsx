"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "@/context/StoreContext";
import { getBrowserSupabase } from "@/integrations/supabase/client";
import { ApiError, mrvFetch } from "@/lib/apiClient";
import { parseDate, rangeKey, resolveRange, todayIn, type RangeSpec, type ResolvedRange } from "@/lib/mrv/dateRanges";
import type { CalcResponse, FacilitySummary, ImportOutcome, MeResponse, RunMeta, RunView } from "@/lib/mrv/clientTypes";
import type { Coverage } from "@/lib/mrv/rangeSelection";
import type { MrvInput } from "@/lib/types";
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
  timezone: string;
  reporting_boundary: string;
  permissions: string[];
}

export class StaleScopeError extends Error {
  constructor(message = "Scope changed before the response arrived") {
    super(message);
  }
}

type Status = "loading" | "signed-out" | "no-organization" | "ready";

interface ScopeValue {
  status: Status;
  error: string | null;
  user: ScopeUser | null;
  memberships: ScopeMembership[];
  tenantId: string | null;
  tenantPermissions: string[];
  facilities: ScopeFacility[];
  facilityId: string | null;
  facility: ScopeFacility | null;
  summary: FacilitySummary | null;
  rangeSpec: RangeSpec | null;
  range: ResolvedRange | null;
  run: RunMeta | null;
  coverage: Coverage | null;
  runNote: string | null;
  calculating: boolean;
  canCalculate: boolean;
  canImport: boolean;
  active: ActiveScope;
  activeKey: string;
  selectTenant: (id: string) => void;
  selectFacility: (id: string) => void;
  selectRange: (spec: RangeSpec) => void;
  recalculate: () => void;
  importFile: (file: File, mapping?: string | null) => Promise<ImportOutcome | { accepted: false; errors: string[] }>;
  saveManual: (input: MrvInput, mapping?: string | null) => Promise<ImportOutcome>;
  loadDemo: () => Promise<ImportOutcome>;
  signOut: () => Promise<void>;
  reload: () => void;
  /** Fetch bound to the current scope generation; rejects with StaleScopeError if the user switched scope meanwhile. */
  scopedFetch: <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;
}

const ScopeContext = createContext<ScopeValue | null>(null);

function defaultRange(summary: FacilitySummary | null, timezone: string): RangeSpec {
  const latest = summary?.latestObservation ? parseDate(summary.latestObservation) : null;
  if (latest) return { preset: "quarter", year: latest.y, quarter: Math.ceil(latest.m / 3) };
  const t = parseDate(todayIn(timezone))!;
  return { preset: "month", year: t.y, month: t.m };
}

export function ScopeProvider({ children }: { children: ReactNode }) {
  const { clearStore, setStoreData, setLoading } = useStore();
  const guard = useRef(createScopeGuard());
  const abort = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<ScopeUser | null>(null);
  const [memberships, setMemberships] = useState<ScopeMembership[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantPermissions, setTenantPermissions] = useState<string[]>([]);
  const [facilities, setFacilities] = useState<ScopeFacility[]>([]);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [summary, setSummary] = useState<FacilitySummary | null>(null);
  const [rangeSpec, setRangeSpec] = useState<RangeSpec | null>(null);
  const [run, setRun] = useState<RunMeta | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [runNote, setRunNote] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const facility = facilities.find((f) => f.id === facilityId) ?? null;
  const range = useMemo(() => (rangeSpec && facility ? resolveRange(rangeSpec, { timezone: facility.timezone }) : null), [rangeSpec, facility]);
  const canCalculate = !!facility?.permissions.includes("calculation.run");
  const canImport = !!facility?.permissions.includes("upload.create");

  /** New scope generation: aborts in-flight requests and clears the previous factory/range's dataset immediately. */
  const beginSwitch = useCallback(() => {
    abort.current?.abort();
    abort.current = new AbortController();
    clearStore();
    setRun(null);
    setCoverage(null);
    setRunNote(null);
    return { token: guard.current.next(), signal: abort.current.signal };
  }, [clearStore]);

  const isCurrent = (token: number) => guard.current.isCurrent(token);

  const showView = useCallback(
    (view: RunView | null, cov: Coverage | null, note: string | null) => {
      if (view) {
        setStoreData(view.store);
        setRun(view.run);
        setCoverage(view.run.coverage);
      } else {
        clearStore();
        setRun(null);
        setCoverage(cov);
      }
      setRunNote(note);
    },
    [setStoreData, clearStore]
  );

  const handleError = useCallback((e: unknown, token: number) => {
    if (!guard.current.isCurrent(token) || (e instanceof DOMException && e.name === "AbortError")) return;
    if (e instanceof ApiError && e.status === 401) {
      setStatus("signed-out");
      setUser(null);
      return;
    }
    setError(e instanceof Error ? e.message : String(e));
  }, []);

  /** Opens a range: calculators get a (re-used or new) persisted run; read-only users get the latest stored run. */
  const openRange = useCallback(
    async (t: string, f: ScopeFacility, spec: RangeSpec, token: number, signal: AbortSignal) => {
      setCalculating(true);
      setLoading(true);
      try {
        const q = encodeURIComponent(JSON.stringify(spec));
        let calcUnavailable: string | null = null;
        if (f.permissions.includes("calculation.run")) {
          try {
            const res = await mrvFetch<CalcResponse>(`/orgs/${t}/facilities/${f.id}/runs`, { method: "POST", json: { range: spec }, signal });
            if (!isCurrent(token)) return;
            showView(res.view, res.coverage, res.note);
            return;
          } catch (e) {
            // A failed write must not prevent an independently authorized read of saved results.
            if (signal.aborted || !isCurrent(token) || (e instanceof ApiError && e.status === 401)) throw e;
            calcUnavailable = e instanceof Error ? e.message : String(e);
            setError(calcUnavailable);
          }
        }
        {
          const res = await mrvFetch<{ view: RunView | null }>(`/orgs/${t}/facilities/${f.id}/runs/latest?range=${q}`, { signal });
          if (!isCurrent(token)) return;
          const fallback = res.view ? null : "No stored calculation for this range. An MRV analyst or facility manager must calculate it.";
          showView(res.view, null, calcUnavailable ? `${calcUnavailable}${res.view ? " Showing the latest stored run." : ""}` : fallback);
        }
      } finally {
        if (isCurrent(token)) {
          setCalculating(false);
          setLoading(false);
        }
      }
    },
    [setLoading, showView]
  );

  const savePref = (t: string, f: string, spec: RangeSpec) => {
    void mrvFetch("/preference", { method: "PUT", json: { tenantId: t, facilityId: f, range: spec } }).catch(() => undefined);
  };

  const openFacility = useCallback(
    async (t: string, f: ScopeFacility, preferred: RangeSpec | null, token: number, signal: AbortSignal) => {
      const s = await mrvFetch<FacilitySummary>(`/orgs/${t}/facilities/${f.id}/summary`, { signal });
      if (!isCurrent(token)) return;
      setSummary(s);
      const spec = preferred ?? defaultRange(s, f.timezone);
      setRangeSpec(spec);
      savePref(t, f.id, spec);
      await openRange(t, f, spec, token, signal);
    },
    [openRange]
  );

  const openTenant = useCallback(
    async (t: string, token: number, signal: AbortSignal, preferred: { facilityId: string | null; range: RangeSpec | null }) => {
      const res = await mrvFetch<{ facilities: ScopeFacility[]; tenantPermissions: string[] }>(`/orgs/${t}/facilities`, { signal });
      if (!isCurrent(token)) return;
      setFacilities(res.facilities);
      setTenantPermissions(res.tenantPermissions);
      const f = res.facilities.find((x) => x.id === preferred.facilityId) ?? res.facilities.find((x) => x.permissions.includes("facility.read")) ?? null;
      setFacilityId(f?.id ?? null);
      if (f) await openFacility(t, f, f.id === preferred.facilityId ? preferred.range : null, token, signal);
    },
    [openFacility]
  );

  const resetTenantState = () => {
    setFacilities([]);
    setFacilityId(null);
    setTenantPermissions([]);
    setSummary(null);
    setRangeSpec(null);
  };

  // Startup: restore the last authorized organization, factory and range from the server-side preference.
  useEffect(() => {
    const { token, signal } = beginSwitch();
    setStatus("loading");
    setError(null);
    (async () => {
      try {
        const me = await mrvFetch<MeResponse>("/me", { signal });
        if (!isCurrent(token)) return;
        const email = me.user.email ?? "";
        setUser({ id: me.user.id, email, displayName: email || "Signed-in user", isPlatformAdmin: false });
        setMemberships(me.organizations);
        resetTenantState();
        if (!me.organizations.length) {
          setTenantId(null);
          setStatus("no-organization");
          return;
        }
        const pref = me.preference;
        const t = me.organizations.find((o) => o.tenantId === pref?.tenantId)?.tenantId ?? me.organizations[0].tenantId;
        setTenantId(t);
        setStatus("ready");
        await openTenant(t, token, signal, {
          facilityId: t === pref?.tenantId ? pref.facilityId : null,
          range: t === pref?.tenantId ? pref.range : null,
        });
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
  }, [reloadTick, beginSwitch, openTenant, handleError]);

  // Session changes in this or another tab (sign-in, sign-out, token refresh failure) restart the workspace.
  useEffect(() => {
    let unsubscribe = () => {};
    try {
      const { data } = getBrowserSupabase().auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") setReloadTick((n) => n + 1);
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    return unsubscribe;
  }, []);

  const selectTenant = useCallback(
    (id: string) => {
      if (!user || id === tenantId) return;
      const { token, signal } = beginSwitch();
      setTenantId(id);
      resetTenantState();
      setError(null);
      openTenant(id, token, signal, { facilityId: null, range: null }).catch((e) => handleError(e, token));
    },
    [user, tenantId, beginSwitch, openTenant, handleError]
  );

  const selectFacility = useCallback(
    (id: string) => {
      const f = facilities.find((x) => x.id === id);
      if (!tenantId || !f || id === facilityId) return;
      const { token, signal } = beginSwitch();
      setFacilityId(id);
      setSummary(null);
      setError(null);
      // Keep the selected range when switching factory (resolved in the new factory's timezone).
      openFacility(tenantId, f, rangeSpec, token, signal).catch((e) => handleError(e, token));
    },
    [facilities, tenantId, facilityId, rangeSpec, beginSwitch, openFacility, handleError]
  );

  const selectRange = useCallback(
    (spec: RangeSpec) => {
      if (!tenantId || !facility) return;
      const { token, signal } = beginSwitch();
      setRangeSpec(spec);
      setError(null);
      savePref(tenantId, facility.id, spec);
      openRange(tenantId, facility, spec, token, signal).catch((e) => handleError(e, token));
    },
    [tenantId, facility, beginSwitch, openRange, handleError]
  );

  const recalculate = useCallback(() => {
    if (!tenantId || !facility || !rangeSpec) return;
    const { token, signal } = beginSwitch();
    setError(null);
    openRange(tenantId, facility, rangeSpec, token, signal).catch((e) => handleError(e, token));
  }, [tenantId, facility, rangeSpec, beginSwitch, openRange, handleError]);

  /** After an import the workspace shows the imported period's persisted run (or keeps the current view on rejection). */
  const afterImport = useCallback(
    async (outcome: ImportOutcome, token: number) => {
      if (!isCurrent(token) || !tenantId || !facility) return;
      if (!outcome.accepted) return;
      const s = await mrvFetch<FacilitySummary>(`/orgs/${tenantId}/facilities/${facility.id}/summary`).catch(() => null);
      if (!isCurrent(token)) return;
      if (s) setSummary(s);
      if (outcome.run) {
        const r = outcome.run.run;
        const spec: RangeSpec = { preset: "custom", start: r.range_start, end: r.range_end };
        setRangeSpec(spec);
        savePref(tenantId, facility.id, spec);
        showView(outcome.run, null, outcome.runNote);
      } else if (outcome.runNote) setRunNote(outcome.runNote);
    },
    [tenantId, facility, showView]
  );

  const withImport = useCallback(
    async <T extends ImportOutcome>(fn: () => Promise<T>): Promise<T> => {
      if (!tenantId || !facility) throw new Error("Select an organization and factory first");
      // New generation without clearing the displayed dataset: in-flight range loads are cancelled so they cannot
      // overwrite the import result, and a rejected import leaves the current dataset untouched.
      abort.current?.abort();
      abort.current = new AbortController();
      const token = guard.current.next();
      const target = facility;
      setCalculating(false);
      setLoading(true);
      try {
        // The import request itself is never aborted by a scope switch: the server commits it to the factory in its URL,
        // so cancelling only the browser side would misreport a stored import as failed.
        const outcome = await fn();
        if (!isCurrent(token)) {
          throw new StaleScopeError(
            outcome.accepted
              ? `The import into ${target.code} · ${target.name} was stored (${outcome.status}). You switched to another factory or range meanwhile, so its result is not shown here — switch back to ${target.code} to view it.`
              : `The import into ${target.code} · ${target.name} was not stored. You switched to another factory or range meanwhile; the current view is unchanged.`
          );
        }
        await afterImport(outcome, token);
        return outcome;
      } finally {
        if (isCurrent(token)) setLoading(false);
      }
    },
    [tenantId, facility, afterImport, setLoading]
  );

  const importFile = useCallback(
    async (file: File, mapping?: string | null) => {
      if (!tenantId || !facility) return { accepted: false as const, errors: ["Sign in and select a factory before importing."] };
      if (!facility.permissions.includes("upload.create")) return { accepted: false as const, errors: ["You do not have permission to import data for this factory."] };
      const startToken = guard.current.current();
      const bytes = await file.arrayBuffer();
      // The factory or range changed while the file was being read: this closure still targets the previous factory.
      if (!guard.current.isCurrent(startToken)) {
        throw new StaleScopeError(`The upload into ${facility.code} · ${facility.name} was not sent because you switched factory or range first; nothing was imported.`);
      }
      const m = mapping ? `&mapping=${encodeURIComponent(mapping)}` : "";
      return withImport(() =>
        mrvFetch<ImportOutcome>(`/orgs/${tenantId}/facilities/${facility.id}/imports?filename=${encodeURIComponent(file.name)}${m}`, {
          method: "POST",
          body: bytes,
          headers: { "content-type": "application/octet-stream" },
        })
      );
    },
    [tenantId, facility, withImport]
  );

  const saveManual = useCallback(
    (input: MrvInput, mapping?: string | null) =>
      withImport(() =>
        mrvFetch<ImportOutcome>(`/orgs/${tenantId}/facilities/${facility?.id}/manual`, { method: "POST", json: mapping ? { input, mapping } : { input } })
      ),
    [tenantId, facility, withImport]
  );

  const loadDemo = useCallback(
    () => withImport(() => mrvFetch<ImportOutcome>(`/orgs/${tenantId}/facilities/${facility?.id}/demo`, { method: "POST" })),
    [tenantId, facility, withImport]
  );

  const signOut = useCallback(async () => {
    beginSwitch();
    await getBrowserSupabase().auth.signOut().catch(() => undefined);
    setReloadTick((n) => n + 1);
  }, [beginSwitch]);

  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  const scopedFetch = useCallback(async <T,>(path: string, init?: RequestInit & { json?: unknown }) => {
    const token = guard.current.current();
    const result = await mrvFetch<T>(path, { signal: abort.current?.signal, ...init });
    if (!guard.current.isCurrent(token)) throw new StaleScopeError();
    return result;
  }, []);

  const active = useMemo<ActiveScope>(
    () => (user ? { userId: user.id, tenantId, facilityId, periodId: range ? rangeKey(range) : null } : LOCAL_SCOPE),
    [user, tenantId, facilityId, range]
  );

  const value = useMemo<ScopeValue>(
    () => ({
      status, error, user, memberships, tenantId, tenantPermissions, facilities, facilityId, facility, summary, rangeSpec, range, run,
      coverage, runNote, calculating, canCalculate, canImport, active, activeKey: scopeId(active), selectTenant, selectFacility,
      selectRange, recalculate, importFile, saveManual, loadDemo, signOut, reload, scopedFetch,
    }),
    [status, error, user, memberships, tenantId, tenantPermissions, facilities, facilityId, facility, summary, rangeSpec, range, run,
      coverage, runNote, calculating, canCalculate, canImport, active, selectTenant, selectFacility, selectRange, recalculate,
      importFile, saveManual, loadDemo, signOut, reload, scopedFetch]
  );

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope() {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useScope must be used within ScopeProvider");
  return ctx;
}
