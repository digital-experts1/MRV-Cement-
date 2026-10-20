// Production-mode smoke test against a running `next start`. Verifies normal routes respond, development/test endpoints
// are unavailable (even with development flags set in the environment), and no response contains a canary secret.
// Usage: CANARY_VARS=... node scripts/prod-smoke.mjs http://127.0.0.1:3100
const base = (process.argv[2] ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const canaries = (process.env.CANARY_VARS ?? "").split(",").filter(Boolean).map((n) => [n, process.env[n] ?? ""]).filter(([, v]) => v);
const DEV_MARKERS = ["MRV_E2E_", "SYNTHETIC_TEST_WORKBOOK", "user must be one of A, B, C, REVOKED", "development endpoint refused", "AcceptanceRunner"];
const results = [];

async function check(label, method, path, accept, body) {
  let status = "ERR";
  let detail = "";
  try {
    const res = await fetch(base + path, {
      method,
      redirect: "manual",
      headers: body ? { "content-type": "application/json", origin: base } : { origin: base },
      body: body ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    const text = await res.text();
    const leaks = canaries.filter(([, v]) => text.includes(v)).map(([n]) => n);
    const markers = DEV_MARKERS.filter((m) => text.includes(m));
    if (leaks.length) detail += ` canary leak: ${leaks.join(",")} (value not shown)`;
    if (markers.length) detail += ` dev marker in body: ${markers.join(",")}`;
  } catch (e) {
    detail = ` ${e instanceof Error ? e.message : String(e)}`;
  }
  const pass = accept.includes(status) && !detail;
  results.push({ pass, line: `${pass ? "PASS" : "FAIL"} ${label}: ${method} ${path} -> ${status} (expected ${accept.join("/")})${detail}` });
}

// Normal routes (signed out; pages render their sign-in gate client-side).
await check("root redirects to overview", "GET", "/", [307, 308]);
for (const p of ["/signin", "/overview", "/dataentry", "/auth/callback", "/reset-password"]) await check("page responds", "GET", p, [200]);
await check("API requires a session", "GET", "/api/mrv/me", [401]);

// Development/test endpoints: unavailable for every method.
const DEV = ["hosted-e2e", "isolation", "mrv-db-selftest", "mrv-selftest", "q1-inspect", "reference-register", "secret-rotation", "synthetic-workbook", "test-session"];
for (const ep of DEV) {
  await check("dev endpoint unavailable", "GET", `/api/dev/${ep}`, [404, 405]);
  await check("dev endpoint unavailable", "POST", `/api/dev/${ep}`, [404, 405], ep === "test-session" ? { user: "A" } : { action: "begin" });
}
await check("dev acceptance page unavailable", "GET", "/dev/acceptance", [404]);
await check("legacy synthetic users unavailable", "GET", "/api/v1/dev/users", [404, 503]);
await check("legacy synthetic sign-in unavailable", "POST", "/api/v1/auth/dev-login", [404, 503], { email: "a@synthetic.example" });

for (const r of results) console.log(r.line);
const failed = results.filter((r) => !r.pass).length;
if (failed) {
  console.error(`prod-smoke: FAIL — ${failed} of ${results.length} checks failed`);
  process.exit(1);
}
console.log(`prod-smoke: PASS — ${results.length} checks`);
