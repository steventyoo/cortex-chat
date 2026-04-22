/**
 * Pivot EAV export rows into columnar objects grouped by record_key.
 * Each unique record_key becomes one object with `field` values as keys.
 */

import type { ExportRow } from '@/types/export';

export type { ExportRow };

export type PivotedRecord = Record<string, string | number | null>;

export function pivotByRecordKey(
  rows: ExportRow[],
): PivotedRecord[] {
  const groups = new Map<string, PivotedRecord>();

  for (const r of rows) {
    const key = r.record_key;
    if (!groups.has(key)) groups.set(key, { _record_key: key, _section: r.section });
    const obj = groups.get(key)!;
    obj[r.field] = r.value_number ?? r.value_text;
  }

  return Array.from(groups.values());
}

/**
 * Like pivotByRecordKey but SUM duplicate numeric fields instead of overwriting.
 * Used for worker transaction rows where the same (record_key, field) appears many times.
 */
export function pivotByRecordKeySum(
  rows: ExportRow[],
): PivotedRecord[] {
  const STRING_FIELDS = new Set(['cost_code', 'description', 'cost_category', 'name', 'source', 'check_number', 'number']);
  const groups = new Map<string, PivotedRecord>();

  for (const r of rows) {
    const key = r.record_key;
    if (!groups.has(key)) groups.set(key, { _record_key: key, _section: r.section });
    const obj = groups.get(key)!;

    if (r.value_number != null && !STRING_FIELDS.has(r.field)) {
      obj[r.field] = (typeof obj[r.field] === 'number' ? (obj[r.field] as number) : 0) + r.value_number;
    } else if (obj[r.field] == null) {
      obj[r.field] = r.value_number ?? r.value_text;
    }
  }

  return Array.from(groups.values());
}

// ── Formatters ──────────────────────────────────────────────

export function fmtCurrency(val: number | null | undefined): string {
  if (val == null) return '—';
  const abs = Math.abs(val);
  const formatted = abs >= 1_000_000
    ? `$${(abs / 1_000_000).toFixed(1)}M`
    : `$${abs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  return val < 0 ? `-${formatted}` : formatted;
}

export function fmtCurrencyFull(val: number | null | undefined): string {
  if (val == null) return '—';
  return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtPercent(val: number | null | undefined): string {
  if (val == null) return '—';
  return `${val.toFixed(1)}%`;
}

export function fmtNumber(val: number | null | undefined, decimals = 1): string {
  if (val == null) return '—';
  return val.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtInteger(val: number | null | undefined): string {
  if (val == null) return '—';
  return Math.round(val).toLocaleString();
}

export function n(val: string | number | null | undefined): number {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
}

export function s(val: string | number | null | undefined): string {
  if (val == null) return '';
  return String(val);
}
