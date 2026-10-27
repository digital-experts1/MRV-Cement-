"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ImportFailure } from "@/lib/mrv/importFailure";
import type { Store } from "@/lib/types";

const MOBILE_NAV_QUERY = "(max-width: 1024px)";

/**
 * Active dataset cache and shell UI state. The dataset itself is always a server-calculated, persisted run loaded by
 * the workspace (ScopeContext); this context only holds what is currently displayed.
 */
interface StoreContextValue {
  store: Store | null;
  loading: boolean;
  parseError: ImportFailure | null;
  collapsed: boolean;
  navOpen: boolean;
  toggleSidebar: () => void;
  closeNav: () => void;
  setStoreData: (store: Store) => void;
  clearStore: () => void;
  setLoading: (loading: boolean) => void;
  setParseError: (error: ImportFailure | null) => void;
  uploadOpen: boolean;
  openUpload: () => void;
  closeUpload: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(false);
  const [parseError, setParseError] = useState<ImportFailure | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const closeNav = useCallback(() => setNavOpen(false), []);

  const toggleSidebar = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia(MOBILE_NAV_QUERY).matches) {
      setNavOpen((v) => !v);
      return;
    }
    setCollapsed((v) => !v);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_NAV_QUERY);
    const onChange = () => {
      if (!mq.matches) setNavOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setStoreData = useCallback((nextStore: Store) => {
    setStore(nextStore);
    setParseError(null);
  }, []);

  const clearStore = useCallback(() => {
    setStore(null);
    setParseError(null);
  }, []);

  const [uploadOpen, setUploadOpen] = useState(false);
  const openUpload = useCallback(() => setUploadOpen(true), []);
  const closeUpload = useCallback(() => {
    setUploadOpen(false);
    setParseError(null);
  }, []);

  const value = useMemo(
    () => ({
      store, loading, parseError, collapsed, navOpen, toggleSidebar, closeNav, setStoreData, clearStore, setLoading, setParseError,
      uploadOpen, openUpload, closeUpload,
    }),
    [store, loading, parseError, collapsed, navOpen, toggleSidebar, closeNav, setStoreData, clearStore, uploadOpen, openUpload, closeUpload]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
