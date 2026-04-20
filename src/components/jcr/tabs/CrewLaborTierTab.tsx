'use client';

import { useMemo } from 'react';
import DataTable, { type Column } from '../DataTable';
import TierBadge from '../TierBadge';
import TabHeader from '../TabHeader';
import { type ExportRow, pivotByRecordKey, n, s, fmtCurrency, fmtPercent, fmtNumber, fmtInteger, type PivotedRecord } from '../pivotRows';

interface Props { rows: ExportRow[] }

const TIER_NOTES: Record<string, string> = {
  'Superintendent': 'Project oversight',
  'Lead Journeyman': 'Phase leadership',
  'Journeyman': 'Skilled trade work',
  'Apprentice': 'Training / learning',
  'Helper': 'General assistance',
};

export default function CrewLaborTierTab({ rows }: Props) {
  const tabRows = useMemo(() => rows.filter(r => r.tab === 'Crew & Labor'), [rows]);

  const tiers = useMemo((): PivotedRecord[] => {
    const records = pivotByRecordKey(tabRows);
    return records
      .filter(r => String(r._record_key).startsWith('tier_') && r._record_key !== 'tier_total')
      .map((r): PivotedRecord => {
        const slug = String(r._record_key).replace('tier_', '');
        const tierName = slug.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        return { ...r, _tier_name: tierName };
      });
  }, [tabRows]);

  const totalRec = useMemo(() => {
    const records = pivotByRecordKey(tabRows);
    return records.find(r => r._record_key === 'tier_total');
  }, [tabRows]);

  const blendedRec = useMemo(() => {
    const records = pivotByRecordKey(tabRows);
    return records.find(r => r._record_key === 'blended');
  }, [tabRows]);

  const summaryPrRec = useMemo(() => {
    const records = pivotByRecordKey(tabRows);
    return records.find(r => r._record_key === 'crew_summary_pr');
  }, [tabRows]);

  const compositionRec = useMemo(() => {
    const records = pivotByRecordKey(tabRows);
    return records.find(r => r._record_key === 'composition');
  }, [tabRows]);

  const tierColumns: Column<PivotedRecord>[] = [
    {
      key: '_tier_name',
      label: 'Tier',
      render: (r) => <TierBadge tier={s(r._tier_name)} />,
      sortable: false,
    },
    {
      key: 'rate_range',
      label: 'Rate Range',
      render: (r) => <span className="text-[#333]">{s(r.rate_range) || '—'}</span>,
    },
    {
      key: 'workers',
      label: 'Workers',
      align: 'right',
      render: (r) => <span className="text-[#1a1a1a] font-semibold">{fmtInteger(n(r.workers))}</span>,
    },
    {
      key: '_notes',
      label: 'Notes',
      render: (r) => <span className="text-[#888] font-sans text-[12px]">{TIER_NOTES[s(r._tier_name)] || ''}</span>,
      sortable: false,
    },
  ];

  return (
    <div>
      <TabHeader
        category="Tier Classification"
        title="Crew & Labor"
        subtitle="Worker classification by rate tier with blended labor metrics."
      />

      <DataTable
        columns={tierColumns}
        data={tiers}
        getRowKey={(r) => String(r._record_key)}
      />

      {totalRec && (
        <div className="mt-2 px-3 py-2 bg-[#fafafa] border border-[#e8e8e8] rounded-lg text-[13px] font-mono font-semibold text-[#1a1a1a]">
          Total Crew: {fmtInteger(n(totalRec.total_crew_workers))} workers
        </div>
      )}

      {(blendedRec || summaryPrRec) && (
        <div className="mt-6">
          <h4 className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-3">Blended Labor Metrics</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {summaryPrRec && [
              { label: 'Total Labor Hours', value: fmtNumber(n(summaryPrRec.total_labor_hours_pr), 0) },
              { label: 'Regular Hours', value: fmtNumber(n(summaryPrRec.total_reg_hours_pr), 0) },
              { label: 'OT Hours', value: fmtNumber(n(summaryPrRec.total_ot_hours_pr), 0) },
              { label: 'OT Ratio', value: fmtPercent(n(summaryPrRec.ot_ratio_pr)) },
              { label: 'Blended Gross Wage', value: fmtCurrency(n(summaryPrRec.blended_gross_wage_pr)) },
              { label: 'Total Workers', value: fmtInteger(n(summaryPrRec.total_workers)) },
            ].map(kpi => (
              <div key={kpi.label} className="bg-white border border-[#e8e8e8] rounded-lg px-3 py-2">
                <p className="text-[10px] text-[#999] uppercase tracking-wider">{kpi.label}</p>
                <p className="text-base font-semibold font-mono text-[#1a1a1a]">{kpi.value}</p>
              </div>
            ))}
            {blendedRec?.gross_wages_rate && (
              <div className="bg-white border border-[#e8e8e8] rounded-lg px-3 py-2">
                <p className="text-[10px] text-[#999] uppercase tracking-wider">Gross Wages $/hr</p>
                <p className="text-base font-semibold font-mono text-[#1a1a1a]">{fmtCurrency(n(blendedRec.gross_wages_rate))}</p>
              </div>
            )}
            {blendedRec?.hours_per_unit && (
              <div className="bg-white border border-[#e8e8e8] rounded-lg px-3 py-2">
                <p className="text-[10px] text-[#999] uppercase tracking-wider">Hours per Unit</p>
                <p className="text-base font-semibold font-mono text-[#1a1a1a]">{fmtNumber(n(blendedRec.hours_per_unit), 1)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {compositionRec && (
        <div className="mt-6">
          <h4 className="text-[11px] font-semibold text-[#999] uppercase tracking-wider mb-3">Composition Ratios</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {compositionRec.lead_to_helper_ratio && (
              <div className="bg-white border border-[#e8e8e8] rounded-lg px-3 py-2">
                <p className="text-[10px] text-[#999] uppercase tracking-wider">Lead-to-Helper Ratio</p>
                <p className="text-base font-semibold font-mono text-[#1a1a1a]">{s(compositionRec.lead_to_helper_ratio)}</p>
              </div>
            )}
            {compositionRec.apprentice_ratio != null && (
              <div className="bg-white border border-[#e8e8e8] rounded-lg px-3 py-2">
                <p className="text-[10px] text-[#999] uppercase tracking-wider">Apprentice Ratio</p>
                <p className="text-base font-semibold font-mono text-[#1a1a1a]">{fmtPercent(n(compositionRec.apprentice_ratio))}</p>
              </div>
            )}
            {compositionRec.crew_density_per_100u != null && (
              <div className="bg-white border border-[#e8e8e8] rounded-lg px-3 py-2">
                <p className="text-[10px] text-[#999] uppercase tracking-wider">Crew Density / 100 Units</p>
                <p className="text-base font-semibold font-mono text-[#1a1a1a]">{fmtNumber(n(compositionRec.crew_density_per_100u), 1)}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
