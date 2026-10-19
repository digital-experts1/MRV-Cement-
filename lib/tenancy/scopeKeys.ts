/**
 * Every client-side cache entry and browser draft is keyed by the full active scope, so data saved under one
 * organization/factory/period can never be read back under another.
 */
export interface ActiveScope {
  userId: string | null;
  tenantId: string | null;
  facilityId: string | null;
  periodId: string | null;
}

export const LOCAL_SCOPE: ActiveScope = { userId: null, tenantId: null, facilityId: null, periodId: null };

export function scopeId(scope: ActiveScope): string {
  return [scope.userId ?? "anon", scope.tenantId ?? "local", scope.facilityId ?? "-", scope.periodId ?? "-"].join(":");
}

export function scopedCacheKey(scope: ActiveScope, ...parts: string[]): string {
  return ["trace", scopeId(scope), ...parts].join("|");
}

export function scopedDraftKey(scope: ActiveScope): string {
  return scopedCacheKey(scope, "dataentry-draft-v3");
}

/**
 * Guards against late responses: each scope switch starts a new generation; responses tagged with an older
 * generation are discarded by the caller.
 */
export function createScopeGuard() {
  let generation = 0;
  return {
    next(): number {
      generation += 1;
      return generation;
    },
    current(): number {
      return generation;
    },
    isCurrent(token: number): boolean {
      return token === generation;
    },
  };
}
