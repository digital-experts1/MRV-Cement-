import { statusChipClass } from "@/lib/formatter";

export function Chip({ status }: { status?: unknown }) {
  if (!status) return null;
  const s = String(status);
  return <span className={`chip ${statusChipClass(s)}`}>{s}</span>;
}

export function SeverityBadge({ severity }: { severity?: unknown }) {
  if (!severity) return null;
  const s = String(severity);
  if (s === "Fail") return <span className="chip chip-fail">Fail</span>;
  if (s === "Warning") return <span className="chip chip-warn">Warning</span>;
  return <span className="chip">{s}</span>;
}
