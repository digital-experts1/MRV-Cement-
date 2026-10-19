export interface QueryResult<T> {
  rows: T[];
  affectedRows?: number;
}

export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(text: string): Promise<void>;
}

export interface Database {
  /** Runs `fn` inside one transaction on one connection. Callers choose the role/context (see context.ts). */
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
