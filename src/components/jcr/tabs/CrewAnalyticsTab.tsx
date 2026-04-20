'use client';

import { useMemo } from 'react';
import DataTable, { type Column } from '../DataTable';
import TierBadge from '../TierBadge';
import TabHeader from '../TabHeader';
import { type ExportRow, pivotByRecordKey, n, s, fmtCurrency, fmtPercent, fmtNumber, fmtInteger, type PivotedRecord } from '../pivotRows';

interface Props { rows: ExportRow[] }

export default function CrewAnalyticsTab({ rows }: Props) {
  const tabRows = useMemo(() => rows.filter(r => r.tab === 'Crew Analytics'), [rows]);

  const workers = useMemo((): PivotedRecord[] => {
    const records = pivotByRecordKey(tabRows);
    return records
      .filter(r => String(r._record_key).startsWith('worker='))
      .map((r): PivotedRecord => {
        const nameField = tabRows.find(
          row => row.record_key === r._record_key && row.canonical_name === 'worker_reg_hrs'
        );
        const workerName = nameField
          ? nameField.display_name.replace(/\s*—\s*REG HRS$/, '')
          : String(r._record_key).replace('worker=', '');
        return { ...r, _worker_name: workerName };
      })
      .sort((a, b) => n(b.worker_total_hrs) - n(a.worker_total_hrs));
  }, [tabRows]);

  const summary = useMemo(() => {
    const records = pivotByRecordKey(tabRows);
    return records.find(r => r._record_key === 'crew_summary') || null;
  }, [tabRows]);

  const summaryRow: PivotedRecord | undefined = workers.length > 0 ? {
    _record_key: 'TOTAL',
    _section: '',
    _worker_name: 'TOTAL',
    worker_reg_hrs: workers.reduce((a, r) => a + n(r.worker_reg_hrs), 0),
    worker_ot_hrs: workers.reduce((a, r) => a + n(r.worker_ot_hrs), 0),
    worker_total_hrs: workers.reduce((a, r) => a + n(r.worker_total_hrs), 0),
    worker_wages: workers.reduce((a, r) => a + n(r.worker_wages), 0),
    worker_codes: '',
    worker_tier: '',
  } : undefined;

  if (summaryRow) {
    const totalH = n(summaryRow.worker_total_hrs);
    summaryRow.worker_ot_pct = totalH > 0 ? (n(summaryRow.worker_ot_hrs) / totalH) * 100 : 0;
    const totalW = n(summaryRow.worker_wages);
    summaryRow.worker_rate = totalH > 0 ? totalW / totalH : 0;
  }

  const columns: Column<PivotedRecord>[] = [
    {
      key: '_worker_name',
      label: 'Worker',
      render: (r) => <span className="font-sans text-[#1a1a1a] text-[12px] font-medium">{s(r._worker_name)}</span>,
      className: 'min-w-[140px]',
    },
    {
      key: '_record_key',
      label: 'ID',
      render: (r) => <span className="text-[#999] text-[11px]">{String(r._record_key).replace('worker=', '')}</span>,
    },
    {
      key: 'worker_reg_hrs',
      label: 'Reg Hrs',
      align: 'right',
      render: (r) => <span className="text-[#333]">{fmtNumber(n(r.worker_reg_hrs), 1)}</span>,
    },
    {
      key: 'worker_ot_hrs',
      label: 'OT Hrs',
      align: 'right',
      render: (r) => {
        const val = n(r.worker_ot_hrs);
        return <span className={val > 0 ? 'text-amber-600' : 'text-[#333]'}>{fmtNumber(val, 1)}</span>;
      },
    },
    {
      key: 'worker_total_hrs',
      label: 'Total Hrs',
      align: 'right',
      render: (r) => <span className="text-[#1a1a1a] font-semibold">{fmtNumber(n(r.worker_total_hrs), 1)}</span>,
    },
    {
      key: 'worker_ot_pct',
      label: 'OT %',
      align: 'right',
      render: (r) => {
        const val = n(r.worker_ot_pct);
        return <span className={val > 15 ? 'text-amber-600' : 'text-[#333]'}>{fmtPercent(val)}</span>;
      },
    },
    {
      key: 'worker_wages',
      label: 'Wages ($)',
      align: 'right',
      render: (r) => <span className="text-[#333]">{fmtCurrency(n(r.worker_wages))}</span>,
    },
    {
      key: 'worker_rate',
      label: '$/Hr',
      align: 'right',
      render: (r) => <span className="text-[#333]">{r.worker_rate != null ? fmtCurrency(n(r.worker_rate)) : '—'}</span>,
    },
    {
      key: 'worker_codes',
      label: 'Codes',
      align: 'center',
      render: (r) => <span className="text-[#333]">{r.worker_codes != null ? fmtInteger(n(r.worker_codes)) : '—'}</span>,
    },
    {
      key: 'worker_tier',
      label: 'Tier',
      align: 'center',
      render: (r) => r.worker_tier ? <TierBadge tier={s(r.worker_tier)} /> : <span className="text-[#999]">—</span>,
      sortable: false,
    },
  ];

  return (
    <div>
      <TabHeader
        category="Per-Worker Breakdown"
        title="Crew Analytics"
        subtitle={`${workers.length} workers with hours, wages, and tier classification.`}
      />

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Total Labor Hours', value: fmtNumber(n(summary.total_labor_hours), 0) },
            { label: 'Total OT Hours', value: fmtNumber(n(summary.total_ot_hours), 0) },
            { label: 'OT Ratio', value: fmtPercent(n(summary.ot_ratio)) },
            { label: 'Blended Gross Wage', value: fmtCurrency(n(summary.blended_gross_wage)) },
          ].map(kpi => (
            <div key={kpi.label} className="bg-[#fafafa] border border-[#e8e8e8] rounded-lg px-3 py-2">
              <p className="text-[10px] text-[#999] uppercase tracking-wider">{kpi.label}</p>
              <p className="text-lg font-semibold font-mono text-[#1a1a1a]">{kpi.value}</p>
            </div>
          ))}
        </div>
      )}

      <DataTable
        columns={columns}
        data={workers}
        summaryRow={summaryRow}
        getRowKey={(r) => String(r._record_key)}
      />
    </div>
  );
}
