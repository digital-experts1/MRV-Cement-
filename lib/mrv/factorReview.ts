import { parseStrictNumber } from '@/lib/numeric';
import type { SheetRow } from '@/lib/types';

export function factorSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; } catch { return null; }
}
export function factorIssues(row: SheetRow): string[] {
  const issues: string[] = [];
  const parsed = parseStrictNumber(row.Value);
  if (parsed.kind !== 'ok') issues.push(parsed.kind === 'blank' ? 'Missing value' : 'Invalid number');
  if (!String(row.Unit ?? '').trim()) issues.push('Missing unit');
  if (!String(row['Source / rationale'] ?? '').trim()) issues.push('Missing source / rationale');
  if (!factorSourceUrl(row['Source URL'])) issues.push('Source link missing or invalid');
  return issues;
}
/** Exact entered factor combinations; do not average factors across units or sources. */
export function groupFactorRows(rows: SheetRow[], fields: string[]) {
  const groups = new Map<string, { row: SheetRow; count: number }>();
  for (const row of rows) {
    const key = JSON.stringify(fields.map(f => row[f] ?? null));
    const existing = groups.get(key);
    if (existing) existing.count++;
    else groups.set(key, { row, count: 1 });
  }
  return [...groups.values()];
}
