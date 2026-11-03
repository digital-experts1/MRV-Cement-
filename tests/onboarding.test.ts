import { describe, expect, it } from "vitest";
import { onboardingError, parseOnboarding, type OrganizationDraft } from "@/lib/tenancy/onboarding";

const details: OrganizationDraft = { name: "Test Cement", country: "Egypt", organizationType: "Cement manufacturer", registrationNumber: "",
  facilityCode: "F-1", facilityName: "Test factory", timezone: "Africa/Cairo", synthetic: true, start: "2026-01-01", end: "2026-12-31" };
const requestId = "99999999-0000-4000-8000-000000000001";
describe("organization onboarding validation", () => {
  it("accepts a complete draft and permits completing steps independently", () => {
    expect(parseOnboarding({ requestId, details }).details).toEqual(details);
    expect(onboardingError({ ...details, facilityCode: "", start: "" }, 0)).toBeNull();
    expect(onboardingError({ ...details, facilityCode: "" }, 1)).not.toBeNull();
  });
  it.each(["tenantId", "userId", "ownerId", "role", "isPlatformAdmin"])("rejects client-supplied authorization field %s", key => {
    expect(() => parseOnboarding({ requestId, details: { ...details, [key]: "forged" } })).toThrow();
    expect(() => parseOnboarding({ requestId, details, [key]: "forged" })).toThrow();
  });
  it("rejects missing data, invalid dates, reversed ranges and string booleans", () => {
    for (const invalid of [null, [], {}, { ...details, synthetic: "false" }, { ...details, start: "2026-02-30" }, { ...details, end: "2025-12-31" }, { ...details, timezone: "Invalid/Zone" }]) {
      expect(() => parseOnboarding({ requestId, details: invalid })).toThrow();
    }
  });
});
