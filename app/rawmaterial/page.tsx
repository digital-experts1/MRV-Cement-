"use client";

import { RawMaterialContent } from "@/components/rawmaterial/RawMaterialContent";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import { useScope } from "@/context/ScopeContext";

export default function RawMaterialPage() {
  const scope = useScope();
  return (
    <RequireWorkbook title="Raw Material Input">
      {(s) => <RawMaterialContent key={scope.activeKey} s={s} />}
    </RequireWorkbook>
  );
}
