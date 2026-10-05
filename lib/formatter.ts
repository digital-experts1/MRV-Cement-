import * as XLSX from "xlsx";

export function escHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fmtInt(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

export function fmtDec(n: number, dp: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(n);
}

export function fmtRaw(val: unknown, decimals = 0): string | null {
  if (val === null || val === undefined || val === "") return null;
  const n = parseFloat(String(val));
  if (Number.isNaN(n)) return null;
  return decimals === 0 ? fmtInt(n) : fmtDec(n, decimals);
}

export function isMissing(val: unknown): boolean {
  return (
    val === null ||
    val === undefined ||
    val === "" ||
    val === "Missing" ||
    (typeof val === "string" && (val.startsWith("#") || val === "N/A"))
  );
}

export function fmtNumber(val: unknown, unitType?: string): string {
  const n = parseFloat(String(val));
  switch (unitType) {
    case "t":
    case "GJ":
    case "MWh":
      return Number.isNaN(n) ? String(val) : fmtInt(n);
    case "tCO2":
    case "%":
      return Number.isNaN(n) ? String(val) : fmtDec(n, 2);
    case "TJ":
    case "GJ/t clinker":
      return Number.isNaN(n) ? String(val) : fmtDec(n, 3);
    case "ratio":
      return Number.isNaN(n) ? String(val) : fmtDec(n, 3);
    case "tCO2/t clinker":
    case "tCO2/t cement":
    case "tCO2/MWh":
    case "tCO2/TJ":
      return Number.isNaN(n) ? String(val) : fmtDec(n, 4);
    case "status":
    case "text":
    case "date":
      return String(val);
    default:
      if (!Number.isNaN(n)) {
        return Number.isInteger(n) ? fmtInt(n) : fmtDec(n, 3);
      }
      return String(val);
  }
}

export function fmtDate(val: unknown): string {
  if (!val) return "—";
  let d: Date;
  if (val instanceof Date) {
    d = val;
  } else if (typeof val === "number") {
    const parsed = XLSX.SSF.parse_date_code(val);
    if (!parsed) return String(val);
    d = new Date(parsed.y, parsed.m - 1, parsed.d);
  } else {
    d = new Date(String(val));
  }
  if (Number.isNaN(d.getTime())) return String(val);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function fmtDateFull(val: unknown): string {
  if (!val) return "—";
  let d: Date;
  if (val instanceof Date) {
    d = val;
  } else if (typeof val === "number") {
    const parsed = XLSX.SSF.parse_date_code(val);
    if (!parsed) return String(val);
    d = new Date(parsed.y, parsed.m - 1, parsed.d);
  } else {
    d = new Date(String(val));
  }
  if (Number.isNaN(d.getTime())) return String(val);
  return d.toISOString().split("T")[0];
}

export function fmtShort(n: unknown): string {
  if (n === null || n === undefined) return "—";
  const num = parseFloat(String(n));
  if (Number.isNaN(num)) return "—";
  if (Math.abs(num) >= 1_000_000) return `${fmtDec(num / 1_000_000, 2)} M`;
  if (Math.abs(num) >= 1_000) return `${fmtDec(num / 1_000, 1)} K`;
  return fmtDec(num, 2);
}

export function qaCheck(val: unknown, min: number, max: number): "pass" | "fail" {
  const n = parseFloat(String(val));
  if (Number.isNaN(n)) return "fail";
  if (n < min || n > max) return "fail";
  return "pass";
}

export function statusChipClass(status: string): string {
  return (
    {
      Approved: "chip-approved",
      Demo: "chip-demo",
      Controlled: "chip-controlled",
      Locked: "chip-locked",
      Pending: "chip-pending",
      Mapped: "chip-mapped",
      Official: "chip-official",
      "External standard": "chip-external",
      PASS: "chip-pass",
      FAIL: "chip-fail",
    }[status] || "chip-controlled"
  );
}
