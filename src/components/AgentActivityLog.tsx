'use client';

import { useState, useEffect } from 'react';

interface ActivityEntry {
  round: number;
  timestamp: string;
  type: 'reasoning' | 'tool_call' | 'tool_result' | 'status';
  content: string;
  toolName?: string;
}

interface AgentLogData {
  activityLog: ActivityEntry[] | null;
  bestScript: string | null;
  compositeScore: number | null;
  rounds: number | null;
  toolCalls: number | null;
}

const TYPE_STYLES: Record<ActivityEntry['type'], { bg: string; label: string; icon: string }> = {
  reasoning: { bg: 'bg-blue-50 border-blue-200', label: 'Thinking', icon: '🧠' },
  tool_call: { bg: 'bg-amber-50 border-amber-200', label: 'Tool Call', icon: '🔧' },
  tool_result: { bg: 'bg-green-50 border-green-200', label: 'Result', icon: '📋' },
  status: { bg: 'bg-gray-50 border-gray-200', label: 'Status', icon: '📌' },
};

export default function AgentActivityLog({ pipelineLogId }: { pipelineLogId: string }) {
  const [data, setData] = useState<AgentLogData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set());
  const [showScript, setShowScript] = useState(false);
  const [filterType, setFilterType] = useState<ActivityEntry['type'] | 'all'>('all');

  useEffect(() => {
    if (!expanded) return;
    setLoading(true);
    fetch(`/api/pipeline/agent-log?id=${pipelineLogId}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [pipelineLogId, expanded]);

  const log = data?.activityLog;
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full text-left px-4 py-2.5 bg-[#f7f7f5] border border-[#e8e8e8] rounded-lg text-[12px] font-medium text-[#555] hover:bg-[#eee] transition-colors flex items-center gap-2"
      >
        <span>🤖</span>
        <span>Agent Activity Log</span>
        <span className="ml-auto text-[11px] text-[#999]">Click to expand</span>
      </button>
    );
  }

  return (
    <div className="border border-[#e8e8e8] rounded-lg overflow-hidden">
      <div
        className="px-4 py-2.5 bg-[#f7f7f5] border-b border-[#e8e8e8] flex items-center gap-2 cursor-pointer"
        onClick={() => setExpanded(false)}
      >
        <span>🤖</span>
        <span className="text-[12px] font-semibold text-[#37352f]">Agent Activity Log</span>
        {data && (
          <div className="ml-auto flex items-center gap-3 text-[11px] text-[#777]">
            {data.rounds != null && <span>{data.rounds} rounds</span>}
            {data.toolCalls != null && <span>{data.toolCalls} tool calls</span>}
            {data.compositeScore != null && (
              <span className={data.compositeScore >= 90 ? 'text-green-600' : data.compositeScore >= 70 ? 'text-amber-600' : 'text-red-600'}>
                {data.compositeScore}% quality
              </span>
            )}
          </div>
        )}
        <span className="text-[11px] text-[#999]">▲</span>
      </div>

      <div className="max-h-[500px] overflow-y-auto">
        {loading && (
          <div className="p-4 text-center text-[12px] text-[#999]">Loading agent activity...</div>
        )}

        {!loading && !log && (
          <div className="p-4 text-center text-[12px] text-[#999]">No agent activity log for this document.</div>
        )}

        {!loading && log && log.length > 0 && (
          <>
            <div className="px-3 py-2 border-b border-[#e8e8e8] flex items-center gap-1.5 bg-white">
              {(['all', 'reasoning', 'tool_call', 'tool_result', 'status'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    filterType === t ? 'bg-[#37352f] text-white' : 'bg-[#f0f0ef] text-[#555] hover:bg-[#e0e0de]'
                  }`}
                >
                  {t === 'all' ? 'All' : TYPE_STYLES[t].label}
                </button>
              ))}
              {data.bestScript && (
                <button
                  onClick={() => setShowScript(!showScript)}
                  className="ml-auto px-2 py-0.5 rounded text-[10px] font-medium bg-[#f0f0ef] text-[#555] hover:bg-[#e0e0de] transition-colors"
                >
                  {showScript ? 'Hide Script' : 'View Final Script'}
                </button>
              )}
            </div>

            {showScript && data.bestScript && (
              <div className="border-b border-[#e8e8e8] bg-[#1e1e1e]">
                <pre className="p-3 text-[11px] text-[#d4d4d4] overflow-x-auto max-h-[300px] overflow-y-auto font-mono leading-relaxed">
                  {data.bestScript}
                </pre>
              </div>
            )}

            <div className="divide-y divide-[#f0f0ef]">
              {log
                .filter(e => filterType === 'all' || e.type === filterType)
                .map((entry, idx) => {
                  const style = TYPE_STYLES[entry.type];
                  const isLong = entry.content.length > 200;
                  const isExpanded = expandedEntries.has(idx);

                  return (
                    <div key={idx} className={`px-3 py-2 ${style.bg} border-l-2`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[10px]">{style.icon}</span>
                        <span className="text-[10px] font-semibold text-[#555]">R{entry.round}</span>
                        <span className="text-[10px] font-medium text-[#777]">{style.label}</span>
                        {entry.toolName && (
                          <code className="text-[10px] bg-white/60 px-1 py-0.5 rounded font-mono text-[#555]">
                            {entry.toolName}
                          </code>
                        )}
                        <span className="ml-auto text-[9px] text-[#aaa]">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <pre
                        className="text-[11px] text-[#37352f] whitespace-pre-wrap font-mono leading-relaxed cursor-pointer"
                        onClick={() => {
                          if (!isLong) return;
                          setExpandedEntries(prev => {
                            const next = new Set(prev);
                            if (next.has(idx)) next.delete(idx); else next.add(idx);
                            return next;
                          });
                        }}
                      >
                        {isLong && !isExpanded ? entry.content.slice(0, 200) + '...' : entry.content}
                      </pre>
                      {isLong && (
                        <button
                          onClick={() => setExpandedEntries(prev => {
                            const next = new Set(prev);
                            if (next.has(idx)) next.delete(idx); else next.add(idx);
                            return next;
                          })}
                          className="text-[10px] text-blue-500 hover:underline mt-0.5"
                        >
                          {isExpanded ? 'Show less' : 'Show more'}
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
