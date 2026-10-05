"use client";

import Link from "next/link";

export function EvidenceLink({ id }: { id?: unknown }) {
  if (!id) return <>—</>;
  const evId = String(id);
  return (
    <Link className="ev-link" href={`/evidence?id=${encodeURIComponent(evId)}`}>
      {evId}
    </Link>
  );
}
