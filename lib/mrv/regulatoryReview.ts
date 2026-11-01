import type { SheetRow } from '@/lib/types';
import { factorSourceUrl } from './factorReview';
export const REFERENCE_FIELDS = ['Reference', 'Workbook application', 'Official source URL', 'Page / section pointer', 'Applied sheets', 'Notes', 'Status', 'Last checked'] as const;
export function referenceIssues(row: SheetRow): string[] {
  const issues: string[] = [];
  if (!String(row.Reference ?? '').trim()) issues.push('Reference title missing');
  if (!factorSourceUrl(row['Official source URL'])) issues.push('Source link missing or invalid');
  if (!String(row['Page / section pointer'] ?? '').trim()) issues.push('Version / section not recorded');
  if (!String(row['Workbook application'] ?? '').trim()) issues.push('Application not explained');
  const date = String(row['Last checked'] ?? '');
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T00:00:00Z') : null;
  if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) issues.push('Review date missing or invalid');
  return issues;
}
export function referenceMatches(row: SheetRow, query: string): boolean {
  return REFERENCE_FIELDS.some(key => String(row[key] ?? '').toLowerCase().includes(query.trim().toLowerCase()));
}
