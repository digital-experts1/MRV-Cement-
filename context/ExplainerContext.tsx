"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getExplanation, type Explanation } from "@/lib/explanations";

interface ExplainerContextValue {
  explanation: Explanation | null;
  showExplanation: (keyOrData: string | Explanation) => void;
  closeExplanation: () => void;
}

const ExplainerContext = createContext<ExplainerContextValue | null>(null);

export function ExplainerProvider({ children }: { children: ReactNode }) {
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [visible, setVisible] = useState(false);

  const showExplanation = useCallback((keyOrData: string | Explanation) => {
    const info = typeof keyOrData === "string" ? getExplanation(keyOrData) : keyOrData;
    setExplanation(info);
    setVisible(true);
  }, []);

  const closeExplanation = useCallback(() => {
    setVisible(false);
    setTimeout(() => setExplanation(null), 180);
  }, []);

  useEffect(() => {
    if (!explanation) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeExplanation();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [explanation, closeExplanation]);

  const value = useMemo(
    () => ({ explanation: visible ? explanation : explanation, showExplanation, closeExplanation }),
    [explanation, visible, showExplanation, closeExplanation]
  );

  return (
    <ExplainerContext.Provider value={value}>
      {children}
    </ExplainerContext.Provider>
  );
}

export function useExplainer() {
  const ctx = useContext(ExplainerContext);
  if (!ctx) throw new Error("useExplainer must be used within ExplainerProvider");
  return ctx;
}
