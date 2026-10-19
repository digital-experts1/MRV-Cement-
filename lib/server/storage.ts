/**
 * Private object storage boundary. Keys are always generated server-side from the authorized scope
 * (`tenants/<tenant>/facilities/<facility>/<kind>/<id>`); callers never supply a storage key.
 * Development uses an in-memory store; production must plug in a private bucket (no public URLs).
 */
export interface ObjectStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

export function storageKey(tenantId: string, facilityId: string, kind: "evidence" | "uploads", id: string): string {
  return `tenants/${tenantId}/facilities/${facilityId}/${kind}/${id}`;
}

export function createMemoryStore(): ObjectStore {
  const objects = new Map<string, Uint8Array>();
  return {
    async put(key, bytes) {
      objects.set(key, bytes);
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
  };
}
