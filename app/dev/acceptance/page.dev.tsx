import { notFound } from "next/navigation";
import { AcceptanceRunner } from "./AcceptanceRunner";

/** Development-only harness that executes the same acceptance cases as the Vitest suite in the browser. */
export default function AcceptancePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AcceptanceRunner />;
}
