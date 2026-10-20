// Reads the Vitest JSON report and fails unless: no test failed, the Q1 reconciliation file ran with every test passed
// (none skipped), and every offline suite executed. The hosted suite may skip (no test-project credentials in CI).
// Usage: node scripts/check-vitest-results.mjs vitest-results.json
import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync(process.argv[2] ?? "vitest-results.json", "utf8"));
const REQUIRED = ["tests/acceptance.test.ts", "tests/isolation.test.ts", "tests/mrv.test.ts", "tests/mrvDb.test.ts", "tests/q1Reconciliation.test.ts"];
const errors = [];
const summary = [];

for (const file of REQUIRED) {
  const suite = report.testResults.find((r) => r.name.replaceAll("\\", "/").endsWith(file));
  if (!suite) {
    errors.push(`${file}: not executed`);
    continue;
  }
  const by = (s) => suite.assertionResults.filter((a) => a.status === s).length;
  const passed = by("passed");
  const failed = by("failed");
  const skipped = suite.assertionResults.length - passed - failed;
  summary.push(`${file}: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failed || suite.status === "failed") errors.push(`${file}: failures`);
  if (passed === 0) errors.push(`${file}: no passing tests`);
  if (skipped) errors.push(`${file}: ${skipped} test(s) skipped`);
}
if (report.numFailedTests > 0 || report.numFailedTestSuites > 0) errors.push(`${report.numFailedTests} failed test(s), ${report.numFailedTestSuites} failed suite(s)`);

console.log(summary.join("\n"));
console.log(`totals: ${report.numPassedTests} passed, ${report.numFailedTests} failed, ${report.numPendingTests + (report.numTodoTests ?? 0)} skipped/todo of ${report.numTotalTests}`);
if (errors.length) {
  console.error(`check-vitest-results: FAIL\n${errors.join("\n")}`);
  process.exit(1);
}
console.log("check-vitest-results: PASS (Q1 reconciliation executed, none skipped)");
