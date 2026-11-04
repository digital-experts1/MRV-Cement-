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
  | "analytics"
  | "portfolio"
  | "access"
  | "organizations"
  | "factories";

export interface RouteDef {
  key: RouteKey;
  href: string;
  label: string;
  icon: string;
}

export const ROUTES: Record<RouteKey, RouteDef> = {
  organizations: { key: "organizations", href: "/organizations", label: "Organizations", icon: "network" },
  factories: { key: "factories", href: "/factories", label: "Factories", icon: "factory" },
  overview: { key: "overview", href: "/overview", label: "Overview", icon: "home" },
  dataentry: { key: "dataentry", href: "/dataentry", label: "Data Entry Studio", icon: "edit-3" },
  governance: { key: "governance", href: "/governance", label: "Governance & Control", icon: "shield" },
  setup: { key: "setup", href: "/setup", label: "Setup & Reporting Period", icon: "settings" },
  dcs: { key: "dcs", href: "/dcs", label: "Data Sources & Mapping", icon: "network" },
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
  portfolio: { key: "portfolio", href: "/portfolio", label: "Portfolio", icon: "trending-up" },
  access: { key: "access", href: "/admin/access", label: "Team & access", icon: "lock" },
};

export const NAV_SECTIONS: { label: string; keys: RouteKey[] }[] = [
  { label: "Organization", keys: ["organizations", "portfolio", "factories", "access"] },
  { label: "Operations", keys: ["overview", "analytics", "dataentry"] },
  { label: "Data inputs", keys: ["dcs", "production", "rawmaterial", "kilnfuel", "electricity"] },
  { label: "Reports & assurance", keys: ["calculations", "qaqc", "reportouts", "evidence", "regulatory"] },
  { label: "Configuration", keys: ["setup", "constants", "governance"] },
];
