'use client';

import { useMemo } from 'react';
import DataTable, { type Column } from '../DataTable';
import TabHeader from '../TabHeader';
import { type ExportRow, pivotByRecordKey, n, s, fmtCurrency, fmtPercent, fmtNumber, type PivotedRecord } from '../pivotRows';

interface Props { rows: ExportRow[] }

export default function CrewLaborTab({ rows }: Props) {
  const pivoted = useMemo(() => {
    const crewDerived = rows.filter(r => r.tab === 'Crew Labor');
    const bvaRows = rows.filter(r => r.tab === 'Budget vs Actual');

    const allBva = pivotByRecordKey(bvaRows);
    const laborCodes = allBva
      .filter(r =>
        String(r._record_key).startsWith('cost_code=') &&
        String(r.cost_category || '').toLowerCase() === 'labor'
      );

    const derivedByKey = new Map<string, PivotedRecord>();
    for (const r of pivotByRecordKey(crewDerived)) {
      derivedByKey.set(String(r._record_key), r);
    }

    return laborCodes.map(r => {
      const derived = derivedByKey.get(String(r._record_key));
      return { ...r, ...(derived || {}) };
    }).sort((a, b) => Math.abs(n(b.jtd_cost)) - Math.abs(n(a.jtd_cost)));
  }, [rows]);

  const summaryRow: PivotedRecord = {
    _record_key: 'TOTAL',
    _section: '',
    cost_code: '',
    description: 'TOTAL',
    _total_hours: pivoted.reduce((a, r) => a + n(r.regular_hours) + n(r.overtime_hours), 0),
    regular_hours: pivoted.reduce((a, r) => a + n(r.regular_hours), 0),
    overtime_hours: pivoted.reduce((a, r) => a + n(r.overtime_hours), 0),
    jtd_cost: pivoted.reduce((a, r) => a + n(r.jtd_cost), 0),
    revised_budget: pivoted.reduce((a, r) => a + n(r.revised_budget), 0),
  };
  const totalH = n(summaryRow.regular_hours) + n(summaryRow.overtime_hours);
  summaryRow.crew_ot_pct = totalH > 0 ? (n(summaryRow.overtime_hours) / totalH) * 100 : 0;
  summaryRow.crew_blended_rate = totalH > 0 ? n(summaryRow.jtd_cost) / totalH : 0;

  const columns: Column<PivotedRecord>[] = [
    {
      key: 'cost_code',
      label: 'Code',
      render: (r) => <span className="text-[#666] text-[12px]">{s(r.cost_code)}</span>,
    },
    {
      key: 'description',
      label: 'Labor Phase',
      render: (r) => <span className="font-sans text-[#1a1a1a] text-[12px] font-medium">{s(r.description) || s(r.cost_code)}</span>,
      className: 'min-w-[180px]',
    },
    {
      key: '_total_hours',
      label: 'Total Hrs',
      align: 'right',
      render: (r) => {
        const val = n(r.regular_hours) + n(r.overtime_hours);
        return <span className="text-[#1a1a1a] font-semibold">{fmtNumber(val, 1)}</span>;
      },
    },
    {
      key: 'regular_hours',
      label: 'Reg Hrs',
      align: 'right',
      render: (r) => <span className="text-[#333]">{fmtNumber(n(r.regular_hours), 1)}</span>,
    },
    {
      key: 'overtime_hours',
      label: 'OT Hrs',
      align: 'right',
      render: (r) => {
        const val = n(r.overtime_hours);
        return <span className={val > 0 ? 'text-amber-600' : 'text-[#333]'}>{fmtNumber(val, 1)}</span>;
      },
    },
    {
      key: 'crew_ot_pct',
      label: 'OT %',
      align: 'right',
      render: (r) => <span className="text-[#333]">{fmtPercent(n(r.crew_ot_pct))}</span>,
    },
    {
      key: 'jtd_cost',
      label: 'Cost',
      align: 'right',
      render: (r) => <span className="text-[#333]">{fmtCurrency(n(r.jtd_cost))}</span>,
    },
    {
      key: 'revised_budget',
      label: 'Budget',
      align: 'right',
      render: (r) => <span className="text-[#333]">{fmtCurrency(n(r.revised_budget))}</span>,
    },
    {
      key: 'crew_blended_rate',
      label: '$/Hr',
      align: 'right',
      render: (r) => <span className="text-[#333]">{n(r.crew_blended_rate) ? fmtCurrency(n(r.crew_blended_rate)) : '—'}</span>,
    },
  ];

  return (
    <div>
      <TabHeader
        category="Labor by Cost Code"
        title="Crew Labor"
        subtitle={`${pivoted.length} labor cost codes with hours, overtime, and blended rates.`}
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
