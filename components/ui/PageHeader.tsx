import type { ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";

export function PageHeader({
  icon,
  title,
  desc,
  actions,
}: {
  icon: string;
  title: string;
  desc?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-title-row">
        <div className="page-title-wrap">
          <Icon name={icon} size={20} className="page-title-icon" />
          <h2>{title}</h2>
        </div>
        {actions ? <div className="page-header-actions">{actions}</div> : null}
      </div>
      {desc ? <div className="page-desc">{desc}</div> : null}
    </div>
  );
}

export function SectionHeader({
  icon,
  title,
  actions,
}: {
  icon?: string;
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="section-card-header">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon ? <Icon name={icon} size={15} className="text-muted" /> : null}
        <h3 style={{ margin: 0 }}>{title}</h3>
      </div>
      {actions}
    </div>
  );
}
