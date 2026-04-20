'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import BudgetVsActualTab from './jcr/tabs/BudgetVsActualTab';
import MaterialTab from './jcr/tabs/MaterialTab';
import CrewAnalyticsTab from './jcr/tabs/CrewAnalyticsTab';
import CrewLaborTab from './jcr/tabs/CrewLaborTab';
import CrewLaborTierTab from './jcr/tabs/CrewLaborTierTab';
import ProductivityTab from './jcr/tabs/ProductivityTab';
import KpiTab from './jcr/tabs/KpiTab';
import { type ExportRow } from './jcr/pivotRows';

const TABS = [
  'Overview', 'Budget vs Actual', 'Material', 'Cost Breakdown',
  'Crew Labor', 'Crew Analytics', 'Crew & Labor', 'Productivity',
  'Benchmark KPIs', 'Insights', 'Reconciliation',
];

const TABULAR_TABS = new Set([
  'Budget vs Actual', 'Material', 'Crew Labor',
  'Crew Analytics', 'Crew & Labor', 'Productivity',
]);

function downloadCsv(rows: ExportRow[], tabName: string) {
  const header = ['Field', 'Value', 'Type', 'Status', 'Section', 'Notes'];
  const csvRows = rows.filter(r => r.tab === tabName).map(r => [
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

  const tabCounts: Record<string, number> = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.tab] = (counts[r.tab] || 0) + 1;
    return counts;
  }, [rows]);

  const renderTab = () => {
    switch (activeTab) {
      case 'Budget vs Actual':
        return <BudgetVsActualTab rows={rows} />;
      case 'Material':
        return <MaterialTab rows={rows} />;
      case 'Crew Analytics':
        return <CrewAnalyticsTab rows={rows} />;
      case 'Crew Labor':
        return <CrewLaborTab rows={rows} />;
      case 'Crew & Labor':
        return <CrewLaborTierTab rows={rows} />;
      case 'Productivity':
        return <ProductivityTab rows={rows} />;
      default:
        return <KpiTab rows={rows} tab={activeTab} />;
    }
  };

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
              onClick={() => downloadCsv(rows, activeTab)}
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
                onClick={() => setActiveTab(tab)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab
                    ? 'bg-[#1a1a1a] text-white'
                    : 'text-[#666] hover:bg-[#f0f0f0]'
                }`}
              >
                {tab}
                {TABULAR_TABS.has(tab) && (
                  <span className="ml-1 text-[9px] opacity-40">●</span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto p-4">
            {renderTab()}
          </div>
        </>
      )}
    </div>
  );
}
