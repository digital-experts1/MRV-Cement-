import Link from "next/link";
import { Icon } from "@/components/icons/Icon";

/** Empty state for organization-scoped pages (signed out or missing permission). */
export function ScopeNotice({ title, desc, signIn = false }: { title: string; desc: string; signIn?: boolean }) {
  return (
    <div className="state-box">
      <div className="state-icon" style={{ color: "var(--accent)" }}>
        <Icon name="lock" size={36} />
      </div>
      <div className="state-title">{title}</div>
      <div className="state-sub">{desc}</div>
      {signIn ? (
        <Link className="btn btn-primary" style={{ marginTop: 8 }} href="/signin">
          Sign in
        </Link>
      ) : null}
    </div>
  );
}
