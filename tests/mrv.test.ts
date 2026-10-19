import { describe, it } from "vitest";
import { MRV_CASES } from "./mrv/cases";

describe("Directives 04/05 — history, ranges, snapshots (synthetic fixtures)", () => {
  for (const c of MRV_CASES) {
    it(`${c.id} ${c.name}`, c.run);
  }
});
