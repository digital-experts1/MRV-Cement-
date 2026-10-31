"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { useExplainer } from "@/context/ExplainerContext";
import { useStore } from "@/context/StoreContext";
import { NAV_SECTIONS, ROUTES } from "@/lib/routes";

export function Sidebar() {
  const pathname = usePathname();
  const { toggleSidebar, closeNav, openUpload } = useStore();
  const { showExplanation } = useExplainer();

  useEffect(() => {
    closeNav();
  }, [pathname, closeNav]);

  return (
    <aside id="sidebar" role="navigation" aria-label="Main navigation">
      <div className="sidebar-header">
        <Link href="/overview" className="egytrace-sidebar-brand" aria-label="EgyTrace Systems — Overview">
          <svg className="egytrace-logo-full" viewBox="240 304 1000 360" role="img" aria-label="EgyTrace Systems — Measure, Report, Verify">
            <image href="/images/egytrace-logo-white.png" width="1536" height="1024" />
          </svg>
          <svg className="egytrace-logo-compact" viewBox="240 304 320 360" role="img" aria-label="EgyTrace Systems">
            <image href="/images/egytrace-logo-white.png" width="1536" height="1024" />
          </svg>
        </Link>
        <button className="sidebar-toggle" onClick={toggleSidebar} title="Collapse sidebar" aria-label="Toggle sidebar" type="button">
          <Icon name="chevron-left" size={14} />
        </button>
      </div>
      <nav className="sidebar-nav" id="sidebar-nav" role="list">
        {NAV_SECTIONS.map((sec) => (
          <div key={sec.label}>
            <div className="nav-section-label">{sec.label}</div>
            {sec.keys.map((key) => {
              const r = ROUTES[key];
              const active = pathname === r.href || (pathname === "/" && key === "overview");
              return (
                <Link key={key} href={r.href} className={`nav-item${active ? " active" : ""}`} id={`nav-${key}`} title={r.label}>
                  <span className="nav-icon">
                    <Icon name={r.icon} size={16} />
                  </span>
                  <span className="nav-label">{r.label}</span>
                  <button
                    className="nav-info-btn"
                    type="button"
                    aria-label={`What is ${r.label}?`}
                    title="About this section"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      showExplanation(`nav-${key}`);
                    }}
                  >
                    <Icon name="info" size={11} />
                  </button>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-upload-btn"
          id="sidebar-upload-btn"
          onClick={openUpload}
          aria-label="Upload Readings File"
          aria-haspopup="dialog"
          title="Upload Readings File"
        >
          <Icon name="upload" size={16} />
          <span className="sidebar-upload-label">Upload Readings File</span>
        </button>
      </div>
    </aside>
  );
}
