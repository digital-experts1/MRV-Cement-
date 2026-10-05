import type { ReactNode } from "react";

export function Badge({
  kind = "info",
  children,
  onClick,
}: {
  kind?: "pass" | "warn" | "fail" | "missing" | "info" | "accent" | "purple";
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <span className={`badge badge-${kind}`} onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
      {children}
    </span>
  );
}

export function QaDot({ status }: { status?: string | null }) {
  const s = String(status || "").toUpperCase();
  const cls = s === "PASS" ? "qa-dot-pass" : s === "FAIL" ? "qa-dot-fail" : "qa-dot-warn";
  return <span className={`qa-dot ${cls}`} />;
}

export function QaBadge({ status }: { status?: unknown }) {
  if (!status) return <span className="badge badge-missing">—</span>;
  const s = String(status).toUpperCase();
  if (s === "PASS") {
    return (
      <span className="badge badge-pass">
        <span className="qa-dot qa-dot-pass" /> Pass
      </span>
    );
  }
  if (s === "FAIL") {
    return (
      <span className="badge badge-fail">
        <span className="qa-dot qa-dot-fail" /> Fail
      </span>
    );
  }
  return (
    <span className="badge badge-warn">
      <span className="qa-dot qa-dot-warn" /> {String(status)}
    </span>
  );
}

export function MappedBadge({ mapped }: { mapped: boolean }) {
  return mapped ? (
    <span className="badge badge-pass">
      <span className="qa-dot qa-dot-pass" /> Mapped
    </span>
  ) : (
    <span className="badge badge-warn">
      <span className="qa-dot qa-dot-warn" /> Pending
    </span>
  );
}

export function MissingBadge({ label = "Missing" }: { label?: string }) {
  return <span className="badge badge-missing">{label}</span>;
}
