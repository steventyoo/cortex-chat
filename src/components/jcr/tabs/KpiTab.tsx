'use client';

import { useMemo } from 'react';
import TabHeader from '../TabHeader';
import { type ExportRow, fmtCurrencyFull, fmtPercent, fmtNumber } from '../pivotRows';

interface Props {
  rows: ExportRow[];
  tab: string;
}

function fmtVal(val: number | null, type: string): string {
  if (val == null) return '—';
  if (type === 'currency') return fmtCurrencyFull(val);
  if (type === 'percent') return fmtPercent(val);
  if (type === 'integer') return Math.round(val).toLocaleString();
  if (type === 'ratio') return val.toFixed(2);
  return fmtNumber(val, 2);
}

const TAB_META: Record<string, { category: string; subtitle: string }> = {
  'Overview': { category: 'Project Summary', subtitle: 'High-level project metrics from the Job Cost Report.' },
  'Cost Breakdown': { category: 'Source & Ratio Analysis', subtitle: 'Payroll, AP, GL splits and per-unit cost ratios.' },
  'Benchmark KPIs': { category: 'Performance Benchmarks', subtitle: 'Derived KPIs for benchmarking against industry standards.' },
  'Insights': { category: 'Analytical Insights', subtitle: 'Automated findings and anomaly flags from the data.' },
  'Reconciliation': { category: 'Data Quality Checks', subtitle: 'Cross-reference checks between budget, actual, and source totals.' },
};

export default function KpiTab({ rows, tab }: Props) {
  const tabRows = useMemo(() => rows.filter(r => r.tab === tab), [rows, tab]);
  const sections = useMemo(() => [...new Set(tabRows.map(r => r.section))], [tabRows]);

  const meta = TAB_META[tab] || { category: tab.toUpperCase(), subtitle: '' };

  return (
    <div>
      <TabHeader
        category={meta.category}
        title={tab}
        subtitle={meta.subtitle}
      />

      <div className="space-y-6">
        {sections.map(section => {
          const sectionRows = tabRows.filter(r => r.section === section);
          return (
            <div key={section}>
              <h4 className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-2">{section}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {sectionRows.map(r => {
                  const isNull = r.value_text == null && r.value_number == null;
                  const display = r.value_text || fmtVal(r.value_number, r.data_type);
                  const isPass = r.notes === 'PASS';
                  const isFail = r.notes === 'FAIL';

                  return (
                    <div
                      key={r.id}
                      className={`border rounded-lg px-3 py-2.5 ${
                        isFail ? 'border-red-200 bg-red-50/50' :
                        isPass ? 'border-emerald-200 bg-emerald-50/50' :
                        isNull ? 'border-[#e8e8e8] bg-[#fafafa] opacity-60' :
                        'border-[#e8e8e8] bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[11px] text-[#888] leading-tight">{r.display_name}</p>
                        <div className="flex items-center gap-1 shrink-0">
                          {r.notes && (
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                              isPass ? 'bg-emerald-100 text-emerald-700' :
                              isFail ? 'bg-red-100 text-red-700' :
                              'bg-gray-100 text-gray-500'
                            }`}>
                              {r.notes}
                            </span>
                          )}
                          <span className={`text-[9px] px-1 py-0.5 rounded ${
                            r.status === 'Extracted' ? 'bg-emerald-50 text-emerald-600' :
                            r.status === 'Derived' ? 'bg-amber-50 text-amber-600' :
                            'bg-indigo-50 text-indigo-600'
                          }`}>
                            {r.status}
                          </span>
                        </div>
                      </div>
                      <p className={`text-base font-semibold font-mono mt-1 ${
                        isNull ? 'text-[#ccc]' :
                        isFail ? 'text-red-700' :
                        r.data_type === 'currency' && r.value_number != null && r.value_number < 0 ? 'text-red-600' :
                        'text-[#1a1a1a]'
                      }`}>
                        {display}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
