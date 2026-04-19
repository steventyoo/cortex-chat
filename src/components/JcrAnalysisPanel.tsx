'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

interface ExportRow {
  id: string;
  tab: string;
  section: string;
  record_key: string;
  canonical_name: string;
  display_name: string;
  data_type: string;
  status: string;
  value_text: string | null;
  value_number: number | null;
  notes: string | null;
}

const TABS = [
  'Overview', 'Budget vs Actual', 'Material', 'Cost Breakdown',
  'Crew Labor', 'Crew Analytics', 'Productivity', 'Benchmark KPIs',
  'Insights', 'Reconciliation',
];

function fmt(val: number | null, type: string): string {
  if (val == null) return '—';
  if (type === 'currency') return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (type === 'percent') return `${val.toFixed(2)}%`;
  if (type === 'integer') return Math.round(val).toLocaleString();
  if (type === 'ratio') return val.toFixed(2);
  return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function downloadCsv(rows: ExportRow[], tabName: string) {
  const header = ['Field', 'Value', 'Type', 'Status', 'Section', 'Notes'];
  const csvRows = rows.map(r => [
    r.display_name,
    r.value_text || (r.value_number != null ? String(r.value_number) : ''),
    r.data_type,
    r.status,
    r.section,
    r.notes || '',
  ]);
  const csv = [header, ...csvRows].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jcr-${tabName.toLowerCase().replace(/\s+/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function JcrAnalysisPanel({ projectId }: { projectId: string | null }) {
  const [rows, setRows] = useState<ExportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('Overview');
  const [runLoading, setRunLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/jcr-export?projectId=${encodeURIComponent(projectId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch');
      setRows(json.rows || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const runModel = async () => {
    if (!projectId) return;
    setRunLoading(true);
    try {
      const res = await fetch('/api/jcr-model/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Run failed');
    } finally {
      setRunLoading(false);
    }
  };

  const toggleSection = (section: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const tabCounts: Record<string, number> = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.tab] = (counts[r.tab] || 0) + 1;
    return counts;
  }, [rows]);

  const filteredTabRows = useMemo(() => {
    let filtered = rows.filter(r => r.tab === activeTab);
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(r =>
        r.display_name.toLowerCase().includes(q) ||
        r.canonical_name.toLowerCase().includes(q) ||
        (r.value_text && r.value_text.toLowerCase().includes(q))
      );
    }
    return filtered;
  }, [rows, activeTab, search]);

  const sections = useMemo(() => [...new Set(filteredTabRows.map(r => r.section))], [filteredTabRows]);

  const nullCount = useMemo(() => filteredTabRows.filter(r => r.value_text == null && r.value_number == null).length, [filteredTabRows]);

  if (!projectId) {
    return <div className="p-6 text-[#999] text-sm">Select a project to view JCR analysis.</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#eee]">
        <div>
          <h3 className="text-sm font-semibold text-[#1a1a1a]">JCR Analysis</h3>
          <p className="text-[11px] text-[#999]">{rows.length} export fields across {Object.keys(tabCounts).length} tabs</p>
        </div>
        <div className="flex items-center gap-2">
          {rows.length > 0 && (
            <button
              onClick={() => downloadCsv(filteredTabRows, activeTab)}
              className="px-3 py-1.5 text-[11px] font-medium border border-[#ddd] text-[#444] rounded-md hover:bg-[#f5f5f5]"
            >
              Export CSV
            </button>
          )}
          <button
            onClick={runModel}
            disabled={runLoading}
            className="px-3 py-1.5 text-[11px] font-medium bg-[#1a1a1a] text-white rounded-md hover:bg-[#333] disabled:opacity-50"
          >
            {runLoading ? 'Running...' : rows.length > 0 ? 'Re-run Model' : 'Run JCR Model'}
          </button>
        </div>
      </div>

      {error && <div className="px-4 py-2 bg-red-50 text-red-600 text-xs">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-[#999] text-sm">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <p className="text-[#999] text-sm">No JCR export data yet.</p>
          <p className="text-[#bbb] text-xs">Click &quot;Run JCR Model&quot; to generate analysis from the extracted JCR.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-1 px-4 py-2 border-b border-[#eee] overflow-x-auto">
            {TABS.filter(t => tabCounts[t]).map(tab => (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setSearch(''); setCollapsed(new Set()); }}
                className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab
                    ? 'bg-[#1a1a1a] text-white'
                    : 'text-[#666] hover:bg-[#f0f0f0]'
                }`}
              >
                {tab} <span className="text-[10px] opacity-60">({tabCounts[tab]})</span>
              </button>
            ))}
          </div>

          {/* Search bar */}
          <div className="px-4 py-2 border-b border-[#eee] flex items-center gap-3">
            <div className="flex-1 relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#999]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Filter fields..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-[#e8e8e8] rounded-md focus:outline-none focus:border-[#999] transition-colors"
              />
            </div>
            {nullCount > 0 && (
              <span className="text-[10px] text-[#999] whitespace-nowrap">{nullCount} null value{nullCount !== 1 ? 's' : ''}</span>
            )}
          </div>

          <div className="flex-1 overflow-auto p-4">
            {sections.length === 0 ? (
              <div className="text-center py-8 text-[#999] text-sm">No fields match &quot;{search}&quot;</div>
            ) : sections.map(section => {
              const sectionRows = filteredTabRows.filter(r => r.section === section);
              const isCollapsed = collapsed.has(section);
              return (
                <div key={section} className="mb-6">
                  <button
                    onClick={() => toggleSection(section)}
                    className="flex items-center gap-2 mb-2 group w-full text-left"
                  >
                    <svg className={`w-3 h-3 text-[#999] transition-transform ${isCollapsed ? '' : 'rotate-90'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <h4 className="text-[11px] font-semibold text-[#666] uppercase tracking-wider group-hover:text-[#333]">
                      {section}
                    </h4>
                    <span className="text-[10px] text-[#bbb]">({sectionRows.length})</span>
                  </button>
                  {!isCollapsed && (
                    <div className="border border-[#eee] rounded-lg overflow-hidden">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="bg-[#fafafa]">
                            <th className="text-left px-3 py-2 font-medium text-[#666]">Field</th>
                            <th className="text-right px-3 py-2 font-medium text-[#666]">Value</th>
                            <th className="text-center px-3 py-2 font-medium text-[#666] w-16">Type</th>
                            <th className="text-center px-3 py-2 font-medium text-[#666] w-20">Status</th>
                            {sectionRows.some(r => r.notes) && (
                              <th className="text-left px-3 py-2 font-medium text-[#666] w-20">Notes</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {sectionRows.map((r) => {
                            const isNull = r.value_text == null && r.value_number == null;
                            return (
                              <tr key={r.id} className={`border-t border-[#f0f0f0] hover:bg-[#fafafa] ${isNull ? 'opacity-50' : ''}`}>
                                <td className="px-3 py-1.5 text-[#1a1a1a]">
                                  {r.display_name}
                                  {isNull && <span className="ml-1.5 text-[9px] text-[#ccc] uppercase">no data</span>}
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono text-[#333]">
                                  {r.value_text || fmt(r.value_number, r.data_type)}
                                </td>
                                <td className="px-3 py-1.5 text-center">
                                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    r.data_type === 'currency' ? 'bg-green-50 text-green-700' :
                                    r.data_type === 'percent' ? 'bg-blue-50 text-blue-700' :
                                    r.data_type === 'number' ? 'bg-purple-50 text-purple-700' :
                                    'bg-gray-50 text-gray-600'
                                  }`}>
                                    {r.data_type}
                                  </span>
                                </td>
                                <td className="px-3 py-1.5 text-center">
                                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    r.status === 'Extracted' ? 'bg-emerald-50 text-emerald-700' :
                                    r.status === 'Derived' ? 'bg-amber-50 text-amber-700' :
                                    'bg-indigo-50 text-indigo-700'
                                  }`}>
                                    {r.status}
                                  </span>
                                </td>
                                {sectionRows.some(row => row.notes) && (
                                  <td className="px-3 py-1.5 text-[11px] text-[#999]">
                                    {r.notes && (
                                      <span className={r.notes === 'PASS' ? 'text-green-600 font-medium' : r.notes === 'FAIL' ? 'text-red-600 font-medium' : ''}>
                                        {r.notes}
                                      </span>
                                    )}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
