"use client";

import { useStore } from "@/context/StoreContext";

export function Footer() {
  const { store } = useStore();
  let text = "TRACE FORCE MRV — Cement QA/QC Analytics Platform";

  if (store?._valid) {
    const site = store.setup["Installation / site"] ? String(store.setup["Installation / site"]) : "";
    const quarter = store.setup["Reporting quarter"] ? String(store.setup["Reporting quarter"]) : "";
    text = `TRACE FORCE MRV — Cement QA/QC Platform | ${site ? site + " | " : ""}${quarter ? quarter + " | " : ""}Operational Control`;
  }

  return (
    <footer id="footer" role="contentinfo">
      <div className="footer-text">{text}</div>
    </footer>
  );
}
