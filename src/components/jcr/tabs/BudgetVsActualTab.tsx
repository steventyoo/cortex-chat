'use client';

import { useMemo } from 'react';
import DataTable, { type Column } from '../DataTable';
import StatusBadge from '../StatusBadge';
import TabHeader from '../TabHeader';
import { type ExportRow, pivotByRecordKey, n, s, fmtCurrency, fmtPercent, fmtNumber, type PivotedRecord } from '../pivotRows';

interface Props { rows: ExportRow[] }

export default function BudgetVsActualTab({ rows }: Props) {
  const tabRows = useMemo(() => rows.filter(r => r.tab === 'Budget vs Actual'), [rows]);
  const pivoted = useMemo(() => {
    const records = pivotByRecordKey(tabRows);
    return records
      .filter(r => String(r._record_key).startsWith('cc_'))
      .sort((a, b) => n(b.jtd_cost) - n(a.jtd_cost));
  }, [tabRows]);

  const totalBudget = useMemo(() => pivoted.reduce((acc, r) => acc + n(r.revised_budget), 0), [pivoted]);
  const totalActual = useMemo(() => pivoted.reduce((acc, r) => acc + n(r.jtd_cost), 0), [pivoted]);
  const totalVariance = totalBudget - totalActual;
  const totalVarPct = totalBudget > 0 ? ((totalBudget - totalActual) / totalBudget) * 100 : 0;

  const summaryRow: PivotedRecord = {
    _record_key: 'TOTAL',
    _section: '',
    cost_code: '',
    description: 'TOTAL',
    revised_budget: totalBudget,
    jtd_cost: totalActual,
    over_under: totalVariance,
    variance_pct: totalVarPct,
    total_hours: pivoted.reduce((acc, r) => acc + n(r.total_hours), 0),
  };

  const columns: Column<PivotedRecord>[] = [
    {
      key: 'cost_code',
      label: 'Code',
      render: (r) => <span className="text-[#666] text-[12px]">{s(r.cost_code)}</span>,
    },
    {
      key: 'description',
      label: 'Phase',
      render: (r) => <span className="font-sans text-[#1a1a1a] text-[12px] font-medium">{s(r.description) || s(r.cost_code)}</span>,
      className: 'min-w-[180px]',
    },
    {
      key: 'revised_budget',
      label: 'Budget',
      align: 'right',
      render: (r) => <span className="text-[#333]">{fmtCurrency(n(r.revised_budget))}</span>,
    },
    {
      key: 'jtd_cost',
      label: 'Actual',
      align: 'right',
      render: (r) => <span className="text-[#333]">{fmtCurrency(n(r.jtd_cost))}</span>,
    },
    {
      key: 'over_under',
      label: 'Variance ($)',
      align: 'right',
      render: (r) => {
        const val = n(r.over_under);
        return (
          <span className={val < 0 ? 'text-red-600' : 'text-[#333]'}>
            {fmtCurrency(val)}
          </span>
        );
      },
    },
    {
      key: 'variance_pct',
      label: 'Var %',
      align: 'right',
      render: (r) => {
        const val = n(r.variance_pct);
        return (
          <span className={val < -5 ? 'text-red-600' : val > 5 ? 'text-emerald-600' : 'text-[#333]'}>
            {fmtPercent(val)}
          </span>
        );
      },
    },
    {
      key: 'total_hours',
      label: 'Hours',
      align: 'right',
      render: (r) => {
        const val = n(r.total_hours);
        return <span className="text-[#333]">{val > 0 ? fmtNumber(val, 0) : '—'}</span>;
      },
    },
    {
      key: 'pct_consumed',
      label: '% Used',
      align: 'right',
      render: (r) => <span className="text-[#333]">{r.pct_consumed != null ? fmtPercent(n(r.pct_consumed)) : '—'}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      render: (r) => <StatusBadge variancePct={n(r.variance_pct)} />,
      sortable: false,
    },
  ];

  return (
    <div>
      <TabHeader
        category="Phase-Level Variance Analysis"
        title="Budget vs Actual"
        subtitle={`All ${pivoted.length} cost codes from the JCR — labor, material, overhead, burden.`}
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
