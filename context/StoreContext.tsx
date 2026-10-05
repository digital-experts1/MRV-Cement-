"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { parseWorkbook } from "@/lib/parser";
import type { Store } from "@/lib/types";

const MOBILE_NAV_QUERY = "(max-width: 1024px)";

interface StoreContextValue {
  store: Store | null;
  loading: boolean;
  parseError: string | null;
  collapsed: boolean;
  navOpen: boolean;
  toggleSidebar: () => void;
  closeNav: () => void;
  handleFile: (file: File) => void;
  setStoreData: (store: Store) => void;
  clearStore: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
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

  const handleFile = useCallback((file: File) => {
    setLoading(true);
    setParseError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = e.target?.result;
        if (!(result instanceof ArrayBuffer)) {
          setParseError("Could not read the selected file.");
          setLoading(false);
          return;
        }
        const next = parseWorkbook(result, file.name);
        setStore(next);
        if (!next._valid && next._errors.length > 0) {
          setParseError(next._errors.join("\n"));
        }
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Failed to parse workbook");
      } finally {
        setLoading(false);
      }
    };
    reader.onerror = () => {
      setParseError("Failed to read the selected file.");
      setLoading(false);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const value = useMemo(
    () => ({ store, loading, parseError, collapsed, navOpen, toggleSidebar, closeNav, handleFile, setStoreData, clearStore }),
    [store, loading, parseError, collapsed, navOpen, toggleSidebar, closeNav, handleFile, setStoreData, clearStore]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
