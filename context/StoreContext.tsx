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
  /** Resolves with the import errors; an empty array means the workbook loaded successfully. */
  handleFile: (file: File) => Promise<string[]>;
  setStoreData: (store: Store) => void;
  clearStore: () => void;
  uploadOpen: boolean;
  openUpload: () => void;
  closeUpload: () => void;
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

  const [uploadOpen, setUploadOpen] = useState(false);
  const openUpload = useCallback(() => setUploadOpen(true), []);
  const closeUpload = useCallback(() => {
    setUploadOpen(false);
    setParseError(null);
  }, []);

  const handleFile = useCallback((file: File) => {
    setLoading(true);
    setParseError(null);
    return new Promise<string[]>((resolve) => {
      const fail = (errors: string[]) => {
        setParseError(errors.join("\n"));
        resolve(errors);
      };
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const result = e.target?.result;
          if (!(result instanceof ArrayBuffer)) {
            fail(["Could not read the selected file."]);
            return;
          }
          const next = parseWorkbook(result, file.name);
          // Never replace a valid loaded dataset with a failed import.
          setStore((prev) => (next._valid || !prev?._valid ? next : prev));
          if (next._valid) {
            resolve([]);
          } else {
            fail(next._errors.length > 0 ? next._errors : ["The workbook could not be validated."]);
          }
        } catch (err) {
          fail([err instanceof Error ? err.message : "Failed to parse workbook"]);
        } finally {
          setLoading(false);
        }
      };
      reader.onerror = () => {
        setLoading(false);
        fail(["Failed to read the selected file."]);
      };
      reader.readAsArrayBuffer(file);
    });
  }, []);

  const value = useMemo(
    () => ({
      store,
      loading,
      parseError,
      collapsed,
      navOpen,
      toggleSidebar,
      closeNav,
      handleFile,
      setStoreData,
      clearStore,
      uploadOpen,
      openUpload,
      closeUpload,
    }),
    [store, loading, parseError, collapsed, navOpen, toggleSidebar, closeNav, handleFile, setStoreData, clearStore, uploadOpen, openUpload, closeUpload]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
