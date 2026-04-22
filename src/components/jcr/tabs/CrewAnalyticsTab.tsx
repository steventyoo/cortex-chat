'use client';

import { useMemo } from 'react';
import DataTable, { type Column } from '../DataTable';
import TierBadge from '../TierBadge';
import TabHeader from '../TabHeader';
import { type ExportRow, pivotByRecordKeySum, n, s, fmtCurrency, fmtPercent, fmtNumber, fmtInteger, type PivotedRecord } from '../pivotRows';

interface Props { rows: ExportRow[] }

function workerHrs(r: PivotedRecord, field: 'reg' | 'ot' | 'total'): number {
  if (field === 'reg') return n(r.worker_reg_hrs) || n(r.regular_hours);
  if (field === 'ot') return n(r.worker_ot_hrs) || n(r.overtime_hours);
  const reg = n(r.worker_reg_hrs) || n(r.regular_hours);
  const ot = n(r.worker_ot_hrs) || n(r.overtime_hours);
  return n(r.worker_total_hrs) || (reg + ot);
}

function workerWages(r: PivotedRecord): number {
  return n(r.worker_wages) || n(r.actual_amount);
}

export default function CrewAnalyticsTab({ rows }: Props) {
  const tabRows = useMemo(() => rows.filter(r => r.tab === 'Crew Analytics'), [rows]);

  const workers = useMemo((): PivotedRecord[] => {
    const records = pivotByRecordKeySum(tabRows);
    return records
      .filter(r => String(r._record_key).startsWith('worker='))
      .map((r): PivotedRecord => {
        const workerName = s(r.name) || String(r._record_key).replace('worker=', '');
        const totalH = workerHrs(r, 'total');
        const wages = workerWages(r);
        return {
          ...r,
          _worker_name: workerName,
          _total_hrs: totalH,
          _reg_hrs: workerHrs(r, 'reg'),
          _ot_hrs: workerHrs(r, 'ot'),
          _wages: wages,
          _ot_pct: totalH > 0 ? (workerHrs(r, 'ot') / totalH) * 100 : 0,
          _rate: totalH > 0 ? wages / totalH : 0,
        };
      })
      .sort((a, b) => n(b._total_hrs) - n(a._total_hrs));
  }, [tabRows]);

  const summaryRow: PivotedRecord | undefined = workers.length > 0 ? (() => {
    const totReg = workers.reduce((a, r) => a + n(r._reg_hrs), 0);
    const totOt = workers.reduce((a, r) => a + n(r._ot_hrs), 0);
    const totH = totReg + totOt;
    const totW = workers.reduce((a, r) => a + n(r._wages), 0);
    return {
      _record_key: 'TOTAL',
      _section: '',
      _worker_name: 'TOTAL',
      _reg_hrs: totReg,
      _ot_hrs: totOt,
      _total_hrs: totH,
      _wages: totW,
      _ot_pct: totH > 0 ? (totOt / totH) * 100 : 0,
      _rate: totH > 0 ? totW / totH : 0,
      worker_codes: '',
      worker_tier: '',
    };
  })() : undefined;

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
      key: '_reg_hrs',
      label: 'Reg Hrs',
      align: 'right',
      render: (r) => <span className="text-[#333]">{fmtNumber(n(r._reg_hrs), 1)}</span>,
    },
    {
      key: '_ot_hrs',
      label: 'OT Hrs',
      align: 'right',
      render: (r) => {
        const val = n(r._ot_hrs);
        return <span className={val > 0 ? 'text-amber-600' : 'text-[#333]'}>{fmtNumber(val, 1)}</span>;
      },
    },
    {
      key: '_total_hrs',
      label: 'Total Hrs',
      align: 'right',
      render: (r) => <span className="text-[#1a1a1a] font-semibold">{fmtNumber(n(r._total_hrs), 1)}</span>,
    },
    {
      key: '_ot_pct',
      label: 'OT %',
      align: 'right',
      render: (r) => {
        const val = n(r._ot_pct);
        return <span className={val > 15 ? 'text-amber-600' : 'text-[#333]'}>{fmtPercent(val)}</span>;
      },
    },
    {
      key: '_wages',
      label: 'Wages ($)',
      align: 'right',
      render: (r) => <span className="text-[#333]">{fmtCurrency(n(r._wages))}</span>,
    },
    {
      key: '_rate',
      label: '$/Hr',
      align: 'right',
      render: (r) => <span className="text-[#333]">{n(r._rate) ? fmtCurrency(n(r._rate)) : '—'}</span>,
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

      <DataTable
        columns={columns}
        data={workers}
        summaryRow={summaryRow}
        getRowKey={(r) => String(r._record_key)}
      />
    </div>
  );
}
