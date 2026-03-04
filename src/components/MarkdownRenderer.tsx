'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import React from 'react';
import DataTable, {
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from './DataTable';

interface MarkdownRendererProps {
  content: string;
}

let rowIndex = 0;

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  rowIndex = 0;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2: ({ children }) => (
          <h2 className="text-[17px] font-semibold text-[#1a1a1a] mt-7 mb-3 pb-2 border-b border-[#e8e8e8] tracking-[-0.01em]">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-[15px] font-semibold text-[#37352f] mt-5 mb-2 tracking-[-0.01em]">
            {children}
          </h3>
        ),
        p: ({ children }) => (
          <p className="text-[#37352f] mb-3 leading-[1.7] text-[15px]">{children}</p>
        ),
        strong: ({ children }) => (
          <strong className="text-[#1a1a1a] font-semibold">{children}</strong>
        ),
        ul: ({ children }) => (
          <ul className="list-disc list-outside space-y-1 mb-3 text-[#37352f] ml-5 text-[15px]">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-outside space-y-1 mb-3 text-[#37352f] ml-5 text-[15px]">
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="text-[#37352f] leading-[1.6]">{children}</li>
        ),
        blockquote: ({ children }) => (
          <div className="my-4 py-3 px-4 rounded-lg bg-[#f7f6f3] border-l-[3px] border-[#e16259] text-[#37352f]">
            {children}
          </div>
        ),
        code: ({ children, className }) => {
          const isInline = !className;
          if (isInline) {
            return (
              <code className="px-[5px] py-[2px] rounded-[4px] bg-[#f7f6f3] text-[#eb5757] text-[14px] font-mono">
                {children}
              </code>
            );
          }
          return (
            <pre className="my-3 p-4 rounded-xl bg-[#f7f6f3] overflow-x-auto">
              <code className="text-[13px] font-mono text-[#37352f]">
                {children}
              </code>
            </pre>
          );
        },
        table: ({ children }) => <DataTable>{children}</DataTable>,
        thead: ({ children }) => <TableHead>{children}</TableHead>,
        tbody: ({ children }) => {
          rowIndex = 0;
          return <TableBody>{children}</TableBody>;
        },
        tr: ({ children }) => {
          const idx = rowIndex++;
          return <TableRow index={idx}>{children}</TableRow>;
        },
        th: ({ children }) => (
          <TableHeaderCell>{children}</TableHeaderCell>
        ),
        td: ({ children }) => <TableCell>{children}</TableCell>,
        a: ({ href, children }) => (
          <a
            href={href}
            className="text-[#007aff] hover:text-[#0066d6] underline underline-offset-2 decoration-[#007aff]/30"
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ),
        hr: () => <hr className="my-5 border-[#e8e8e8]" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
