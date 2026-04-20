'use client';

import { useMemo } from 'react';
import DataTable, { type Column } from '../DataTable';
import TabHeader from '../TabHeader';
import { type ExportRow, pivotByRecordKey, n, s, fmtCurrency, fmtNumber, type PivotedRecord } from '../pivotRows';

interface Props { rows: ExportRow[] }

export default function ProductivityTab({ rows }: Props) {
  const tabRows = useMemo(() => rows.filter(r => r.tab === 'Productivity'), [rows]);

  const phases = useMemo(() => {
    const records = pivotByRecordKey(tabRows);
    return records
      .filter(r => String(r._record_key).startsWith('prod_'))
      .sort((a, b) => n(b.hours) - n(a.hours));
  }, [tabRows]);

  const throughput = useMemo(() => {
    const records = pivotByRecordKey(tabRows);
    return records.find(r => r._record_key === 'throughput');
  }, [tabRows]);

  const efficiency = useMemo(() => {
    const records = pivotByRecordKey(tabRows);
    return records.find(r => r._record_key === 'efficiency');
  }, [tabRows]);

  const summaryRow: PivotedRecord = {
    _record_key: 'TOTAL',
    _section: '',
    phase: 'TOTAL',
    hours: phases.reduce((a, r) => a + n(r.hours), 0),
    budget: phases.reduce((a, r) => a + n(r.budget), 0),
    actual: phases.reduce((a, r) => a + n(r.actual), 0),
  };

  const columns: Column<PivotedRecord>[] = [
    {
      key: 'phase',
      label: 'Phase',
      render: (r) => <span className="font-sans text-[#1a1a1a] text-[12px] font-medium">{s(r.phase)}</span>,
      className: 'min-w-[180px]',
    },
    {
      key: 'hours',
      label: 'Hours',
      align: 'right',
      render: (r) => <span className="text-[#1a1a1a] font-semibold">{fmtNumber(n(r.hours), 0)}</span>,
    },
    {
      key: 'budget',
      label: 'Budget',
      align: 'right',
      render: (r) => <span className="text-[#333]">{fmtCurrency(n(r.budget))}</span>,
    },
    {
      key: 'actual',
      label: 'Actual',
      align: 'right',
      render: (r) => <span className="text-[#333]">{fmtCurrency(n(r.actual))}</span>,
    },
    {
      key: 'hours_per_unit',
      label: 'Hrs/Unit',
      align: 'right',
      render: (r) => <span className="text-[#333]">{r.hours_per_unit != null ? fmtNumber(n(r.hours_per_unit), 2) : '—'}</span>,
    },
    {
      key: 'hours_per_fixture',
      label: 'Hrs/Fixture',
      align: 'right',
      render: (r) => <span className="text-[#333]">{r.hours_per_fixture != null ? fmtNumber(n(r.hours_per_fixture), 2) : '—'}</span>,
    },
  ];

  const kpis = [
    ...(throughput ? [
      throughput.hours_per_unit != null && { label: 'Hours/Unit (Total)', value: fmtNumber(n(throughput.hours_per_unit), 1) },
      throughput.revenue_per_unit != null && { label: 'Revenue/Unit', value: fmtCurrency(n(throughput.revenue_per_unit)) },
      throughput.hours_per_fixture != null && { label: 'Hours/Fixture (Total)', value: fmtNumber(n(throughput.hours_per_fixture), 2) },
      throughput.hours_per_month != null && { label: 'Hours/Month', value: fmtNumber(n(throughput.hours_per_month), 0) },
      throughput.units_per_month != null && { label: 'Units/Month', value: fmtNumber(n(throughput.units_per_month), 1) },
    ].filter(Boolean) : []),
    ...(efficiency ? [
      efficiency.revenue_per_hour != null && { label: 'Revenue/Hour', value: fmtCurrency(n(efficiency.revenue_per_hour)) },
    ].filter(Boolean) : []),
  ] as { label: string; value: string }[];

  return (
    <div>
      <TabHeader
        category="Labor Efficiency"
        title="Productivity"
        subtitle={`${phases.length} labor phases with throughput and efficiency KPIs.`}
      />

      <DataTable
        columns={columns}
        data={phases}
        summaryRow={summaryRow}
        getRowKey={(r) => String(r._record_key)}
      />

      {kpis.length > 0 && (
        <div className="mt-6">
          <h4 className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-3">Throughput & Efficiency</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {kpis.map(kpi => (
              <div key={kpi.label} className="bg-[#fafafa] border border-[#e8e8e8] rounded-lg px-3 py-2">
                <p className="text-[10px] text-[#999] uppercase tracking-wider">{kpi.label}</p>
                <p className="text-base font-semibold font-mono text-[#1a1a1a]">{kpi.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
