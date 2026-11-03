"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { LineChart } from "@/components/charts/ChartCanvas";
import { QaBadge } from "@/components/ui/Badge";
import { Chip } from "@/components/ui/Chip";
import { EvidenceLink } from "@/components/ui/EvidenceLink";
import { Fmt } from "@/components/ui/Fmt";
import { PageHeader } from "@/components/ui/PageHeader";
import { useScope } from "@/context/ScopeContext";
import { useStore } from "@/context/StoreContext";
import { fmtDateFull } from "@/lib/formatter";
import {
  assayUnit,
  materialName,
  needsRawReview,
  rawTotal,
  rawTrend,
} from "@/lib/rawMaterialView";
import type { Store } from "@/lib/types";
import "@/app/rawmaterial/rawmaterial.css";

export function RawMaterialContent({ s }: { s: Store }) {
  const scope = useScope();
  const { openUpload } = useStore();
  const [query, setQuery] = useState("");
  const [material, setMaterial] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const rows = s.rawMaterial;
  const methods = String(
    s.setup["Selected calcination method"] ?? "Not configured",
  );
  const methodB = /method\s+b\b/i.test(methods);
  const methodA = /method\s+a\b/i.test(methods);
  const materials = [...new Set(rows.map(materialName))].sort();
  const selected = rows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) =>
        (!material || materialName(row) === material) &&
        (!reviewOnly || needsRawReview(row)) &&
        (!query.trim() ||
          [materialName(row), row.Date, row["Evidence ID"]].some((v) =>
            String(v ?? "")
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
          )),
    );
  const filtered = selected.map((item) => item.row);
  const trend = rawTrend(filtered);
  const pages = Math.max(1, Math.ceil(selected.length / 25));
  const currentPage = Math.min(page, pages - 1);
  const visible = selected.slice(currentPage * 25, (currentPage + 1) * 25);
  const reviewCount = rows.filter(needsRawReview).length;
  const referenced = rows.filter((r) =>
    String(r["Evidence ID"] ?? "").trim(),
  ).length;
  const upload = (
    <button
      type="button"
      className="btn btn-primary"
      disabled={!scope.canImport}
      onClick={openUpload}
    >
      Upload readings
    </button>
  );
  const edit = (
    <Link className="btn btn-secondary" href="/dataentry#rawmaterial">
      {scope.canImport ? "Enter / edit readings" : "View input studio"}
    </Link>
  );

  return (
    <div className="raw-page">
      <PageHeader
        icon="package"
        title="Raw Material Input"
        desc="Review carbonate consumption, laboratory assays and the input-based calcination pathway."
        actions={
          <>
            {upload}
            {edit}
          </>
        }
      />
      <section className="raw-method" aria-label="Calculation method">
        <div>
          <span className="raw-method-label">Selected calculation method</span>
          <strong>{methods}</strong>
          <p>
            {methodB
              ? "Method B uses clinker output. Raw-material readings support the alternative Method A pathway and reconciliation."
              : methodA
                ? "Method A depends on raw-material quantities, carbonate assays and conversion factors."
                : "Confirm the calculation method before interpreting these results."}
          </p>
        </div>
        <Link className="btn btn-secondary" href="/setup">
          Review setup
        </Link>
      </section>

      {rows.length === 0 ? (
        <>
          <section className="raw-empty section-card">
            <div>
              <Chip status="No readings in selected period" />
              <h3>
                {methodB
                  ? "Your selected method uses clinker output"
                  : "Add the inputs for Method A"}
              </h3>
              <p>
                No raw-material records are available for{" "}
                <strong>
                  {scope.range?.start ?? "the selected start date"} –{" "}
                  {scope.range?.end ?? "the selected end date"}
                </strong>
                . Missing inputs do not mean zero consumption.
              </p>
              <p>
                {methodB
                  ? "This can be expected for a Method B dataset. You can review its calculation now, or add raw-material data to compare the two pathways."
                  : "Upload a full MRV workbook or enter raw-material readings in the input studio. Check the reporting range above if you expected to see existing records."}
              </p>
              <div className="raw-actions">
                {edit}
                <Link href="/calculations" className="btn btn-secondary">
                  View calculations
                </Link>
              </div>
              {!scope.canImport ? (
                <p className="raw-note">
                  Importing and saving readings requires factory import
                  permission.
                </p>
              ) : null}
            </div>
            <aside>
              <h4>What you need to provide</h4>
              <ul>
                <li>
                  <strong>Consumption:</strong> material, date or reporting
                  interval, quantity in tonnes, and dry or wet mass basis.
                </li>
                <li>
                  <strong>Laboratory assay:</strong> CaCO₃, MgCO₃ and moisture,
                  each with an explicit percent or fraction declaration.
                </li>
                <li>
                  <strong>Calculation inputs:</strong> calcination conversion
                  and source evidence references.
                </li>
              </ul>
              <p className="raw-note">
                The daily totals template covers production, fuel and
                electricity. Use the full MRV workbook for raw materials.
              </p>
            </aside>
          </section>
        </>
      ) : (
        <>
          <dl className="raw-metrics">
            <div>
              <dt>Reported consumption</dt>
              <dd>
                <Fmt value={rawTotal(rows, "Quantity t")} unit="t" />
                <small> t</small>
              </dd>
              <p>As entered; may include wet and dry quantities.</p>
            </div>
            <div>
              <dt>Method A process CO₂</dt>
              <dd>
                <Fmt
                  value={s.calculations["Process CO2 Method A"]?.Value}
                  unit="tCO2"
                />
                <small> tCO₂</small>
              </dd>
              <p>
                Stored engine result for the selected period
                {methodB ? "; comparison pathway." : "."}
              </p>
            </div>
            <div>
              <dt>Evidence references</dt>
              <dd>
                {referenced}
                <small> / {rows.length} readings</small>
              </dd>
              <p>References present; document verification is separate.</p>
            </div>
            <div>
              <dt>Readings to review</dt>
              <dd>{reviewCount}</dd>
              <p>QA, missing evidence references or undeclared source units.</p>
            </div>
          </dl>
          <section className="section-card">
            <div className="raw-toolbar">
              <div>
                <h3>Readings and assays</h3>
                <p>
                  {materials.length} material{materials.length === 1 ? "" : "s"}{" "}
                  in this period. Expand a reading for source units and
                  calculation details.
                </p>
              </div>
              <label>
                Search readings
                <input
                  className="form-input"
                  type="search"
                  value={query}
                  placeholder="Material, date or evidence ID"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <label>
                Material
                <select
                  className="form-input"
                  value={material}
                  onChange={(e) => {
                    setMaterial(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">All materials</option>
                  {materials.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label className="raw-check">
                <input
                  type="checkbox"
                  checked={reviewOnly}
                  onChange={(e) => {
                    setReviewOnly(e.target.checked);
                    setPage(0);
                  }}
                />
                Needs review ({reviewCount})
              </label>
            </div>
            <p className="raw-count" role="status">
              Showing {selected.length ? currentPage * 25 + 1 : 0}–
              {Math.min((currentPage + 1) * 25, selected.length)} of{" "}
              {selected.length} matching readings ({rows.length} total).
            </p>
            <div
              className="table-wrapper raw-table-scroll"
              tabIndex={0}
              aria-label="Raw material readings; scroll horizontally for all columns"
            >
              <table className="data-table">
                <caption className="sr-only">
                  Raw material readings for the selected reporting period
                </caption>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Material</th>
                    <th className="num">Quantity (t)</th>
                    <th className="num">Dry quantity (t)</th>
                    <th className="num">Method A CO₂ (t)</th>
                    <th>Evidence</th>
                    <th>Calculation QA</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ row: r, index }) => (
                    <Fragment key={index}>
                      <tr>
                        <td>{fmtDateFull(r.Date)}</td>
                        <td>
                          <strong>{materialName(r)}</strong>
                          <small className="raw-basis">
                            {String(
                              r["Mass Basis Applied"] ??
                                r["Mass Basis"] ??
                                "Mass basis undeclared",
                            )}
                          </small>
                        </td>
                        <td className="num">
                          <Fmt value={r["Quantity t"]} unit="t" />
                        </td>
                        <td className="num">
                          <Fmt value={r["Dry Quantity t"]} unit="t" />
                        </td>
                        <td className="num">
                          <Fmt
                            value={r["Process CO2 Method A t"]}
                            unit="tCO2"
                          />
                        </td>
                        <td>
                          {String(r["Evidence ID"] ?? "").trim() ? (
                            <EvidenceLink id={r["Evidence ID"]} />
                          ) : (
                            <span className="badge badge-warn">
                              Missing reference
                            </span>
                          )}
                        </td>
                        <td>
                          <QaBadge status={r["QA Status"]} />
                        </td>
                        <td>
                          <button
                            className="btn btn-secondary btn-sm"
                            type="button"
                            aria-expanded={expanded === index}
                            aria-controls={`raw-details-${index}`}
                            onClick={() =>
                              setExpanded(expanded === index ? null : index)
                            }
                          >
                            {expanded === index ? "Hide" : "View"}
                            <span className="sr-only">
                              {" "}
                              assay for {materialName(r)}, {fmtDateFull(r.Date)}
                            </span>
                          </button>
                        </td>
                      </tr>
                      {expanded === index ? (
                        <tr id={`raw-details-${index}`}>
                          <td colSpan={8}>
                            <div className="raw-details">
                              <div>
                                <h4>Laboratory assay · source values</h4>
                                <dl>
                                  {[
                                    ["CaCO₃", "CaCO3 %", assayUnit(r)],
                                    ["MgCO₃", "MgCO3 %", assayUnit(r)],
                                    [
                                      "Moisture",
                                      "Moisture %",
                                      assayUnit(r, true),
                                    ],
                                  ].map(([label, field, unit]) => (
                                    <div key={field}>
                                      <dt>{label}</dt>
                                      <dd>
                                        {String(r[field] ?? "").trim() ||
                                          "Missing"}{" "}
                                        <small>{unit}</small>
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                                <p>
                                  Source values are preserved. A fraction of
                                  0.95 represents 95% only when declared as a
                                  fraction.
                                </p>
                              </div>
                              <div>
                                <h4>Calculation and traceability</h4>
                                <dl>
                                  {[
                                    [
                                      "Calcination conversion",
                                      "Calcination Conversion",
                                    ],
                                    ["CaCO₃ CO₂ (t)", "CaCO3 CO2 t"],
                                    ["MgCO₃ CO₂ (t)", "MgCO3 CO2 t"],
                                  ].map(([label, field]) => (
                                    <div key={field}>
                                      <dt>{label}</dt>
                                      <dd>
                                        <Fmt
                                          value={r[field]}
                                          unit={
                                            field === "Calcination Conversion"
                                              ? "ratio"
                                              : "tCO2"
                                          }
                                        />
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                                <p>
                                  Interval:{" "}
                                  {String(
                                    r["Interval Start"] ?? "Not declared",
                                  )}{" "}
                                  –{" "}
                                  {String(r["Interval End"] ?? "Not declared")}
                                </p>
                                <p>
                                  Carbonate basis:{" "}
                                  {String(
                                    r["Carbonate Unit Basis"] ?? "Not declared",
                                  )}
                                </p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {!selected.length ? (
              <div className="raw-no-results">
                <h4>No readings match these filters</h4>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setQuery("");
                    setMaterial("");
                    setReviewOnly(false);
                    setPage(0);
                  }}
                >
                  Clear filters
                </button>
              </div>
            ) : null}
            {pages > 1 ? (
              <nav className="raw-pagination" aria-label="Readings pagination">
                <button
                  className="btn btn-secondary"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {currentPage + 1} of {pages}
                </span>
                <button
                  className="btn btn-secondary"
                  disabled={currentPage === pages - 1}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </button>
              </nav>
            ) : null}
          </section>
          {filtered.length ? (
            <section
              className="raw-trends"
              aria-label="Filtered reading trends"
            >
              <div className="chart-card">
                <h3>Consumption by recorded date</h3>
                <div className="chart-container">
                  <LineChart
                    labels={trend.map((d) => fmtDateFull(d.date))}
                    yUnit="t"
                    datasets={[
                      {
                        label: "Reported quantity (t)",
                        data: trend.map((d) => d.quantity),
                        color: "#1677FF",
                      },
                    ]}
                  />
                </div>
              </div>
              <div className="chart-card">
                <h3>Method A CO₂ by recorded date</h3>
                <div className="chart-container">
                  <LineChart
                    labels={trend.map((d) => fmtDateFull(d.date))}
                    yUnit="tCO₂"
                    datasets={[
                      {
                        label: "Row process CO₂ (t)",
                        data: trend.map((d) => d.co2),
                        color: "#64748B",
                      },
                    ]}
                  />
                </div>
              </div>
              <p className="raw-note">
                Charts follow the filters and group rows by recorded date;
                reporting intervals are not redistributed into daily values.
                Missing or invalid values remain gaps; rows without a valid
                recorded date are not plotted. Row subtotals do not replace the
                stored calculation result.
              </p>
            </section>
          ) : null}
        </>
      )}
      <details className="raw-explainer">
        <summary>How these inputs relate to Method A and Method B</summary>
        <p>
          Method A uses dry raw-material mass, carbonate fractions and
          calcination conversion. Method B uses clinker output and the
          configured clinker emission factor. The selected method controls the
          process result; these pathways are not added together.
        </p>
        <p>
          Adding a raw-material reading does not change the selected method.
          Review setup, source units, evidence and QA before using a report.
        </p>
        <Link href="/qaqc">Review QA/QC checks</Link>
      </details>
    </div>
  );
}
