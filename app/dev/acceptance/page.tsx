import { notFound } from "next/navigation";

/**
 * Development-only harness that executes the same acceptance cases as the Vitest suite in the browser. The runner (and
 * the test cases it bundles) is imported only inside the statically-evaluated development branch.
 */
export default async function AcceptancePage() {
  if (process.env.NODE_ENV === "development") {
    const { AcceptanceRunner } = await import("./AcceptanceRunner");
    return <AcceptanceRunner />;
  }
  notFound();
}
