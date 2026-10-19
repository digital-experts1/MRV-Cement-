"use client";

import { useEffect, useState } from "react";
import { ACCEPTANCE_CASES } from "@/tests/acceptance/cases";

interface Result {
  id: string;
  name: string;
  passed: boolean;
  error?: string;
}

export function AcceptanceRunner() {
  const [results, setResults] = useState<Result[] | null>(null);

  useEffect(() => {
    setResults(
      ACCEPTANCE_CASES.map((c) => {
        try {
          c.run();
          return { id: c.id, name: c.name, passed: true };
        } catch (e) {
          return { id: c.id, name: c.name, passed: false, error: e instanceof Error ? e.message : String(e) };
        }
      })
    );
  }, []);

  if (!results) return <div className="page-container">Running acceptance cases…</div>;
  const passed = results.filter((r) => r.passed).length;

  return (
    <div className="page-container">
      <h1 style={{ fontSize: 18 }}>Directive 02 acceptance harness (development only, synthetic fixtures)</h1>
      <p id="acceptance-summary" data-passed={passed} data-total={results.length}>
        {passed} / {results.length} passed
      </p>
      <table className="data-table compact">
        <tbody>
          {results.map((r) => (
            <tr key={r.id} data-status={r.passed ? "pass" : "fail"}>
              <td className="mono">{r.id}</td>
              <td>{r.name}</td>
              <td>{r.passed ? "PASS" : "FAIL"}</td>
              <td style={{ fontSize: 11 }}>{r.error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
