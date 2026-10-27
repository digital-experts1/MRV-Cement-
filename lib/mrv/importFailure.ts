import { ApiError } from "@/lib/apiClient";

/**
 * Why an import did not complete. Only "file" failures are problems with the uploaded content; server configuration,
 * access and session failures must never tell the user to fix their file.
 */
export type ImportFailureKind = "file" | "server" | "access" | "session" | "scope";

export interface ImportFailure {
  kind: ImportFailureKind;
  title: string;
  messages: string[];
  hint: string;
}

const KEPT = "Nothing was imported and the data currently displayed is unchanged.";

/** The server validated the file and rejected it (accepted: false). */
export function rejectedImport(errors: string[]): ImportFailure {
  return {
    kind: "file",
    title: "We couldn't import this workbook",
    messages: errors.length ? errors : ["The file could not be validated."],
    hint: `${KEPT} Correct the file and try again.`,
  };
}

/** The scope changed while the import was pending; the message states the import's real outcome for the original factory. */
export function scopeChangedDuringImport(message: string): ImportFailure {
  return { kind: "scope", title: "You switched factory or range during the import", messages: [message], hint: "" };
}

/** A request that failed before the server could validate and store the file. */
export function importFailureFrom(e: unknown): ImportFailure {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof ApiError) {
    if (e.status === 401) {
      return { kind: "session", title: "Your session has ended", messages: [message], hint: `${KEPT} Sign in again, then retry the upload.` };
    }
    if (e.status === 403 || e.status === 404) {
      return {
        kind: "access",
        title: "Import not permitted",
        messages: [message],
        hint: `${KEPT} Your account is not authorized to import into this factory, or the factory is not available to you.`,
      };
    }
    if (e.status === 400 || e.status === 413 || e.status === 415 || e.status === 422) {
      return { kind: "file", title: "We couldn't import this file", messages: [message], hint: `${KEPT} Check the file type and size, then try again.` };
    }
    if (e.status === 503 && /executor/i.test(message)) {
      return {
        kind: "server",
        title: "Imports are disabled on this server",
        messages: [message],
        hint: `This is a server configuration problem, not a problem with your file. ${KEPT} Saved results remain readable. Ask your administrator to configure the trusted calculation executor, then retry the same file.`,
      };
    }
    if (e.status === 409) {
      return { kind: "server", title: "The factory changed during the import", messages: [message], hint: `${KEPT} Retry the same file.` };
    }
  }
  return {
    kind: "server",
    title: "The server could not process this import",
    messages: [message],
    hint: `This is not a validation result for your file. ${KEPT} Retry later or contact your administrator if it persists.`,
  };
}
