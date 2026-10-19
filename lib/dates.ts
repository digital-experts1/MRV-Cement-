const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Normalizes a date to "YYYY-MM-DD" without timezone shifts.
 * Accepts Excel serial numbers, ISO strings and Date objects. Ambiguous text such as "1/2/2025" returns null.
 */
export function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 1) return null;
    const d = new Date(EXCEL_EPOCH_MS + Math.floor(value) * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (typeof value === "string") {
    const m = ISO_DATE.exec(value.trim());
    if (!m) return null;
    const [, y, mo, d] = m;
    const check = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    if (check.getUTCMonth() !== Number(mo) - 1 || check.getUTCDate() !== Number(d)) return null;
    return `${y}-${mo}-${d}`;
  }
  return null;
}
