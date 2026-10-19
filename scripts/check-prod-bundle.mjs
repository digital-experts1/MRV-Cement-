// Verifies that a production build (`next build`) contains no development/test capability: test runners, fixture
// generators, test-session sign-in, test credentials, secret rotation or the development guard. Each marker is a string
// that exists only in a development implementation (lib/server/dev/**, tests/**), never in the thin route wrappers.
// Usage: node scripts/check-prod-bundle.mjs   (after `npm run build`; exits 1 if any marker is found)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MARKERS = [
  ["test-session sign-in", "user must be one of A, B, C, REVOKED"],
  ["test credential variable", "MRV_E2E_REVOKED"],
  ["secret rotation", "no active rotation (call begin first)"],
  ["synthetic workbook generator", "SYNTHETIC_TEST_WORKBOOK_Q1_2025_"],
  ["development guard", "development endpoint refused"],
  ["hosted test runner", "hosted suite completed without an unexpected error"],
  ["isolation suite", "Tenant A cannot list, read, edit or export Tenant B records"],
  ["acceptance runner cases", "Imported PASS cannot override computed failure"],
  ["Q1 fixture reconciliation", "pending owner confirmation"],
];

const roots = [".next/server", ".next/static"];
const hits = [];
let files = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (/\.(js|mjs|cjs|json|html|rsc|body)$/.test(name)) {
      files++;
      const text = readFileSync(p, "utf8");
      for (const [label, marker] of MARKERS) if (text.includes(marker)) hits.push(`${label}: "${marker}" in ${p}`);
    }
  }
}
for (const r of roots) walk(r);
if (files === 0) {
  console.error("check-prod-bundle: no build output found; run `npm run build` first");
  process.exit(1);
}
if (hits.length) {
  console.error(`check-prod-bundle: FAIL — development capability found in the production build:\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`check-prod-bundle: PASS — ${files} build files scanned, none of ${MARKERS.length} development markers present`);
