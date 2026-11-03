import { isValidTimezone, parseDate } from "@/lib/mrv/dateRanges";

export const ORGANIZATION_TYPES = ["Cement manufacturer", "Cement grinding operator", "Cement group"] as const;
export interface OrganizationDraft {
  name: string; country: string; organizationType: string; registrationNumber: string;
  facilityCode: string; facilityName: string; timezone: string; synthetic: boolean;
  start: string; end: string;
}

/** Also used by the API; no tenant, owner or role is ever accepted from the client. */
export function onboardingError(d: OrganizationDraft, step?: number): string | null {
  if (step === undefined || step === 0) {
    if (typeof d.name !== "string" || d.name.trim().length < 2 || d.name.length > 120) return "Organization name must be 2–120 characters.";
    if (typeof d.country !== "string" || d.country.trim().length < 2 || d.country.length > 80) return "Enter your organization's country (2–80 characters).";
    if (!ORGANIZATION_TYPES.includes(d.organizationType as typeof ORGANIZATION_TYPES[number])) return "Choose an organization type.";
    if (typeof d.registrationNumber !== "string" || d.registrationNumber.length > 80) return "Registration number must be 80 characters or fewer.";
    if (typeof d.synthetic !== "boolean") return "Choose a workspace type.";
  }
  if (step === undefined || step === 1) {
    if (typeof d.facilityCode !== "string" || !/^[A-Za-z0-9_-]{1,20}$/.test(d.facilityCode.trim())) return "Factory code: 1–20 letters, numbers, hyphens or underscores.";
    if (typeof d.facilityName !== "string" || d.facilityName.trim().length < 2 || d.facilityName.length > 120) return "Factory name must be 2–120 characters.";
    if (typeof d.timezone !== "string" || !isValidTimezone(d.timezone)) return "Choose a valid factory timezone.";
  }
  if (step === undefined || step === 2) {
    if (typeof d.start !== "string" || typeof d.end !== "string" || !parseDate(d.start) || !parseDate(d.end)) return "Enter valid reporting dates.";
    if (d.start > d.end) return "Reporting end must be on or after the start.";
    if (Number(d.start.slice(0, 4)) < 2000 || Number(d.end.slice(0, 4)) > 2100) return "Reporting dates must be between 2000 and 2100.";
  }
  return null;
}

export function parseOnboarding(body: Record<string, unknown>): { requestId: string; details: OrganizationDraft } {
  if (Object.keys(body).some(k => k !== "requestId" && k !== "details") || typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)) throw new Error("Invalid onboarding request.");
  const details = body.details as OrganizationDraft;
  if (!details || typeof details !== "object" || Array.isArray(details) || Object.keys(details).some(k => !["name", "country", "organizationType", "registrationNumber", "facilityCode", "facilityName", "timezone", "synthetic", "start", "end"].includes(k))) throw new Error("Invalid organization details.");
  const error = onboardingError(details);
  if (error) throw new Error(error);
  return { requestId: body.requestId, details };
}
