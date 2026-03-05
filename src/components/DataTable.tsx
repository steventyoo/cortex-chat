'use client';

import { motion } from 'framer-motion';
import React, { createContext, useContext, useRef, useState, useCallback } from 'react';

// Context to disable animations during streaming
const StreamingContext = createContext(false);

export function StreamingProvider({
  isStreaming,
  children,
}: {
  isStreaming: boolean;
  children: React.ReactNode;
}) {
  return (
    <StreamingContext.Provider value={isStreaming}>
      {children}
    </StreamingContext.Provider>
  );
}

function extractTableData(tableEl: HTMLTableElement): string[][] {
  const rows: string[][] = [];
  tableEl.querySelectorAll('tr').forEach((tr) => {
    const cells: string[] = [];
    tr.querySelectorAll('th, td').forEach((cell) => {
      cells.push((cell as HTMLElement).innerText.trim());
    });
    if (cells.length > 0) rows.push(cells);
  });
  return rows;
}

function toCsv(data: string[][]): string {
  return data
    .map((row) =>
      row.map((cell) => {
        if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
          return `"${cell.replace(/"/g, '""')}"`;
        }
        return cell;
      }).join(',')
    )
    .join('\n');
}

function toTsv(data: string[][]): string {
  return data.map((row) => row.join('\t')).join('\n');
}

function CopyIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}

function CheckIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function DownloadIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}

function TableActions({ tableRef }: { tableRef: React.RefObject<HTMLTableElement | null> }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!tableRef.current) return;
    const data = extractTableData(tableRef.current);
    const tsv = toTsv(data);
    navigator.clipboard.writeText(tsv).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [tableRef]);

  const handleCsvDownload = useCallback(() => {
    if (!tableRef.current) return;
    const data = extractTableData(tableRef.current);
    const csv = toCsv(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'table-export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [tableRef]);

  return (
    <div className="flex items-center gap-0.5 absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-white/90 backdrop-blur-sm border border-[#e8e8e8] text-[#6b6b6b] hover:text-[#1a1a1a] hover:border-[#ccc] transition-all shadow-sm"
        title="Copy table"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button
        onClick={handleCsvDownload}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-white/90 backdrop-blur-sm border border-[#e8e8e8] text-[#6b6b6b] hover:text-[#1a1a1a] hover:border-[#ccc] transition-all shadow-sm"
        title="Download CSV"
      >
        <DownloadIcon />
        CSV
      </button>
    </div>
  );
}

interface DataTableProps {
  children: React.ReactNode;
}

export default function DataTable({ children }: DataTableProps) {
  const isStreaming = useContext(StreamingContext);
  const tableRef = useRef<HTMLTableElement>(null);

  if (isStreaming) {
    return (
      <div className="my-4 overflow-x-auto rounded-xl border border-[#e8e8e8] bg-white">
        <table className="min-w-full text-[13px]">{children}</table>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="group relative my-4 overflow-x-auto rounded-xl border border-[#e8e8e8] bg-white"
    >
      <TableActions tableRef={tableRef} />
      <table ref={tableRef} className="min-w-full text-[13px]">{children}</table>
    </motion.div>
  );
}

export function TableHead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-[#fafafa] border-b border-[#e8e8e8]">
      {children}
    </thead>
  );
}

export function TableBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-[#f0f0f0]">{children}</tbody>;
}

export function TableRow({
  children,
  index = 0,
}: {
  children: React.ReactNode;
  index?: number;
}) {
  const isStreaming = useContext(StreamingContext);

  if (isStreaming) {
    return (
      <tr className="hover:bg-[#f8f9fa] transition-colors">
        {children}
      </tr>
    );
  }

  return (
    <motion.tr
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: index * 0.03, ease: 'easeOut' }}
      className="hover:bg-[#f8f9fa] transition-colors"
    >
      {children}
    </motion.tr>
  );
}

export function TableHeaderCell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[#999]">
      {children}
    </th>
  );
}

export function TableCell({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-4 py-2.5 text-[#37352f] whitespace-nowrap">
      {children}
    </td>
  );
}
