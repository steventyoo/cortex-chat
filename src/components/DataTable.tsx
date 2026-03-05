'use client';

import { motion } from 'framer-motion';
import React, { createContext, useContext } from 'react';

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

interface DataTableProps {
  children: React.ReactNode;
}

export default function DataTable({ children }: DataTableProps) {
  const isStreaming = useContext(StreamingContext);

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
      className="my-4 overflow-x-auto rounded-xl border border-[#e8e8e8] bg-white"
    >
      <table className="min-w-full text-[13px]">{children}</table>
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
