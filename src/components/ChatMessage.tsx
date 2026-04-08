'use client';

import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChatMessage as ChatMessageType, SourceRef, ToolCallEntry } from '@/lib/types';
import MarkdownRenderer from './MarkdownRenderer';
import { StreamingProvider } from './DataTable';
import LoadingDots from './LoadingDots';

interface ParsedRecord {
  source_file: string | null;
  document_type: string | null;
  skill_id: string | null;
  similarity: number | null;
  overall_confidence: number | null;
  status: string | null;
  keyFields: { label: string; value: string; confidence: number }[];
  allFields: Record<string, unknown>;
}

function parseRecord(raw: Record<string, unknown>): ParsedRecord {
  const fields = (raw.fields || {}) as Record<string, unknown>;
  const keyFields: ParsedRecord['keyFields'] = [];

  for (const [key, val] of Object.entries(fields)) {
    if (val && typeof val === 'object' && 'value' in (val as Record<string, unknown>)) {
      const f = val as { value: unknown; confidence?: number };
      if (f.value === null || f.value === undefined) continue;
      const conf = typeof f.confidence === 'number' ? f.confidence : 0;
      if (conf < 0.1) continue;
      keyFields.push({
        label: key.replace(/_/g, ' '),
        value: typeof f.value === 'number'
          ? f.value.toLocaleString('en-US', f.value > 100 ? { style: 'currency', currency: 'USD', maximumFractionDigits: 0 } : { maximumFractionDigits: 2 })
          : String(f.value),
        confidence: conf,
      });
    }
  }

  keyFields.sort((a, b) => b.confidence - a.confidence);

  return {
    source_file: raw.source_file ? String(raw.source_file) : null,
    document_type: raw.document_type ? String(raw.document_type) : null,
    skill_id: raw.skill_id ? String(raw.skill_id) : null,
    similarity: typeof raw.similarity === 'number' ? raw.similarity : null,
    overall_confidence: typeof raw.overall_confidence === 'number' ? raw.overall_confidence : null,
    status: raw.status ? String(raw.status) : null,
    keyFields,
    allFields: fields,
  };
}

function ConfidenceBadge({ value }: { value: number }) {
  const color = value >= 0.85 ? 'bg-emerald-500/20 text-emerald-400'
    : value >= 0.7 ? 'bg-yellow-500/20 text-yellow-400'
    : 'bg-red-500/20 text-red-400';
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${color}`}>
      {Math.round(value * 100)}%
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = status === 'approved' || status === 'pushed'
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
    : status === 'pending'
    ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20'
    : 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20';
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] font-medium ${color}`}>
      {status}
    </span>
  );
}

function RecordCard({ record, index }: { record: ParsedRecord; index: number }) {
  const [showRaw, setShowRaw] = useState(false);
  const topFields = record.keyFields.slice(0, 8);
  const hasMore = record.keyFields.length > 8;

  return (
    <div className="rounded-lg bg-[#0a0a0a] border border-[#1f1f1f] overflow-hidden">
      {/* Source file header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0f0f0f] border-b border-[#1a1a1a]">
        <svg className="w-3.5 h-3.5 text-[#555] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span className="text-[11px] text-[#888] truncate flex-1 font-mono">
          {record.source_file || `Record ${index + 1}`}
        </span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {record.status ? <StatusBadge status={record.status} /> : null}
          {record.overall_confidence !== null ? <ConfidenceBadge value={record.overall_confidence} /> : null}
          {record.similarity !== null ? (
            <span className="text-[10px] text-[#555] font-mono">
              {(record.similarity * 100).toFixed(0)}% match
            </span>
          ) : null}
        </div>
      </div>

      {/* Key extracted fields */}
      <div className="px-3 py-2">
        {topFields.length > 0 ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {topFields.map((f, i) => (
              <div key={i} className="flex items-baseline gap-1.5 min-w-0">
                <span className="text-[11px] text-[#555] capitalize flex-shrink-0 truncate max-w-[40%]">{f.label}</span>
                <span className="text-[11px] text-[#ccc] truncate">{f.value}</span>
                {f.confidence < 0.7 && (
                  <span className="text-[10px] text-yellow-500 flex-shrink-0">⚠️</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <span className="text-[11px] text-[#444]">No extracted fields</span>
        )}
        {hasMore && !showRaw && (
          <button onClick={() => setShowRaw(true)} className="text-[10px] text-[#007aff] mt-1.5 hover:underline">
            +{record.keyFields.length - 8} more fields
          </button>
        )}
      </div>

      {/* Raw JSON toggle */}
      <div className="border-t border-[#1a1a1a] px-3 py-1">
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="text-[10px] text-[#555] hover:text-[#888] transition-colors flex items-center gap-1"
        >
          <svg className={`w-3 h-3 transition-transform ${showRaw ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
          Raw data
        </button>
        <AnimatePresence>
          {showRaw && (
            <motion.pre
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="text-[10px] text-[#666] whitespace-pre-wrap break-words mt-1 max-h-[200px] overflow-y-auto font-mono leading-relaxed"
            >
              {JSON.stringify(record.allFields, null, 2)}
            </motion.pre>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SourceSummary({ records }: { records: ParsedRecord[] }) {
  const sources = useMemo(() => {
    const map = new Map<string, { count: number; types: Set<string> }>();
    for (const r of records) {
      const file = r.source_file || 'Unknown';
      const entry = map.get(file) || { count: 0, types: new Set<string>() };
      entry.count++;
      if (r.document_type) entry.types.add(r.document_type);
      map.set(file, entry);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10);
  }, [records]);

  if (sources.length === 0) return null;

  return (
    <div className="px-3 py-2 border-b border-[#1a1a1a]">
      <div className="text-[11px] text-[#555] font-medium mb-1.5 uppercase tracking-wider">
        Source Documents ({sources.length})
      </div>
      <div className="space-y-1">
        {sources.map(([file, info], i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <svg className="w-3 h-3 text-[#444] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="text-[#999] truncate font-mono">{file}</span>
            <span className="text-[#444] flex-shrink-0">
              {info.count} record{info.count > 1 ? 's' : ''}
              {info.types.size > 0 ? ` · ${Array.from(info.types).join(', ')}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolCallCard({ tc }: { tc: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  const label = tc.displayName || tc.name.replace(/_/g, ' ');
  const query = typeof tc.input?.query === 'string'
    ? tc.input.query
    : typeof tc.input?.search_term === 'string'
    ? tc.input.search_term
    : null;

  let resultArr: Record<string, unknown>[] = [];
  let summary: string | null = null;

  if (tc.result && typeof tc.result === 'object') {
    const res = tc.result as Record<string, unknown>;
    if (Array.isArray(res.records)) {
      resultArr = res.records as Record<string, unknown>[];
      summary = typeof res._summary === 'string' ? res._summary : null;
    } else if (Array.isArray(tc.result)) {
      resultArr = tc.result as Record<string, unknown>[];
    }
  }

  const parsedRecords = useMemo(() => resultArr.map(parseRecord), [resultArr]);
  const count = tc.resultCount ?? resultArr.length;
  const hasError = tc.status === 'error' || (tc.result && typeof tc.result === 'object' && 'error' in (tc.result as Record<string, unknown>));
  const errorMsg = hasError && tc.result && typeof tc.result === 'object'
    ? String((tc.result as Record<string, unknown>).error || '')
    : null;

  return (
    <div className="my-2 rounded-lg border border-[#2a2a2a] bg-[#111111] text-[13px] overflow-hidden">
      <button
        onClick={() => tc.status === 'done' && setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#1a1a1a] transition-colors"
      >
        {tc.status === 'calling' ? (
          <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
            <span className="block w-3 h-3 rounded-full border-2 border-[#007aff] border-t-transparent animate-spin" />
          </span>
        ) : hasError ? (
          <svg className="w-4 h-4 text-red-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
        ) : (
          <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
        )}

        <span className="font-medium text-[#e0e0e0] capitalize">{label}</span>

        {tc.status === 'done' && (
          <span className="text-[#666] ml-auto flex items-center gap-1.5">
            {summary || (count !== undefined ? `${count} record${count !== 1 ? 's' : ''}` : '')}
            <svg className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
          </span>
        )}

        {tc.status === 'calling' && (
          <span className="text-[#666] ml-auto">Searching...</span>
        )}
      </button>

      {query && (
        <div className="px-3 pb-2 text-[12px] text-[#777] border-t border-[#222]">
          <span className="text-[#555]">Query:</span> {query}
        </div>
      )}

      {Boolean(hasError) && errorMsg ? (
        <div className="px-3 py-2 text-[12px] text-red-400/80 border-t border-[#222] bg-red-500/5">
          {errorMsg}
        </div>
      ) : null}

      <AnimatePresence>
        {expanded && parsedRecords.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-[#222]"
          >
            <SourceSummary records={parsedRecords} />

            <div className="max-h-[400px] overflow-y-auto p-3 space-y-2">
              {parsedRecords.map((record, i) => (
                <RecordCard key={i} record={record} index={i} />
              ))}
            </div>
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
