"use client";

import type { ReactNode } from "react";
import { ExplainerProvider } from "@/context/ExplainerContext";
import { ScopeProvider } from "@/context/ScopeContext";
import { StoreProvider } from "@/context/StoreContext";
import { AppShell } from "@/components/layout/AppShell";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      <ScopeProvider>
        <ExplainerProvider>
          <AppShell>{children}</AppShell>
        </ExplainerProvider>
      </ScopeProvider>
    </StoreProvider>
  );
}
