'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface EvalRun {
  id: string;
  org_id: string;
  run_label: string;
  run_type: string;
  skill_id: string | null;
  suite: string | null;
  total_items: number;
  passed: number;
  failed: number;
  missing: number;
  accuracy: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface EvalRunResult {
  id: string;
  run_id: string;
  item_key: string;
  field: string | null;
  category: string | null;
  status: string;
  score: number;
  expected: string | null;
  actual: string | null;
  delta: number | null;
  metadata: Record<string, unknown>;
}

function OperatorNav() {
  const pathname = usePathname();
  const tabs = [
    { label: 'Skills', href: '/operator/skills' },
    { label: 'Field Catalog', href: '/operator/fields' },
    { label: 'Doc Links', href: '/operator/doc-links' },
    { label: 'Chat Tools', href: '/operator/chat-tools' },
    { label: 'Context Cards', href: '/operator/context-cards' },
    { label: 'Evals', href: '/operator/evals' },
  ];

  return (
    <nav className="border-b border-[#e8e8e8] bg-[#fafafa]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center h-12 gap-8">
          <Link href="/operator/skills" className="text-[15px] font-semibold text-[#1a1a1a] tracking-tight">
            Operator Workbench
          </Link>
          <div className="flex items-center gap-1">
            {tabs.map(t => (
              <Link
                key={t.href}
                href={t.href}
                className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                  pathname?.startsWith(t.href) ? 'bg-[#1a1a1a] text-white' : 'text-[#666] hover:bg-[#eee]'
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pass: 'bg-green-50 text-green-700 border-green-200',
    fail: 'bg-red-50 text-red-700 border-red-200',
    missing: 'bg-amber-50 text-amber-700 border-amber-200',
    not_computable: 'bg-gray-50 text-gray-500 border-gray-200',
    error: 'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[11px] font-medium border ${colors[status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
      {status}
    </span>
  );
}

function AccuracyBar({ accuracy }: { accuracy: number }) {
  const pct = Math.round(accuracy * 100);
  const color = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-[#f0f0f0] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[12px] font-medium text-[#444]">{pct}%</span>
    </div>
  );
}

function MiniTrend({ runs }: { runs: EvalRun[] }) {
  if (runs.length < 2) return null;
  const sorted = [...runs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const last10 = sorted.slice(-10);
  const max = 1;
  const barWidth = 6;
  const gap = 2;
  const height = 24;
  const width = last10.length * (barWidth + gap);

  return (
    <svg width={width} height={height} className="inline-block ml-2 align-middle">
      {last10.map((r, i) => {
        const h = Math.max(2, (r.accuracy / max) * height);
        const color = r.accuracy >= 0.8 ? '#22c55e' : r.accuracy >= 0.5 ? '#f59e0b' : '#ef4444';
        return (
          <rect
            key={r.id}
            x={i * (barWidth + gap)}
            y={height - h}
            width={barWidth}
            height={h}
            rx={1}
            fill={color}
          >
            <title>{`${r.run_label}: ${Math.round(r.accuracy * 100)}%`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export default function EvalResultsPage() {
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<Record<string, EvalRunResult[]>>({});
  const [loadingResults, setLoadingResults] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/eval-runs');
      const data = await res.json();
      setRuns(data.runs || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  const handleExpandRun = async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);
    if (!runResults[runId]) {
      setLoadingResults(runId);
      try {
        const res = await fetch(`/api/eval-runs/${runId}`);
        const data = await res.json();
        setRunResults(prev => ({ ...prev, [runId]: data.results || [] }));
      } catch { /* ignore */ }
      setLoadingResults(null);
    }
  };

  const filteredRuns = useMemo(() => {
    if (typeFilter === 'all') return runs;
    return runs.filter(r => r.run_type === typeFilter);
  }, [runs, typeFilter]);

  const runTypes = useMemo(() => [...new Set(runs.map(r => r.run_type))].sort(), [runs]);

  const trendGroups = useMemo(() => {
    const groups: Record<string, EvalRun[]> = {};
    for (const r of runs) {
      const key = r.skill_id ? `${r.run_type}:${r.skill_id}` : r.run_type;
      (groups[key] ??= []).push(r);
    }
    return groups;
  }, [runs]);

  return (
    <div className="min-h-screen bg-white">
      <OperatorNav />

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Sub-nav for Evals section */}
        <div className="flex items-center gap-1 p-0.5 bg-[#f5f5f5] rounded-lg w-fit mb-6">
          <Link
            href="/operator/evals"
            className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors text-[#666] hover:text-[#333]"
          >
            Dataset
          </Link>
          <Link
            href="/operator/evals/results"
            className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors bg-white shadow-sm text-[#1a1a1a]"
          >
            Results
          </Link>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[20px] font-bold text-[#1a1a1a]">Eval Results</h1>
            <p className="text-[13px] text-[#999] mt-1">
              {runs.length} eval run{runs.length !== 1 ? 's' : ''}
              {Object.keys(trendGroups).length > 0 && (
                <span className="ml-2">
                  across {Object.keys(trendGroups).length} group{Object.keys(trendGroups).length !== 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={fetchRuns}
            className="px-4 py-2 border border-[#e0e0e0] text-[13px] font-medium text-[#555] rounded-lg hover:bg-[#f7f7f5] transition-colors"
          >
            Refresh
          </button>
        </div>

        {/* Accuracy trends */}
        {Object.keys(trendGroups).length > 0 && (
          <div className="mb-6 p-4 bg-[#fafafa] rounded-xl border border-[#e8e8e8]">
            <h3 className="text-[12px] font-semibold text-[#999] uppercase tracking-wider mb-3">Accuracy Trend</h3>
            <div className="flex flex-wrap gap-6">
              {Object.entries(trendGroups).map(([key, groupRuns]) => {
                const latestRun = groupRuns[0];
                return (
                  <div key={key} className="flex items-center gap-3">
                    <div>
                      <div className="text-[12px] font-medium text-[#444]">{key}</div>
                      <AccuracyBar accuracy={latestRun.accuracy} />
                    </div>
                    <MiniTrend runs={groupRuns} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Type filter */}
        {runTypes.length > 1 && (
          <div className="flex items-center gap-1 p-0.5 bg-[#f5f5f5] rounded-lg w-fit mb-4">
            <button
              onClick={() => setTypeFilter('all')}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                typeFilter === 'all' ? 'bg-white shadow-sm text-[#1a1a1a]' : 'text-[#666] hover:text-[#333]'
              }`}
            >
              All ({runs.length})
            </button>
            {runTypes.map(t => {
              const count = runs.filter(r => r.run_type === t).length;
              return (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                    typeFilter === t ? 'bg-white shadow-sm text-[#1a1a1a]' : 'text-[#666] hover:text-[#333]'
                  }`}
                >
                  {t} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Runs table */}
        {loading ? (
          <div className="text-center py-16 text-[#999] text-sm">Loading...</div>
        ) : filteredRuns.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[#999] text-sm">No eval runs found.</p>
            <p className="text-[#bbb] text-xs mt-1">Run eval scripts to generate results.</p>
          </div>
        ) : (
          <div className="border border-[#e8e8e8] rounded-lg overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-[#fafafa] text-[11px] font-semibold text-[#999] uppercase tracking-wider">
                  <th className="text-left px-4 py-2.5 w-8" />
                  <th className="text-left px-4 py-2.5">Run Label</th>
                  <th className="text-left px-4 py-2.5 w-28">Type</th>
                  <th className="text-left px-4 py-2.5 w-28">Suite</th>
                  <th className="text-left px-4 py-2.5 w-36">Skill / Project</th>
                  <th className="text-center px-4 py-2.5 w-28">Accuracy</th>
                  <th className="text-center px-4 py-2.5 w-16">Pass</th>
                  <th className="text-center px-4 py-2.5 w-16">Fail</th>
                  <th className="text-center px-4 py-2.5 w-20">Missing</th>
                  <th className="text-center px-4 py-2.5 w-16">Total</th>
                  <th className="text-left px-4 py-2.5 w-40">Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    expanded={expandedRunId === run.id}
                    results={runResults[run.id]}
                    loadingResults={loadingResults === run.id}
                    onToggle={() => handleExpandRun(run.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function RunRow({ run, expanded, results, loadingResults, onToggle }: {
  run: EvalRun;
  expanded: boolean;
  results?: EvalRunResult[];
  loadingResults: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="border-t border-[#f0f0f0] hover:bg-[#fafafa] cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-4 py-2.5 text-[#999]">
          <svg
            width="10" height="10" viewBox="0 0 10 10"
            className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            <path d="M3 1L7 5L3 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </td>
        <td className="px-4 py-2.5 font-mono text-[12px] text-[#444]">{run.run_label}</td>
        <td className="px-4 py-2.5">
          <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
            run.run_type === 'chat' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'
          }`}>
            {run.run_type}
          </span>
        </td>
        <td className="px-4 py-2.5 text-[#666]">{run.suite || '—'}</td>
        <td className="px-4 py-2.5">
          <div className="text-[12px] text-[#444] font-medium">{run.skill_id || '—'}</div>
          {!!(run.metadata as Record<string, unknown>)?.projectId && (
            <div className="text-[11px] text-[#999]">{String((run.metadata as Record<string, unknown>).projectId)}</div>
          )}
        </td>
        <td className="px-4 py-2.5">
          <AccuracyBar accuracy={run.accuracy} />
        </td>
        <td className="px-4 py-2.5 text-center text-green-600 font-medium">{run.passed}</td>
        <td className="px-4 py-2.5 text-center text-red-600 font-medium">{run.failed}</td>
        <td className="px-4 py-2.5 text-center text-amber-600 font-medium">{run.missing}</td>
        <td className="px-4 py-2.5 text-center text-[#666]">{run.total_items}</td>
        <td className="px-4 py-2.5 text-[#999] text-[12px]">
          {run.created_at ? new Date(run.created_at).toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          }) : '—'}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={11} className="bg-[#fafafa] px-4 py-4">
            {loadingResults ? (
              <div className="text-center py-6 text-[#999] text-sm">Loading results...</div>
            ) : !results || results.length === 0 ? (
              <div className="text-center py-6 text-[#999] text-sm">No per-item results recorded.</div>
            ) : (
              <RunResultsDetail results={results} />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function RunResultsDetail({ results }: { results: EvalRunResult[] }) {
  const grouped = useMemo(() => {
    const groups: Record<string, EvalRunResult[]> = {};
    for (const r of results) {
      const key = r.category || r.field || 'Uncategorized';
      (groups[key] ??= []).push(r);
    }
    return groups;
  }, [results]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of results) {
      counts[r.status] = (counts[r.status] || 0) + 1;
    }
    return counts;
  }, [results]);

  return (
    <div>
      {/* Summary bar */}
      <div className="flex items-center gap-4 mb-4 text-[12px]">
        <span className="text-[#999] font-medium">{results.length} items</span>
        {Object.entries(statusCounts).map(([status, count]) => (
          <span key={status} className="flex items-center gap-1">
            <StatusBadge status={status} />
            <span className="text-[#666]">{count}</span>
          </span>
        ))}
      </div>

      {/* Grouped results */}
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} className="mb-4 last:mb-0">
          <h4 className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-2">{category}</h4>
          <div className="border border-[#e0e0e0] rounded-lg overflow-hidden bg-white">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-[#f5f5f5] text-[10px] font-semibold text-[#999] uppercase tracking-wider">
                  <th className="text-left px-3 py-2">Item Key</th>
                  <th className="text-left px-3 py-2">Field</th>
                  <th className="text-center px-3 py-2 w-20">Status</th>
                  <th className="text-center px-3 py-2 w-16">Score</th>
                  <th className="text-left px-3 py-2">Expected</th>
                  <th className="text-left px-3 py-2">Actual</th>
                  <th className="text-right px-3 py-2 w-20">Delta</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-t border-[#f0f0f0]">
                    <td className="px-3 py-1.5 font-mono text-[11px] text-[#555] max-w-[160px] truncate" title={r.item_key}>{r.item_key}</td>
                    <td className="px-3 py-1.5 text-[#666]">{r.field || '—'}</td>
                    <td className="px-3 py-1.5 text-center"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-1.5 text-center font-mono text-[11px] text-[#444]">{r.score.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-[#666] max-w-[180px] truncate" title={r.expected || ''}>{r.expected || '—'}</td>
                    <td className="px-3 py-1.5 text-[#666] max-w-[180px] truncate" title={r.actual || ''}>{r.actual || '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-[11px]">
                      {r.delta != null ? (
                        <span className={r.delta === 0 ? 'text-green-600' : 'text-red-600'}>
                          {r.delta > 0 ? '+' : ''}{r.delta.toFixed(4)}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
