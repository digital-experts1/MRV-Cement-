import type { ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";

export function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="auth-entrance">
    <aside className="auth-brand-panel" aria-label="About TRACE FORCE MRV">
      <a className="auth-brand" href="/signin"><Icon name="factory" size={30} /><span>TRACE FORCE<small>Cement MRV</small></span></a>
      <div className="auth-brand-copy"><h1>From plant readings<br />to clear reporting.</h1><p>Production, energy and emissions in one workspace for your cement operation.</p>
      <div className="auth-process"><span>Daily readings</span><span>Calculations & QA/QC</span><span>Reporting & evidence</span></div></div>
      <p className="auth-brand-note">Built for the people behind the numbers.</p>
    </aside>
    <main className="auth-entry-main" id="auth-content"><div className="auth-entry-content">{children}</div><footer>TRACE FORCE MRV · Cement analytics</footer></main>
  </div>;
}
