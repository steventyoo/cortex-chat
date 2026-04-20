'use client';

import { useState, useMemo, useCallback } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  render?: (row: T, idx: number) => React.ReactNode;
  sortable?: boolean;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  summaryRow?: T;
  getRowKey: (row: T, idx: number) => string;
  emptyMessage?: string;
  compact?: boolean;
}

export default function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  summaryRow,
  getRowKey,
  emptyMessage = 'No data available',
  compact = false,
}: DataTableProps<T>) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = useCallback((key: string) => {
    if (sortCol === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(key);
      setSortDir('desc');
    }
  }, [sortCol]);

  const sorted = useMemo(() => {
    if (!sortCol) return data;
    return [...data].sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const numA = typeof va === 'number' ? va : parseFloat(String(va));
      const numB = typeof vb === 'number' ? vb : parseFloat(String(vb));
      if (!isNaN(numA) && !isNaN(numB)) {
        return sortDir === 'asc' ? numA - numB : numB - numA;
      }
      const cmp = String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortCol, sortDir]);

  const py = compact ? 'py-1' : 'py-1.5';

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-[#999] text-sm">{emptyMessage}</div>
    );
  }

  return (
    <div className="border border-[#e8e8e8] rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#fafafa] border-b border-[#e8e8e8]">
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`px-3 ${py} text-[11px] font-semibold text-[#999] tracking-wider uppercase whitespace-nowrap ${
                    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                  } ${col.sortable !== false ? 'cursor-pointer select-none hover:text-[#666]' : ''} ${col.className || ''}`}
                  onClick={() => col.sortable !== false && handleSort(col.key)}
                >
                  {col.label}
                  {sortCol === col.key && (
                    <span className="ml-0.5 text-[9px]">{sortDir === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, idx) => (
              <tr
                key={getRowKey(row, idx)}
                className="border-t border-[#f0f0f0] hover:bg-[#f9f9f9] transition-colors"
              >
                {columns.map(col => (
                  <td
                    key={col.key}
                    className={`px-3 ${py} font-mono text-[13px] ${
                      col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                    }`}
                  >
                    {col.render ? col.render(row, idx) : (
                      <span className="text-[#333]">{row[col.key] != null ? String(row[col.key]) : '—'}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {summaryRow && (
              <tr className="border-t-2 border-[#ddd] bg-[#fafafa] font-semibold">
                {columns.map(col => (
                  <td
                    key={col.key}
                    className={`px-3 ${py} font-mono text-[13px] ${
                      col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                    }`}
                  >
                    {col.render ? col.render(summaryRow, -1) : (
                      <span className="text-[#1a1a1a]">{summaryRow[col.key] != null ? String(summaryRow[col.key]) : ''}</span>
                    )}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
