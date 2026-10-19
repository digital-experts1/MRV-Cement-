export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** Used for both "does not exist" and "exists in a scope you cannot access", so IDs cannot be probed. */
export const notFound = () => new HttpError(404, "Not found");
export const forbidden = (message = "Forbidden") => new HttpError(403, message);
export const unauthenticated = () => new HttpError(401, "Authentication required");
export const badRequest = (message: string) => new HttpError(400, message);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
