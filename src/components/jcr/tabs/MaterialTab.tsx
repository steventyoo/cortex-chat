'use client';

import { useMemo } from 'react';
import DataTable, { type Column } from '../DataTable';
import StatusBadge from '../StatusBadge';
import TabHeader from '../TabHeader';
import { type ExportRow, pivotByRecordKey, n, s, fmtCurrency, fmtPercent, type PivotedRecord } from '../pivotRows';

interface Props { rows: ExportRow[] }

export default function MaterialTab({ rows }: Props) {
  const tabRows = useMemo(() => rows.filter(r => r.tab === 'Material'), [rows]);

  const pivoted = useMemo(() => {
    const records = pivotByRecordKey(tabRows);
    return records
      .filter(r => String(r._record_key).startsWith('cost_code='))
      .sort((a, b) => n(b.actual) - n(a.actual));
  }, [tabRows]);

  const summaryRec = useMemo(() => {
    const records = pivotByRecordKey(tabRows);
    return records.find(r => r._record_key === 'mat_total' || r._record_key === 'material_total');
  }, [tabRows]);

  const totalActual = summaryRec ? n(summaryRec.total_actual) : pivoted.reduce((acc, r) => acc + n(r.actual), 0);

  const summaryRow: PivotedRecord = {
    _record_key: 'TOTAL',
    _section: '',
    cost_code: '',
    description: 'TOTAL',
    budget: summaryRec ? n(summaryRec.total_budget) : pivoted.reduce((acc, r) => acc + n(r.budget), 0),
    actual: totalActual,
    variance: summaryRec ? n(summaryRec.total_variance) : pivoted.reduce((acc, r) => acc + n(r.variance), 0),
  };

  const columns: Column<PivotedRecord>[] = [
    {
      key: 'cost_code',
      label: 'Code',
      render: (r) => <span className="text-[#666] text-[12px]">{s(r.cost_code)}</span>,
    },
    {
      key: 'description',
      label: 'Material Phase',
      render: (r) => <span className="font-sans text-[#1a1a1a] text-[12px] font-medium">{s(r.description) || s(r.cost_code)}</span>,
      className: 'min-w-[180px]',
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
      key: 'variance',
      label: 'Variance ($)',
      align: 'right',
      render: (r) => {
        const val = n(r.variance);
        return <span className={val < 0 ? 'text-red-600' : 'text-[#333]'}>{fmtCurrency(val)}</span>;
      },
    },
    {
      key: 'pct_used',
      label: '% Used',
      align: 'right',
      render: (r) => <span className="text-[#333]">{r.pct_used != null ? fmtPercent(n(r.pct_used)) : '—'}</span>,
    },
    {
      key: 'cost_per_unit',
      label: '$/Unit',
      align: 'right',
      render: (r) => <span className="text-[#333]">{r.cost_per_unit != null ? fmtCurrency(n(r.cost_per_unit)) : '—'}</span>,
    },
    {
      key: 'cost_per_fixture',
      label: '$/Fixture',
      align: 'right',
      render: (r) => <span className="text-[#333]">{r.cost_per_fixture != null ? fmtCurrency(n(r.cost_per_fixture)) : '—'}</span>,
    },
    {
      key: '_pct_of_total',
      label: '% of Total',
      align: 'right',
      render: (r) => {
        const pct = totalActual > 0 ? (n(r.actual) / totalActual) * 100 : 0;
        return <span className="text-[#333]">{fmtPercent(pct)}</span>;
      },
    },
    {
      key: '_status',
      label: 'Status',
      align: 'center',
      render: (r) => {
        const budget = n(r.budget);
        const varPct = budget > 0 ? ((budget - n(r.actual)) / budget) * 100 : null;
        return <StatusBadge variancePct={varPct} />;
      },
      sortable: false,
    },
  ];

  return (
    <div>
      <TabHeader
        category="Material Cost Analysis"
        title="Material Breakdown"
        subtitle={`${pivoted.length} material cost codes with per-unit and per-fixture metrics.`}
      />
      <DataTable
        columns={columns}
        data={pivoted}
        summaryRow={summaryRow}
        getRowKey={(r) => String(r._record_key)}
      />
    </div>
  );
}
