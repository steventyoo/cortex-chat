'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import React, { createContext, useContext } from 'react';
import DataTable, {
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from './DataTable';
import SourceTag from './SourceTag';
import { SourceRef } from '@/lib/types';

const SourceContext = createContext<SourceRef[]>([]);

const CITATION_PATTERN = /\[(S|V)\d+\]/g;
const SOURCE_FILE_PATTERN = /\[source:\s*([^\]]+)\]/g;

function SourceFilePill({ filename }: { filename: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 rounded bg-[#f0f4ff] text-[11px] text-[#4a7cca] font-medium align-baseline leading-none border border-[#dce6f5] cursor-default" title={filename}>
      <svg className="w-2.5 h-2.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
      {filename.length > 40 ? filename.slice(0, 37) + '...' : filename}
    </span>
  );
}

function renderTextWithCitations(text: string, sources: SourceRef[]): React.ReactNode[] {
  const hasCitations = CITATION_PATTERN.test(text);
  CITATION_PATTERN.lastIndex = 0;
  const hasSourceFiles = SOURCE_FILE_PATTERN.test(text);
  SOURCE_FILE_PATTERN.lastIndex = 0;

  if (!hasCitations && !hasSourceFiles) {
    return [text];
  }

  // Unified regex that matches both patterns
  const combinedPattern = /\[(S|V)\d+\]|\[source:\s*([^\]]+)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = combinedPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // Legacy citation tag [S1], [V2]
      const tag = match[0].slice(1, -1);
      const source = sources.find((s) => s.tag === tag);
      parts.push(<SourceTag key={`${tag}-${match.index}`} tag={tag} source={source} />);
    } else if (match[2]) {
      // Source file citation [source: filename.xlsx]
      const filename = match[2].trim();
      parts.push(<SourceFilePill key={`sf-${match.index}`} filename={filename} />);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function CitationText({ children }: { children: React.ReactNode }) {
  const sources = useContext(SourceContext);

  return (
    <>
      {React.Children.map(children, (child) => {
        if (typeof child === 'string') {
          const parts = renderTextWithCitations(child, sources);
          return parts.length === 1 && typeof parts[0] === 'string' ? child : <>{parts}</>;
        }
        return child;
      })}
    </>
  );
}

interface MarkdownRendererProps {
  content: string;
  sources?: SourceRef[];
}

let rowIndex = 0;

export default function MarkdownRenderer({ content, sources }: MarkdownRendererProps) {
  rowIndex = 0;

  return (
    <SourceContext.Provider value={sources || []}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => (
            <h2 className="text-[17px] font-semibold text-[#1a1a1a] mt-7 mb-3 pb-2 border-b border-[#e8e8e8] tracking-[-0.01em]">
              <CitationText>{children}</CitationText>
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[15px] font-semibold text-[#37352f] mt-5 mb-2 tracking-[-0.01em]">
              <CitationText>{children}</CitationText>
            </h3>
          ),
          p: ({ children }) => (
            <p className="text-[#37352f] mb-3 leading-[1.7] text-[15px]">
              <CitationText>{children}</CitationText>
            </p>
          ),
          strong: ({ children }) => (
            <strong className="text-[#1a1a1a] font-semibold">
              <CitationText>{children}</CitationText>
            </strong>
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
            <li className="text-[#37352f] leading-[1.6]">
              <CitationText>{children}</CitationText>
            </li>
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
            <TableHeaderCell>
              <CitationText>{children}</CitationText>
            </TableHeaderCell>
          ),
          td: ({ children }) => (
            <TableCell>
              <CitationText>{children}</CitationText>
            </TableCell>
          ),
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
    </SourceContext.Provider>
  );
}
