import { describe, it } from "vitest";
import { ACCEPTANCE_CASES } from "./acceptance/cases";

describe("Supervisor Directive 02 — acceptance (synthetic fixtures)", () => {
  for (const c of ACCEPTANCE_CASES) {
    it(`${c.id} ${c.name}`, c.run);
  }
});
