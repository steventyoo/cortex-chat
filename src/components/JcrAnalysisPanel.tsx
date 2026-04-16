'use client';

import { useState, useEffect, useCallback } from 'react';

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

export default function JcrAnalysisPanel({ projectId }: { projectId: string | null }) {
  const [rows, setRows] = useState<ExportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('Overview');
  const [runLoading, setRunLoading] = useState(false);

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

  if (!projectId) {
    return <div className="p-6 text-[#999] text-sm">Select a project to view JCR analysis.</div>;
  }

  const tabRows = rows.filter(r => r.tab === activeTab);
  const sections = [...new Set(tabRows.map(r => r.section))];
  const tabCounts: Record<string, number> = {};
  for (const r of rows) tabCounts[r.tab] = (tabCounts[r.tab] || 0) + 1;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#eee]">
        <div>
          <h3 className="text-sm font-semibold text-[#1a1a1a]">JCR Analysis</h3>
          <p className="text-[11px] text-[#999]">{rows.length} export fields across {Object.keys(tabCounts).length} tabs</p>
        </div>
        <button
          onClick={runModel}
          disabled={runLoading}
          className="px-3 py-1.5 text-[11px] font-medium bg-[#1a1a1a] text-white rounded-md hover:bg-[#333] disabled:opacity-50"
        >
          {runLoading ? 'Running...' : rows.length > 0 ? 'Re-run Model' : 'Run JCR Model'}
        </button>
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
                onClick={() => setActiveTab(tab)}
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

          <div className="flex-1 overflow-auto p-4">
            {sections.map(section => {
              const sectionRows = tabRows.filter(r => r.section === section);
              return (
                <div key={section} className="mb-6">
                  <h4 className="text-[11px] font-semibold text-[#666] uppercase tracking-wider mb-2">{section}</h4>
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
                        {sectionRows.map((r) => (
                          <tr key={r.id} className="border-t border-[#f0f0f0] hover:bg-[#fafafa]">
                            <td className="px-3 py-1.5 text-[#1a1a1a]">{r.display_name}</td>
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
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
