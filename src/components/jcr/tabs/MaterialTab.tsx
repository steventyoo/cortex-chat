'use client';

import { useMemo } from 'react';
import DataTable, { type Column } from '../DataTable';
import StatusBadge from '../StatusBadge';
import TabHeader from '../TabHeader';
import { type ExportRow, pivotByRecordKey, n, s, fmtCurrency, fmtPercent, type PivotedRecord } from '../pivotRows';

interface Props { rows: ExportRow[] }

export default function MaterialTab({ rows }: Props) {
  const pivoted = useMemo(() => {
    const matDerived = rows.filter(r => r.tab === 'Material');
    const bvaRows = rows.filter(r => r.tab === 'Budget vs Actual');

    const allBva = pivotByRecordKey(bvaRows);
    const materialCodes = allBva
      .filter(r =>
        String(r._record_key).startsWith('cost_code=') &&
        String(r.cost_category || '').toLowerCase() === 'material'
      );

    const derivedByKey = new Map<string, PivotedRecord>();
    for (const r of pivotByRecordKey(matDerived)) {
      derivedByKey.set(String(r._record_key), r);
    }

    return materialCodes.map(r => {
      const derived = derivedByKey.get(String(r._record_key));
      return { ...r, ...(derived || {}) };
    }).sort((a, b) => Math.abs(n(b.jtd_cost)) - Math.abs(n(a.jtd_cost)));
  }, [rows]);

  const matTotals = useMemo(() => {
    const matDerived = rows.filter(r => r.tab === 'Material');
    const records = pivotByRecordKey(matDerived);
    return records.find(r =>
      r._record_key === 'project' ||
      r._record_key === 'mat_total' ||
      r._record_key === 'material_total'
    );
  }, [rows]);

  const totalBudget = matTotals ? n(matTotals.material_total_budget) : pivoted.reduce((acc, r) => acc + n(r.revised_budget), 0);
  const totalActual = matTotals ? n(matTotals.material_total_actual) : pivoted.reduce((acc, r) => acc + n(r.jtd_cost), 0);
  const totalVariance = matTotals ? n(matTotals.material_total_variance) : totalBudget - totalActual;

  const summaryRow: PivotedRecord = {
    _record_key: 'TOTAL',
    _section: '',
    cost_code: '',
    description: 'TOTAL',
    revised_budget: totalBudget,
    jtd_cost: totalActual,
    mat_variance: totalVariance,
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
      key: 'mat_variance',
      label: 'Variance ($)',
      align: 'right',
      render: (r) => {
        const val = n(r.mat_variance) || (n(r.revised_budget) - n(r.jtd_cost));
        return <span className={val < 0 ? 'text-red-600' : 'text-[#333]'}>{fmtCurrency(val)}</span>;
      },
    },
    {
      key: 'mat_pct_used',
      label: '% Used',
      align: 'right',
      render: (r) => {
        const val = n(r.mat_pct_used);
        return <span className="text-[#333]">{val ? fmtPercent(val) : '—'}</span>;
      },
    },
    {
      key: '_pct_of_total',
      label: '% of Total',
      align: 'right',
      render: (r) => {
        const pct = totalActual !== 0 ? (Math.abs(n(r.jtd_cost)) / Math.abs(totalActual)) * 100 : 0;
        return <span className="text-[#333]">{fmtPercent(pct)}</span>;
      },
    },
    {
      key: '_status',
      label: 'Status',
      align: 'center',
      render: (r) => {
        const budget = n(r.revised_budget);
        const varPct = budget > 0 ? ((budget - n(r.jtd_cost)) / budget) * 100 : null;
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
        subtitle={`${pivoted.length} material cost codes with budget-to-actual variance.`}
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
