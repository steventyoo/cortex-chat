'use client';

import { useState, useEffect, useCallback } from 'react';

interface ReconciliationResult {
  id: string;
  rule_id: string;
  match_key_value: string;
  source_value: number | null;
  target_value: number | null;
  difference: number | null;
  difference_pct: number | null;
  status: 'pass' | 'warning' | 'fail' | 'no_match';
  message: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  run_id: string;
  created_at: string;
  source_record_id: string | null;
  target_record_id: string | null;
  reconciliation_rules: {
    rule_name: string;
    link_type_key: string;
    severity: string;
    source_field: string;
    target_field: string;
    match_key: string;
  } | null;
}

interface ReconciliationSummary {
  total: number;
  pass: number;
  warning: number;
  fail: number;
  no_match: number;
}

interface ReconciliationPanelProps {
  projectId: string | null;
}

type FilterStatus = 'all' | 'pass' | 'warning' | 'fail' | 'no_match';

export default function ReconciliationPanel({ projectId }: ReconciliationPanelProps) {
  const [results, setResults] = useState<ReconciliationResult[]>([]);
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState('');
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
  const [lastRunTime, setLastRunTime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchResults = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ projectId });
      if (filterStatus !== 'all') params.set('status', filterStatus);
      const res = await fetch(`/api/reconciliation/results?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResults(data.results || []);
      setSummary(data.summary || null);
      if (data.results?.length > 0) {
        setLastRunTime(data.results[0].created_at);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load results');
    } finally {
      setLoading(false);
    }
  }, [projectId, filterStatus]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  const runReconciliation = async () => {
    if (!projectId || running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/reconciliation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error(await res.text());
      await fetchResults();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reconciliation failed');
    } finally {
      setRunning(false);
    }
  };

  const resolveResult = async (resultId: string) => {
    setResolvingIds(prev => new Set(prev).add(resultId));
    try {
      const res = await fetch('/api/reconciliation/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resultIds: [resultId], note: resolveNote }),
      });
      if (!res.ok) throw new Error(await res.text());
      setResolveNote('');
      setExpandedId(null);
      await fetchResults();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve');
    } finally {
      setResolvingIds(prev => {
        const next = new Set(prev);
        next.delete(resultId);
        return next;
      });
    }
  };

  const resolveAll = async (status: 'warning' | 'fail') => {
    const ids = results
      .filter(r => r.status === status && !r.resolved_by)
      .map(r => r.id);
    if (ids.length === 0) return;
    setResolvingIds(prev => new Set([...prev, ...ids]));
    try {
      const res = await fetch('/api/reconciliation/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resultIds: ids, note: `Bulk resolved all ${status} items` }),
      });
      if (!res.ok) throw new Error(await res.text());
      await fetchResults();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to bulk resolve');
    } finally {
      setResolvingIds(new Set());
    }
  };

  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-12 h-12 rounded-xl bg-[#f5f5f5] flex items-center justify-center mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="2" />
            <path d="M9 14l2 2 4-4" />
          </svg>
        </div>
        <p className="text-[14px] text-[#666] mb-1">Select a project from the dropdown</p>
        <p className="text-[12px] text-[#999]">Reconciliation compares data across linked document types within a project</p>
      </div>
    );
  }

  const filtered = filterStatus === 'all' ? results : results.filter(r => r.status === filterStatus);

  const groupedByRule = filtered.reduce<Record<string, ReconciliationResult[]>>((acc, r) => {
    const key = r.reconciliation_rules?.rule_name || r.rule_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  return (
    <div className="min-h-[400px]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[#e8e8e8] flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-semibold text-[#1a1a1a]">Reconciliation Checks</h3>
          {lastRunTime && (
            <p className="text-[11px] text-[#999] mt-0.5">
              Last run: {new Date(lastRunTime).toLocaleString()}
            </p>
          )}
        </div>
        <button
          onClick={runReconciliation}
          disabled={running}
          className="px-3.5 py-1.5 bg-[#1a1a1a] text-white text-[12px] font-medium rounded-lg hover:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
        >
          {running ? (
            <>
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" />
              </svg>
              Running...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path d="M10 8l6 4-6 4V8z" />
              </svg>
              Run Reconciliation
            </>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-[13px] text-red-700 flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="px-6 py-4 grid grid-cols-5 gap-3">
          <SummaryCard label="Total Checks" value={summary.total} color="#666" active={filterStatus === 'all'} onClick={() => setFilterStatus('all')} />
          <SummaryCard label="Passed" value={summary.pass} color="#22c55e" active={filterStatus === 'pass'} onClick={() => setFilterStatus('pass')} />
          <SummaryCard label="Warnings" value={summary.warning} color="#f59e0b" active={filterStatus === 'warning'} onClick={() => setFilterStatus('warning')}
            onResolveAll={summary.warning > 0 ? () => resolveAll('warning') : undefined} />
          <SummaryCard label="Failures" value={summary.fail} color="#ef4444" active={filterStatus === 'fail'} onClick={() => setFilterStatus('fail')}
            onResolveAll={summary.fail > 0 ? () => resolveAll('fail') : undefined} />
          <SummaryCard label="No Match" value={summary.no_match} color="#94a3b8" active={filterStatus === 'no_match'} onClick={() => setFilterStatus('no_match')} />
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <svg className="animate-spin w-5 h-5 text-[#999]" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" />
          </svg>
          <span className="ml-2 text-[13px] text-[#999]">Loading reconciliation results...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && results.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-xl bg-[#f5f5f5] flex items-center justify-center mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
              <rect x="9" y="3" width="6" height="4" rx="2" />
              <path d="M9 14l2 2 4-4" />
            </svg>
          </div>
          <p className="text-[14px] text-[#666] mb-1">No reconciliation results yet</p>
          <p className="text-[12px] text-[#999] mb-4">Click &quot;Run Reconciliation&quot; to compare data across document types</p>
        </div>
      )}

      {/* Results grouped by rule */}
      {!loading && Object.keys(groupedByRule).length > 0 && (
        <div className="px-6 pb-6 space-y-4">
          {Object.entries(groupedByRule).map(([ruleName, ruleResults]) => {
            const passCount = ruleResults.filter(r => r.status === 'pass').length;
            const warnCount = ruleResults.filter(r => r.status === 'warning').length;
            const failCount = ruleResults.filter(r => r.status === 'fail').length;
            const noMatchCount = ruleResults.filter(r => r.status === 'no_match').length;
            const linkType = ruleResults[0]?.reconciliation_rules?.link_type_key || '';

            return (
              <div key={ruleName} className="border border-[#e8e8e8] rounded-lg overflow-hidden">
                {/* Rule header */}
                <div className="px-4 py-3 bg-[#fafafa] border-b border-[#e8e8e8] flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-[#1a1a1a]">{ruleName}</div>
                    <div className="text-[11px] text-[#999] mt-0.5">{formatLinkType(linkType)}</div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-medium flex-shrink-0">
                    {passCount > 0 && <span className="px-2 py-0.5 bg-green-50 text-green-700 rounded-full">{passCount} pass</span>}
                    {warnCount > 0 && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full">{warnCount} warn</span>}
                    {failCount > 0 && <span className="px-2 py-0.5 bg-red-50 text-red-700 rounded-full">{failCount} fail</span>}
                    {noMatchCount > 0 && <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">{noMatchCount} no match</span>}
                  </div>
                </div>

                {/* Results table */}
                <div className="divide-y divide-[#f0f0f0]">
                  {/* Column headers */}
                  <div className="px-4 py-2 flex items-center gap-3 text-[10px] font-semibold text-[#999] uppercase tracking-wider bg-[#fafafa]">
                    <div className="w-16 flex-shrink-0">Status</div>
                    <div className="w-24 flex-shrink-0">Match Key</div>
                    <div className="w-28 flex-shrink-0 text-right">Source</div>
                    <div className="w-28 flex-shrink-0 text-right">Target</div>
                    <div className="w-24 flex-shrink-0 text-right">Diff %</div>
                    <div className="flex-1 min-w-0">Details</div>
                    <div className="w-20 flex-shrink-0 text-center">Action</div>
                  </div>

                  {ruleResults.map(result => {
                    const isExpanded = expandedId === result.id;
                    const isResolving = resolvingIds.has(result.id);
                    const isResolved = !!result.resolved_by;

                    return (
                      <div key={result.id}>
                        <div
                          className={`px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-[#fafafa] transition-colors ${isExpanded ? 'bg-[#f7f7f5]' : ''}`}
                          onClick={() => setExpandedId(isExpanded ? null : result.id)}
                        >
                          <div className="w-16 flex-shrink-0">
                            <StatusBadge status={result.status} resolved={isResolved} />
                          </div>
                          <div className="w-24 flex-shrink-0 text-[12px] text-[#444] font-mono truncate" title={result.match_key_value}>
                            {result.match_key_value === '*' ? '—' : result.match_key_value}
                          </div>
                          <div className="w-28 flex-shrink-0 text-right text-[12px] font-mono text-[#444]">
                            {formatCurrency(result.source_value)}
                          </div>
                          <div className="w-28 flex-shrink-0 text-right text-[12px] font-mono text-[#444]">
                            {formatCurrency(result.target_value)}
                          </div>
                          <div className={`w-24 flex-shrink-0 text-right text-[12px] font-mono ${getDiffColor(result.status)}`}>
                            {result.difference_pct != null ? `${result.difference_pct.toFixed(1)}%` : '—'}
                          </div>
                          <div className="flex-1 min-w-0 text-[12px] text-[#666] truncate">
                            {result.message}
                          </div>
                          <div className="w-20 flex-shrink-0 text-center">
                            {(result.status === 'warning' || result.status === 'fail') && !isResolved && (
                              <button
                                onClick={e => { e.stopPropagation(); setExpandedId(result.id); }}
                                className="text-[11px] text-[#0066cc] hover:text-[#004499] font-medium"
                              >
                                Resolve
                              </button>
                            )}
                            {isResolved && (
                              <span className="text-[11px] text-green-600 font-medium">Resolved</span>
                            )}
                          </div>
                        </div>

                        {/* Expanded detail + resolve form */}
                        {isExpanded && (
                          <div className="px-4 py-3 bg-[#f7f7f5] border-t border-[#e8e8e8]">
                            <div className="grid grid-cols-2 gap-4 mb-3">
                              <DetailRow label="Source Field" value={result.reconciliation_rules?.source_field || '—'} />
                              <DetailRow label="Target Field" value={result.reconciliation_rules?.target_field || '—'} />
                              <DetailRow label="Match Key" value={result.reconciliation_rules?.match_key || '—'} />
                              <DetailRow label="Link Type" value={formatLinkType(result.reconciliation_rules?.link_type_key || '')} />
                              <DetailRow label="Source Value" value={formatCurrency(result.source_value)} />
                              <DetailRow label="Target Value" value={formatCurrency(result.target_value)} />
                              <DetailRow label="Difference" value={result.difference != null ? formatCurrency(result.difference) : '—'} />
                              <DetailRow label="Run ID" value={result.run_id.slice(0, 8)} mono />
                            </div>

                            {isResolved ? (
                              <div className="mt-3 px-3 py-2.5 bg-green-50 border border-green-100 rounded-lg">
                                <div className="flex items-center gap-2 text-[12px] text-green-700 font-medium">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                                    <polyline points="22 4 12 14.01 9 11.01" />
                                  </svg>
                                  Resolved by {result.resolved_by} on {new Date(result.resolved_at!).toLocaleString()}
                                </div>
                                {result.resolution_note && (
                                  <p className="text-[12px] text-green-600 mt-1">{result.resolution_note}</p>
                                )}
                              </div>
                            ) : (result.status === 'warning' || result.status === 'fail') && (
                              <div className="mt-3 flex items-center gap-2">
                                <input
                                  type="text"
                                  value={resolveNote}
                                  onChange={e => setResolveNote(e.target.value)}
                                  placeholder="Resolution note (optional)..."
                                  className="flex-1 px-3 py-1.5 border border-[#ddd] rounded-lg text-[12px] focus:outline-none focus:border-[#666] transition-colors"
                                  onClick={e => e.stopPropagation()}
                                />
                                <button
                                  onClick={e => { e.stopPropagation(); resolveResult(result.id); }}
                                  disabled={isResolving}
                                  className="px-3 py-1.5 bg-green-600 text-white text-[12px] font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors flex-shrink-0"
                                >
                                  {isResolving ? 'Resolving...' : 'Mark Resolved'}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color, active, onClick, onResolveAll }: {
  label: string; value: number; color: string; active: boolean;
  onClick: () => void; onResolveAll?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative px-4 py-3 rounded-lg border text-left transition-all ${
        active
          ? 'border-[#1a1a1a] bg-[#fafafa] shadow-sm'
          : 'border-[#e8e8e8] bg-white hover:border-[#ccc]'
      }`}
    >
      <div className="text-[22px] font-bold" style={{ color }}>{value}</div>
      <div className="text-[11px] text-[#999] font-medium">{label}</div>
      {onResolveAll && value > 0 && (
        <button
          onClick={e => { e.stopPropagation(); onResolveAll(); }}
          className="absolute top-2 right-2 text-[10px] text-[#999] hover:text-[#666] underline"
        >
          Resolve all
        </button>
      )}
    </button>
  );
}

function StatusBadge({ status, resolved }: { status: string; resolved: boolean }) {
  if (resolved) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-700 text-[10px] font-semibold rounded-full">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
      Done
    </span>;
  }
  const cfg: Record<string, { bg: string; text: string; label: string }> = {
    pass: { bg: 'bg-green-50', text: 'text-green-700', label: 'Pass' },
    warning: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Warn' },
    fail: { bg: 'bg-red-50', text: 'text-red-700', label: 'Fail' },
    no_match: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'N/A' },
  };
  const c = cfg[status] || cfg.no_match;
  return <span className={`inline-block px-2 py-0.5 ${c.bg} ${c.text} text-[10px] font-semibold rounded-full`}>{c.label}</span>;
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-[#999] uppercase tracking-wider mb-0.5">{label}</div>
      <div className={`text-[12px] text-[#444] ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

function formatCurrency(val: number | null): string {
  if (val == null) return '—';
  const abs = Math.abs(val);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return val < 0 ? `-$${formatted}` : `$${formatted}`;
}

function getDiffColor(status: string): string {
  switch (status) {
    case 'pass': return 'text-green-600';
    case 'warning': return 'text-amber-600';
    case 'fail': return 'text-red-600';
    default: return 'text-[#999]';
  }
}

function formatLinkType(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
