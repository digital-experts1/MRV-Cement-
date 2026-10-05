export type RouteKey =
  | "overview"
  | "dataentry"
  | "governance"
  | "setup"
  | "dcs"
  | "production"
  | "rawmaterial"
  | "kilnfuel"
  | "electricity"
  | "constants"
  | "calculations"
  | "qaqc"
  | "reportouts"
  | "evidence"
  | "regulatory"
  | "analytics";

export interface RouteDef {
  key: RouteKey;
  href: string;
  label: string;
  icon: string;
}

export const ROUTES: Record<RouteKey, RouteDef> = {
  overview: { key: "overview", href: "/overview", label: "Overview", icon: "home" },
  dataentry: { key: "dataentry", href: "/dataentry", label: "Data Entry Studio", icon: "edit-3" },
  governance: { key: "governance", href: "/governance", label: "Governance & Control", icon: "shield" },
  setup: { key: "setup", href: "/setup", label: "Setup & Reporting Period", icon: "settings" },
  dcs: { key: "dcs", href: "/dcs", label: "DCS / ERP / Lab Boundary", icon: "network" },
  production: { key: "production", href: "/production", label: "Production Input", icon: "factory" },
  rawmaterial: { key: "rawmaterial", href: "/rawmaterial", label: "Raw Material Input", icon: "package" },
  kilnfuel: { key: "kilnfuel", href: "/kilnfuel", label: "Kiln Fuel Input", icon: "flame" },
  electricity: { key: "electricity", href: "/electricity", label: "Electricity Input", icon: "zap" },
  constants: { key: "constants", href: "/constants", label: "Constants, EF & NCV", icon: "sliders" },
  calculations: { key: "calculations", href: "/calculations", label: "Calculations", icon: "calculator" },
  qaqc: { key: "qaqc", href: "/qaqc", label: "QA/QC Checks", icon: "check-circle" },
  reportouts: { key: "reportouts", href: "/reportouts", label: "Report Outputs", icon: "file-text" },
  evidence: { key: "evidence", href: "/evidence", label: "Evidence Register", icon: "folder" },
  regulatory: { key: "regulatory", href: "/regulatory", label: "Regulatory References", icon: "book-open" },
  analytics: { key: "analytics", href: "/analytics", label: "Analytics Dashboard", icon: "bar-chart-2" },
};

export const NAV_SECTIONS: { label: string; keys: RouteKey[] }[] = [
  { label: "Workspace", keys: ["overview", "dataentry"] },
  { label: "Governance", keys: ["governance", "setup"] },
  { label: "Data Inputs", keys: ["dcs", "production", "rawmaterial", "kilnfuel", "electricity"] },
  { label: "Factors", keys: ["constants"] },
  { label: "Outputs", keys: ["calculations", "qaqc", "reportouts"] },
  { label: "Compliance", keys: ["evidence", "regulatory"] },
  { label: "Analytics", keys: ["analytics"] },
];
