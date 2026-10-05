"use client";

import type { ReactNode } from "react";
import { ExplainerProvider } from "@/context/ExplainerContext";
import { StoreProvider } from "@/context/StoreContext";
import { AppShell } from "@/components/layout/AppShell";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      <ExplainerProvider>
        <AppShell>{children}</AppShell>
      </ExplainerProvider>
    </StoreProvider>
  );
}
