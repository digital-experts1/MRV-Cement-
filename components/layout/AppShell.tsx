"use client";

import { useEffect, type ReactNode } from "react";
import { useStore } from "@/context/StoreContext";
import { ExplainerModal } from "@/components/ui/ExplainerModal";
import { UploadPrompt } from "@/components/ui/UploadPrompt";
import { Footer } from "./Footer";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({ children }: { children: ReactNode }) {
  const { collapsed, navOpen, closeNav, handleFile } = useStore();

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeNav();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen, closeNav]);

  const shellClass = [collapsed ? "collapsed" : "", navOpen ? "nav-open" : ""].filter(Boolean).join(" ");

  return (
    <div
      id="app-shell"
      className={shellClass || undefined}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file && (file.name.endsWith(".xlsx") || file.name.endsWith(".xlsm"))) {
          handleFile(file);
        }
      }}
    >
      <Sidebar />
      <button type="button" className="sidebar-backdrop" aria-label="Close navigation" tabIndex={navOpen ? 0 : -1} onClick={closeNav} />
      <Topbar />
      <main id="content" role="main" aria-live="polite">
        {children}
      </main>
      <Footer />
      <UploadPrompt />
      <ExplainerModal />
    </div>
  );
}
