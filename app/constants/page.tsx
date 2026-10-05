"use client";

import { Chip } from "@/components/ui/Chip";
import { Fmt } from "@/components/ui/Fmt";
import { MissingBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/icons/Icon";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import { fmtDec } from "@/lib/formatter";
import type { Store } from "@/lib/types";

function ConstantsContent({ s }: { s: Store }) {
  return (
    <>
      <PageHeader
        icon="sliders"
        title="Constants, EF & NCV"
        desc="Controlled constants, IPCC/GCCA stoichiometric conversion factors, default NCVs, and QA threshold bounds."
        actions={
          <>
            <Chip status={`${s.constants.length} general factors`} />
            <Chip status={`${s.fuelDefaults.length} fuel defaults`} />
          </>
        }
      />

      <div className="section-card mb-lg">
        <SectionHeader icon="sliders" title="General Constants & QA Bounds" />
        <div className="section-card-body no-pad">
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Constant / Factor</th>
                  <th className="num">Value</th>
                  <th>Unit</th>
                  <th>Source / Rationale</th>
                  <th>Used In</th>
                  <th>Change Control</th>
                  <th>Status</th>
                  <th>Source URL</th>
                </tr>
              </thead>
              <tbody>
                {s.constants.map((r, i) => {
                  const raw = r.Value;
                  const parsed = raw === null || raw === undefined || raw === "" ? NaN : parseFloat(String(raw));
                  return (
                    <tr key={`${String(r["Constant / Factor"])}-${i}`}>
                      <td>
                        <strong>{String(r["Constant / Factor"] || "")}</strong>
                      </td>
                      <td className="num mono" style={{ color: "var(--accent)" }}>
                        {Number.isFinite(parsed) ? fmtDec(parsed, 4) : <MissingBadge />}
                      </td>
                      <td className="unit-col">{String(r.Unit || "")}</td>
                      <td style={{ fontSize: 11.5, color: "var(--text-secondary)", maxWidth: 220 }}>{String(r["Source / rationale"] || "—")}</td>
                      <td style={{ fontSize: 12, color: "var(--accent-2)" }}>{String(r["Used in"] || "—")}</td>
                      <td style={{ fontSize: 12 }}>{String(r["Change control"] || "—")}</td>
                      <td>
                        <Chip status={r.Status} />
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {r["Source URL"] ? (
                          <a href={String(r["Source URL"])} target="_blank" rel="noopener noreferrer" className="text-accent" style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 3 }}>
                            Link <Icon name="external-link" size={11} />
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="section-card">
        <SectionHeader icon="flame" title="Fuel Default NCV / EF / Oxidation Factors" />
        <div className="section-card-body no-pad">
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fuel Type</th>
                  <th className="num">Default NCV</th>
                  <th>NCV Unit</th>
                  <th className="num">Default EF</th>
                  <th>EF Unit</th>
                  <th className="num">Default Ox. Factor</th>
                  <th className="num">Default Biomass %</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {s.fuelDefaults.map((r, i) => {
                  const biomass = parseFloat(String(r["Default Biomass %"]));
                  const isAlt = !Number.isNaN(biomass) && biomass > 0;
                  return (
                    <tr key={`${String(r["Fuel Type"])}-${i}`}>
                      <td>
                        <strong>{String(r["Fuel Type"] || "")}</strong>
                        {isAlt ? <span className="chip chip-demo" style={{ fontSize: 10, marginLeft: 6 }}>Alt</span> : null}
                      </td>
                      <td className="num mono" style={{ color: "var(--accent)" }}>
                        <Fmt value={r["Default NCV"]} unit="GJ/t clinker" />
                      </td>
                      <td className="unit-col">{String(r["NCV Unit"] || "")}</td>
                      <td className="num mono" style={{ color: "var(--qa-warn)" }}>
                        <Fmt value={r["Default EF"]} unit="tCO2/TJ" />
                      </td>
                      <td className="unit-col">{String(r["EF Unit"] || "")}</td>
                      <td className="num">
                        <Fmt value={r["Default Ox."]} unit="ratio" />
                      </td>
                      <td className="num" style={{ color: isAlt ? "var(--accent-3)" : "var(--text-secondary)" }}>
                        <Fmt value={r["Default Biomass %"]} unit="%" />
                      </td>
                      <td style={{ fontSize: 11.5, color: "var(--text-muted)", maxWidth: 200 }}>{String(r.Notes || "")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

export default function ConstantsPage() {
  return <RequireWorkbook title="Constants & Factors">{(s) => <ConstantsContent s={s} />}</RequireWorkbook>;
}
