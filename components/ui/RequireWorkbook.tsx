"use client";

import type { ReactNode } from "react";
import { useStore } from "@/context/StoreContext";
import { EmptyState, ErrorBanner, LoadingState } from "./EmptyState";
import { Icon } from "@/components/icons/Icon";

export function RequireWorkbook({ title, children }: { title: string; children: (store: NonNullable<ReturnType<typeof useStore>["store"]>) => ReactNode }) {
  const { store, loading } = useStore();

  if (loading) return <LoadingState />;
  if (!store || !store._valid) {
    if (store && store._errors.length > 0) {
      return (
        <>
          <ErrorBanner title="We couldn't read this workbook" errors={store._errors} />
          <div className="state-box">
            <div className="state-icon" style={{ color: "var(--accent)" }}>
              <Icon name="upload" size={40} />
            </div>
            <div className="state-title">Try a different file</div>
            <div className="state-sub">Upload a valid V28 workbook to get started</div>
            <label className="btn btn-primary" htmlFor="file-input" style={{ cursor: "pointer", marginTop: 8 }}>
              <Icon name="upload" size={14} /> Choose Workbook
            </label>
          </div>
        </>
      );
    }
    return <EmptyState title={title} />;
  }

  return (
    <>
      {store._errors.length > 0 ? (
        <ErrorBanner title="A few fields need attention — data may be incomplete" errors={store._errors} />
      ) : null}
      {children(store)}
    </>
  );
}
