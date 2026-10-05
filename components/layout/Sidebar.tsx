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
  const { toggleSidebar, closeNav } = useStore();
  const { showExplanation } = useExplainer();

  useEffect(() => {
    closeNav();
  }, [pathname, closeNav]);

  return (
    <aside id="sidebar" role="navigation" aria-label="Main navigation">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="logo-icon" aria-hidden="true">
            <Icon name="factory" size={20} />
          </div>
          <div className="logo-text">
            <div className="brand">TRACE FORCE</div>
            <div className="sub">MRV · Cement QA/QC</div>
          </div>
        </div>
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
    </aside>
  );
}
