'use client';

import { useMemo } from 'react';
import DataTable, { type Column } from '../DataTable';
import TabHeader from '../TabHeader';
import { type ExportRow, pivotByRecordKey, n, s, fmtCurrency, fmtPercent, fmtNumber, type PivotedRecord } from '../pivotRows';

interface Props { rows: ExportRow[] }

export default function CrewLaborTab({ rows }: Props) {
  const tabRows = useMemo(() => rows.filter(r => r.tab === 'Crew Labor'), [rows]);

  const pivoted = useMemo(() => {
    const records = pivotByRecordKey(tabRows);
    return records
      .filter(r => String(r._record_key).startsWith('cost_code='))
      .sort((a, b) => n(b.cost) - n(a.cost));
  }, [tabRows]);

  const summaryRow: PivotedRecord = {
    _record_key: 'TOTAL',
    _section: '',
    cost_code: '',
    description: 'TOTAL',
    total_hours: pivoted.reduce((a, r) => a + n(r.total_hours), 0),
    reg_hours: pivoted.reduce((a, r) => a + n(r.reg_hours), 0),
    ot_hours: pivoted.reduce((a, r) => a + n(r.ot_hours), 0),
    cost: pivoted.reduce((a, r) => a + n(r.cost), 0),
    budget: pivoted.reduce((a, r) => a + n(r.budget), 0),
  };
  const totalH = n(summaryRow.total_hours);
  summaryRow.ot_pct = totalH > 0 ? (n(summaryRow.ot_hours) / totalH) * 100 : 0;
  summaryRow.blended_rate = totalH > 0 ? n(summaryRow.cost) / totalH : 0;

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
      key: 'total_hours',
      label: 'Total Hrs',
      align: 'right',
      render: (r) => <span className="text-[#1a1a1a] font-semibold">{fmtNumber(n(r.total_hours), 1)}</span>,
    },
    {
      key: 'reg_hours',
      label: 'Reg Hrs',
      align: 'right',
      render: (r) => <span className="text-[#333]">{fmtNumber(n(r.reg_hours), 1)}</span>,
    },
    {
      key: 'ot_hours',
      label: 'OT Hrs',
      align: 'right',
      render: (r) => {
        const val = n(r.ot_hours);
        return <span className={val > 0 ? 'text-amber-600' : 'text-[#333]'}>{fmtNumber(val, 1)}</span>;
      },
    },
    {
      key: 'ot_pct',
      label: 'OT %',
      align: 'right',
      render: (r) => <span className="text-[#333]">{fmtPercent(n(r.ot_pct))}</span>,
    },
    {
      key: 'cost',
      label: 'Cost',
      align: 'right',
      render: (r) => <span className="text-[#333]">{fmtCurrency(n(r.cost))}</span>,
    },
    {
      key: 'budget',
      label: 'Budget',
      align: 'right',
      render: (r) => <span className="text-[#333]">{fmtCurrency(n(r.budget))}</span>,
    },
    {
      key: 'blended_rate',
      label: '$/Hr',
      align: 'right',
      render: (r) => <span className="text-[#333]">{r.blended_rate != null ? fmtCurrency(n(r.blended_rate)) : '—'}</span>,
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
