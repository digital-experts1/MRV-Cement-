// Scans the production build output (.next) for secrets WITHOUT printing any secret value. Findings report only a label,
// the file path and a count.
//  1. Canaries: every env var named in CANARY_VARS (comma-separated) holds a random value injected at build time. Any
//     occurrence of that value anywhere in .next means a server-only secret was inlined into the build.
//  2. Secret-shaped strings in deployable output (.next/server, .next/static): JWTs, Supabase secret keys, private keys.
//  3. Server-only secret variable NAMES in the browser bundle (.next/static).
// Usage (after `npm run build`): CANARY_VARS=MRV_EXECUTOR_KEY,... node scripts/check-prod-secrets.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const canaryVars = (process.env.CANARY_VARS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const canaries = canaryVars.map((name) => [name, process.env[name] ?? ""]);
const weak = canaries.filter(([, v]) => v.length < 24).map(([n]) => n);
if (weak.length) {
  console.error(`check-prod-secrets: canary variables missing or shorter than 24 chars: ${weak.join(", ")}`);
  process.exit(1);
}

const PATTERNS = [
  ["JWT-shaped token", /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{10,}/g],
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
];
const SERVER_ONLY_NAMES = [
  "MRV_EXECUTOR_KEY",
  "DOWNLOAD_SIGNING_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MRV_E2E_A_PASSWORD",
  "MRV_E2E_B_PASSWORD",
  "MRV_E2E_C_PASSWORD",
  "MRV_E2E_REVOKED_PASSWORD",
  "MRV_STAGING_PROJECT_REF",
];

const findings = [];
let files = 0;
function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, visit);
    else visit(p);
  }
}
const count = (text, needle) => text.split(needle).length - 1;

walk(".next", (p) => {
  files++;
  const text = readFileSync(p).toString("latin1");
  for (const [name, value] of canaries) {
    const n = count(text, value);
    if (n) findings.push(`canary value of ${name} found ${n}x in ${p}`);
  }
  const deployable = p.startsWith(join(".next", "server")) || p.startsWith(join(".next", "static"));
  if (deployable && /\.(js|mjs|cjs|json|html|rsc|body|map)$/.test(p)) {
    for (const [label, re] of PATTERNS) {
      const n = (text.match(re) ?? []).length;
      if (n) findings.push(`${label} found ${n}x in ${p}`);
    }
  }
  if (p.startsWith(join(".next", "static"))) {
    for (const name of SERVER_ONLY_NAMES) if (text.includes(name)) findings.push(`server-only variable name ${name} referenced in browser bundle ${p}`);
  }
});

if (files === 0) {
  console.error("check-prod-secrets: no build output found; run `npm run build` first");
  process.exit(1);
}
if (findings.length) {
  console.error(`check-prod-secrets: FAIL (values not shown)\n${findings.join("\n")}`);
  process.exit(1);
}
console.log(
  `check-prod-secrets: PASS — ${files} files in .next scanned; ${canaries.length} canary values, ${PATTERNS.length} secret patterns and ${SERVER_ONLY_NAMES.length} server-only names not found`
);
