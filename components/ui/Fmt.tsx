import { isMissing, fmtNumber } from "@/lib/formatter";
import { MissingBadge } from "./Badge";

export function Fmt({ value, unit }: { value: unknown; unit?: string }) {
  if (isMissing(value)) {
    return <MissingBadge label={typeof value === "string" && value === "N/A" ? "N/A" : "Missing"} />;
  }
  return <>{fmtNumber(value, unit)}</>;
}
