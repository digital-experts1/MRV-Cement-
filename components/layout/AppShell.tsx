"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AuthLayout } from "./AuthLayout";
import { StaleScopeError, useScope } from "@/context/ScopeContext";
import { useStore } from "@/context/StoreContext";
import { ExplainerModal } from "@/components/ui/ExplainerModal";
import { UploadPrompt } from "@/components/ui/UploadPrompt";
import { DatasetBanner } from "@/components/ui/DatasetBanner";
import { importFailureFrom, rejectedImport, scopeChangedDuringImport } from "@/lib/mrv/importFailure";
import { Footer } from "./Footer";
import { ScopeBar } from "./ScopeBar";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { collapsed, navOpen, closeNav, openUpload, setParseError } = useStore();
  const { importFile } = useScope();

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeNav();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen, closeNav]);

  const shellClass = [collapsed ? "collapsed" : "", navOpen ? "nav-open" : ""].filter(Boolean).join(" ");

  if (pathname === "/signin" || pathname === "/signup" || pathname === "/reset-password") {
    return <AuthLayout>{children}</AuthLayout>;
  }

  return (
    <div
      id="app-shell"
      className={shellClass || undefined}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file && /\.(xlsx|xlsm|json)$/i.test(file.name)) {
          importFile(file)
            .then((outcome) => {
              if (!outcome.accepted) {
                setParseError(rejectedImport(outcome.errors));
                openUpload();
              }
            })
            .catch((e) => {
              setParseError(e instanceof StaleScopeError ? scopeChangedDuringImport(e.message) : importFailureFrom(e));
              openUpload();
            });
        }
      }}
    >
      <Sidebar />
      <button type="button" className="sidebar-backdrop" aria-label="Close navigation" tabIndex={navOpen ? 0 : -1} onClick={closeNav} />
      <Topbar />
      <main id="content" role="main" aria-live="polite">
        <ScopeBar />
        <DatasetBanner />
        {children}
      </main>
      <Footer />
      <UploadPrompt />
      <ExplainerModal />
    </div>
  );
}
