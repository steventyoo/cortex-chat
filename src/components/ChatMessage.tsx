'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChatMessage as ChatMessageType, SourceRef, ToolCallEntry } from '@/lib/types';
import MarkdownRenderer from './MarkdownRenderer';
import { StreamingProvider } from './DataTable';
import LoadingDots from './LoadingDots';

function ToolCallCard({ tc }: { tc: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  const label = tc.displayName || tc.name.replace(/_/g, ' ');

  const inputQuery = typeof tc.input?.query === 'string' ? tc.input.query : null;
  const inputQuestion = typeof tc.input?.question === 'string' ? tc.input.question : null;
  const displayInput = inputQuery || inputQuestion;

  let resultArr: Record<string, unknown>[] = [];
  let resultRows: Record<string, unknown>[] = [];
  let summary: string | null = null;
  let stdout: string | null = null;
  let hasError = false;
  let errorMsg: string | null = null;

  if (tc.result && typeof tc.result === 'object') {
    const res = tc.result as Record<string, unknown>;
    summary = typeof res._summary === 'string' ? res._summary : null;

    if (Array.isArray(res.records)) {
      resultArr = res.records as Record<string, unknown>[];
    } else if (Array.isArray(res.rows)) {
      resultRows = res.rows as Record<string, unknown>[];
    } else if (Array.isArray(tc.result)) {
      resultArr = tc.result as Record<string, unknown>[];
    }

    if (typeof res.stdout === 'string' && res.stdout.length > 0) {
      stdout = res.stdout;
    }
    if (typeof res.error === 'string') {
      hasError = true;
      errorMsg = res.error;
    }

    if (Array.isArray(res.catalog)) {
      resultArr = res.catalog as Record<string, unknown>[];
    }
    if (Array.isArray(res.cards)) {
      resultArr = res.cards as Record<string, unknown>[];
    }
  }

  const count = tc.resultCount ?? (resultArr.length || resultRows.length);
  const hasExpandableContent = resultArr.length > 0 || resultRows.length > 0 || stdout || tc.htmlArtifact;

  return (
    <div className="my-2 rounded-lg border border-[#2a2a2a] bg-[#111111] text-[13px] overflow-hidden">
      <button
        onClick={() => tc.status === 'done' && hasExpandableContent && setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#1a1a1a] transition-colors"
      >
        {tc.status === 'calling' ? (
          <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
            <span className="block w-3 h-3 rounded-full border-2 border-[#007aff] border-t-transparent animate-spin" />
          </span>
        ) : tc.status === 'error' ? (
          <svg className="w-4 h-4 text-red-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
        ) : (
          <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
        )}

        <span className="font-medium text-[#e0e0e0] capitalize">{label}</span>

        {tc.status === 'done' && (
          <span className="text-[#666] ml-auto flex items-center gap-1.5">
            {summary || (count > 0 ? `${count} record${count !== 1 ? 's' : ''}` : '')}
            {tc.htmlArtifact && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1a3a5c] text-[#60a5fa]">chart</span>}
            {hasExpandableContent && (
              <svg className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
            )}
          </span>
        )}

        {tc.status === 'calling' && (
          <span className="text-[#666] ml-auto">Working...</span>
        )}
      </button>

      {displayInput && (
        <div className="px-3 pb-2 text-[12px] text-[#777] border-t border-[#222]">
          <span className="text-[#555]">Input:</span> {displayInput}
        </div>
      )}

      <AnimatePresence>
        {expanded && hasExpandableContent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-[#222]"
          >
            {/* HTML Artifact (chart/visualization) */}
            {tc.htmlArtifact && (
              <div className="p-3">
                <iframe
                  srcDoc={tc.htmlArtifact}
                  sandbox="allow-scripts"
                  className="w-full rounded-lg border border-[#2a2a2a] bg-white"
                  style={{ minHeight: 400, maxHeight: 600 }}
                  title={`${label} visualization`}
                />
              </div>
            )}

            {/* Stdout from sandbox execution */}
            {stdout && (
              <div className="px-3 py-2 text-[12px]">
                <div className="text-[#555] text-[11px] mb-1 uppercase tracking-wide">Output</div>
                <pre className="whitespace-pre-wrap break-words text-[#aaa] leading-relaxed bg-[#0a0a0a] rounded p-2 border border-[#1f1f1f]">
                  {stdout}
                </pre>
              </div>
            )}

            {/* Error message */}
            {Boolean(hasError) && errorMsg ? (
              <div className="px-3 py-2 text-[12px] text-red-400">
                <div className="text-[11px] mb-1 uppercase tracking-wide">Error</div>
                <pre className="whitespace-pre-wrap break-words bg-[#1a0a0a] rounded p-2 border border-[#2a1f1f]">
                  {errorMsg}
                </pre>
              </div>
            ) : null}

            {/* SQL result rows */}
            {resultRows.length > 0 && (
              <div className="max-h-[300px] overflow-y-auto p-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px] text-left">
                    <thead>
                      <tr className="text-[#555] border-b border-[#222]">
                        {Object.keys(resultRows[0]).map(col => (
                          <th key={col} className="px-2 py-1.5 font-medium whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {resultRows.map((row, i) => (
                        <tr key={i} className="border-b border-[#1a1a1a] hover:bg-[#0a0a0a]">
                          {Object.values(row).map((val, j) => (
                            <td key={j} className="px-2 py-1.5 text-[#aaa] whitespace-nowrap">
                              {val === null ? <span className="text-[#444]">null</span> : String(val)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Record results (RAG, scan, catalog, context cards) */}
            {resultArr.length > 0 && (
              <div className="max-h-[300px] overflow-y-auto p-3 space-y-2">
                {resultArr.map((record: Record<string, unknown>, i: number) => (
                  <div key={i} className="rounded bg-[#0a0a0a] border border-[#1f1f1f] p-2 text-[12px]">
                    {record.source_file ? (
                      <div className="text-[#555] mb-1 truncate">{String(record.source_file)}</div>
                    ) : record.display_name ? (
                      <div className="text-[#7cb3ff] mb-1 font-medium">{String(record.display_name)}</div>
                    ) : record.skill_id ? (
                      <div className="text-[#555] mb-1 font-mono">{String(record.skill_id)}</div>
                    ) : null}
                    <pre className="whitespace-pre-wrap break-words text-[#aaa] leading-relaxed">
                      {record.business_logic
                        ? String(record.business_logic)
                        : record.fields
                          ? JSON.stringify(record.fields, null, 2)
                          : JSON.stringify(record, null, 2)}
                    </pre>
                    {record.similarity !== undefined && (
                      <div className="mt-1 text-[11px] text-[#555]">
                        Similarity: {Number(record.similarity).toFixed(3)}
                        {record.overall_confidence !== undefined ? ` | Confidence: ${Number(record.overall_confidence).toFixed(2)}` : null}
                        {record.status ? ` | ${String(record.status)}` : null}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface ChatMessageProps {
  message: ChatMessageType;
  sources?: SourceRef[];
  isStreaming?: boolean;
}

export default function ChatMessage({
  message,
  sources,
  isStreaming = false,
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [message.content]);

  const toolCalls = message.toolCalls || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', damping: 28, stiffness: 280 }}
      className={`group/msg flex ${isUser ? 'justify-end' : 'justify-start'} mb-5`}
    >
      {!isUser && (
        <div className="w-7 h-7 rounded-[8px] bg-[#1a1a1a] flex items-center justify-center mr-3 mt-0.5 flex-shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </div>
      )}

      <div
        className={`${
          isUser
            ? 'max-w-[75%] bg-[#007aff] text-white rounded-[18px] rounded-br-[6px] px-4 py-2.5'
            : 'flex-1 min-w-0'
        }`}
      >
        {isUser ? (
          <p className="text-[15px] leading-[1.5]">{message.content}</p>
        ) : (
          <>
            {message.content && (
              <StreamingProvider isStreaming={isStreaming}>
                <MarkdownRenderer content={message.content} sources={sources} />
              </StreamingProvider>
            )}

            {!message.content && isStreaming && toolCalls.length === 0 && <LoadingDots />}

            {toolCalls.length > 0 && (
              <div className="my-1">
                {toolCalls.map((tc, i) => (
                  <ToolCallCard key={`${tc.name}-${i}`} tc={tc} />
                ))}
              </div>
            )}
          </>
        )}

        {isStreaming && message.content && (
          <motion.span
            animate={{ opacity: [1, 0] }}
            transition={{ duration: 0.5, repeat: Infinity }}
            className="inline-block w-[2px] h-[18px] bg-[#007aff] ml-0.5 rounded-full"
          />
        )}

        {!isUser && message.content && !isStreaming && (
          <div className="mt-2 opacity-0 group-hover/msg:opacity-100 transition-opacity">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-[#aeaeb2] hover:text-[#1a1a1a] hover:bg-[#f0f0f0] transition-all"
            >
              {copied ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  Copy response
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
