"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { parseDataPackage } from "@/lib/dataPackage";
import { resolveImport } from "@/lib/importResolution";
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
      const isJson = /\.json$/i.test(file.name);
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const result = e.target?.result;
          let next: Store;
          if (isJson && typeof result === "string") next = parseDataPackage(result, file.name);
          else if (!isJson && result instanceof ArrayBuffer) next = parseWorkbook(result, file.name);
          else {
            fail(["Could not read the selected file."]);
            return;
          }
          // A failed import never replaces or clears the active dataset.
          setStore((prev) => resolveImport(prev, next).active);
          if (next._valid) resolve([]);
          else fail(resolveImport(null, next).errors);
        } catch (err) {
          fail([err instanceof Error ? err.message : "Failed to parse file"]);
        } finally {
          setLoading(false);
        }
      };
      reader.onerror = () => {
        setLoading(false);
        fail(["Failed to read the selected file."]);
      };
      if (isJson) reader.readAsText(file);
      else reader.readAsArrayBuffer(file);
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
