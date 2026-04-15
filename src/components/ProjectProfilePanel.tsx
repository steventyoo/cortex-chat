'use client';

import { useState, useEffect, useCallback } from 'react';

interface ProfileSnapshot {
  id: string;
  snapshot_date: string;
  document_counts: Record<string, number>;
  total_documents: number;
  contract_value: number | null;
  revised_budget: number | null;
  job_to_date_cost: number | null;
  percent_complete: number | null;
  projected_final_cost: number | null;
  projected_margin: number | null;
  projected_margin_pct: number | null;
  total_budget_hours: number | null;
  total_actual_hours: number | null;
  labor_productivity_ratio: number | null;
  blended_labor_rate: number | null;
  estimated_labor_rate: number | null;
  total_cos: number;
  total_co_value: number;
  approved_co_value: number;
  pending_co_value: number;
  co_absorption_rate: number | null;
  risk_score: number | null;
  risk_level: string | null;
  productivity_drift: number | null;
  burn_gap: number | null;
  rate_drift: number | null;
  reconciliation_pass_rate: number | null;
  reconciliation_warnings: number;
  reconciliation_failures: number;
  coverage_score: number | null;
  covered_cost_codes: number;
  missing_cost_codes: number;
  top_subs: Array<{ name: string; bidAmount: number; coCount: number }> | null;
  sub_co_rate: number | null;
  created_at: string;
}

interface ProjectProfilePanelProps {
  projectId: string | null;
}

export default function ProjectProfilePanel({ projectId }: ProjectProfilePanelProps) {
  const [profile, setProfile] = useState<ProfileSnapshot | null>(null);
  const [history, setHistory] = useState<ProfileSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/project-profile?projectId=${projectId}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setProfile(data.latest);
      setHistory(data.history || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const refreshProfile = async () => {
    if (!projectId || refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/project-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error(await res.text());
      await fetchProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh profile');
    } finally {
      setRefreshing(false);
    }
  };

  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-12 h-12 rounded-xl bg-[#f5f5f5] flex items-center justify-center mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </svg>
        </div>
        <p className="text-[14px] text-[#666] mb-1">Select a project from the dropdown</p>
        <p className="text-[12px] text-[#999]">The project profile aggregates financial, labor, risk, and coverage KPIs</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <svg className="animate-spin w-5 h-5 text-[#999]" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" />
        </svg>
        <span className="ml-2 text-[13px] text-[#999]">Loading project profile...</span>
      </div>
    );
  }

  const prev = history.length > 1 ? history[1] : null;

  return (
    <div className="min-h-[400px]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[#e8e8e8] flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-semibold text-[#1a1a1a]">Project Profile</h3>
          {profile && (
            <p className="text-[11px] text-[#999] mt-0.5">
              Snapshot: {profile.snapshot_date} &middot; {profile.total_documents} documents
            </p>
          )}
        </div>
        <button
          onClick={refreshProfile}
          disabled={refreshing}
          className="px-3.5 py-1.5 bg-[#1a1a1a] text-white text-[12px] font-medium rounded-lg hover:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
        >
          {refreshing ? (
            <>
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" />
              </svg>
              Refreshing...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
              </svg>
              Refresh Profile
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-[13px] text-red-700 flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          {error}
        </div>
      )}

      {!profile ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-xl bg-[#f5f5f5] flex items-center justify-center mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18" />
              <path d="M9 21V9" />
            </svg>
          </div>
          <p className="text-[14px] text-[#666] mb-1">No profile snapshot yet</p>
          <p className="text-[12px] text-[#999] mb-4">Click &quot;Refresh Profile&quot; to generate the first snapshot</p>
        </div>
      ) : (
        <div className="px-6 py-5 space-y-6">
          {/* Risk Banner */}
          <RiskBanner
            riskScore={profile.risk_score}
            riskLevel={profile.risk_level}
            productivityDrift={profile.productivity_drift}
            burnGap={profile.burn_gap}
            rateDrift={profile.rate_drift}
          />

          {/* Financial KPIs */}
          <Section title="Financial Overview">
            <div className="grid grid-cols-4 gap-3">
              <KpiCard label="Contract Value" value={fmtCurrency(profile.contract_value)} prev={prev ? fmtCurrency(prev.contract_value) : undefined} />
              <KpiCard label="Revised Budget" value={fmtCurrency(profile.revised_budget)} />
              <KpiCard label="Job to Date Cost" value={fmtCurrency(profile.job_to_date_cost)} delta={computeDelta(profile.job_to_date_cost, prev?.job_to_date_cost)} />
              <KpiCard label="% Complete" value={profile.percent_complete ? `${profile.percent_complete.toFixed(1)}%` : '—'} delta={computeDelta(profile.percent_complete, prev?.percent_complete)} />
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <KpiCard label="Projected Final Cost" value={fmtCurrency(profile.projected_final_cost)} highlight={profile.projected_final_cost && profile.revised_budget && profile.projected_final_cost > profile.revised_budget ? 'danger' : undefined} />
              <KpiCard label="Projected Margin" value={fmtCurrency(profile.projected_margin)} highlight={profile.projected_margin && profile.projected_margin < 0 ? 'danger' : undefined} />
              <KpiCard label="Margin %" value={profile.projected_margin_pct ? `${profile.projected_margin_pct.toFixed(1)}%` : '—'} highlight={profile.projected_margin_pct && profile.projected_margin_pct < 0 ? 'danger' : undefined} />
            </div>
          </Section>

          {/* Labor KPIs */}
          <Section title="Labor & Productivity">
            <div className="grid grid-cols-4 gap-3">
              <KpiCard label="Budget Hours" value={fmtNumber(profile.total_budget_hours)} />
              <KpiCard label="Actual Hours" value={fmtNumber(profile.total_actual_hours)} delta={computeDelta(profile.total_actual_hours, prev?.total_actual_hours)} />
              <KpiCard
                label="Productivity Ratio"
                value={profile.labor_productivity_ratio ? profile.labor_productivity_ratio.toFixed(3) : '—'}
                subtitle={profile.labor_productivity_ratio ? (profile.labor_productivity_ratio < 1 ? 'Under budget' : 'Over budget') : undefined}
                highlight={profile.labor_productivity_ratio && profile.labor_productivity_ratio > 1.05 ? 'danger' : profile.labor_productivity_ratio && profile.labor_productivity_ratio < 0.95 ? 'success' : undefined}
              />
              <KpiCard label="Blended Rate" value={profile.blended_labor_rate ? `$${profile.blended_labor_rate.toFixed(2)}/hr` : '—'} subtitle={profile.estimated_labor_rate ? `Est: $${profile.estimated_labor_rate.toFixed(2)}/hr` : undefined} />
            </div>
          </Section>

          {/* Change Orders */}
          <Section title="Change Orders">
            <div className="grid grid-cols-4 gap-3">
              <KpiCard label="Total COs" value={String(profile.total_cos)} />
              <KpiCard label="Total CO Value" value={fmtCurrency(profile.total_co_value)} />
              <KpiCard label="Approved" value={fmtCurrency(profile.approved_co_value)} />
              <KpiCard label="Pending" value={fmtCurrency(profile.pending_co_value)} highlight={profile.pending_co_value > 0 ? 'warning' : undefined} />
            </div>
            {profile.co_absorption_rate != null && (
              <div className="mt-3">
                <KpiCard label="CO Absorption Rate" value={`${profile.co_absorption_rate.toFixed(1)}%`} subtitle="How much of CO value is reflected in the revised budget" />
              </div>
            )}
          </Section>

          {/* Reconciliation & Coverage */}
          <div className="grid grid-cols-2 gap-4">
            <Section title="Reconciliation">
              <div className="grid grid-cols-3 gap-3">
                <KpiCard label="Pass Rate" value={profile.reconciliation_pass_rate != null ? `${profile.reconciliation_pass_rate.toFixed(0)}%` : '—'} highlight={profile.reconciliation_pass_rate != null && profile.reconciliation_pass_rate < 80 ? 'danger' : profile.reconciliation_pass_rate != null && profile.reconciliation_pass_rate < 95 ? 'warning' : 'success'} />
                <KpiCard label="Warnings" value={String(profile.reconciliation_warnings)} highlight={profile.reconciliation_warnings > 0 ? 'warning' : undefined} />
                <KpiCard label="Failures" value={String(profile.reconciliation_failures)} highlight={profile.reconciliation_failures > 0 ? 'danger' : undefined} />
              </div>
            </Section>
            <Section title="Coverage">
              <div className="grid grid-cols-3 gap-3">
                <KpiCard label="Score" value={profile.coverage_score != null ? `${profile.coverage_score.toFixed(0)}%` : '—'} highlight={profile.coverage_score != null && profile.coverage_score < 50 ? 'danger' : profile.coverage_score != null && profile.coverage_score < 80 ? 'warning' : 'success'} />
                <KpiCard label="Covered Codes" value={String(profile.covered_cost_codes)} />
                <KpiCard label="Missing Codes" value={String(profile.missing_cost_codes)} highlight={profile.missing_cost_codes > 0 ? 'warning' : undefined} />
              </div>
            </Section>
          </div>

          {/* Document Inventory */}
          <Section title="Document Inventory">
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(profile.document_counts)
                .sort(([, a], [, b]) => b - a)
                .map(([skill, count]) => (
                  <div key={skill} className="px-3 py-2 bg-[#fafafa] border border-[#e8e8e8] rounded-lg">
                    <div className="text-[12px] text-[#999] truncate" title={skill}>{formatSkillName(skill)}</div>
                    <div className="text-[16px] font-semibold text-[#1a1a1a]">{count}</div>
                  </div>
                ))}
            </div>
          </Section>

          {/* Top Subs */}
          {profile.top_subs && profile.top_subs.length > 0 && (
            <Section title="Top Subcontractors">
              <div className="border border-[#e8e8e8] rounded-lg overflow-hidden">
                <div className="px-4 py-2 flex items-center gap-4 bg-[#fafafa] text-[10px] font-semibold text-[#999] uppercase tracking-wider">
                  <div className="flex-1">Name</div>
                  <div className="w-28 text-right">Bid Amount</div>
                  <div className="w-16 text-center">COs</div>
                </div>
                {profile.top_subs.map((sub, i) => (
                  <div key={i} className="px-4 py-2 flex items-center gap-4 border-t border-[#f0f0f0]">
                    <div className="flex-1 text-[12px] text-[#444] truncate">{sub.name}</div>
                    <div className="w-28 text-right text-[12px] font-mono text-[#444]">{fmtCurrency(sub.bidAmount)}</div>
                    <div className="w-16 text-center">
                      {sub.coCount > 0 ? (
                        <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-[10px] font-semibold rounded-full">{sub.coCount}</span>
                      ) : (
                        <span className="text-[12px] text-[#999]">0</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {profile.sub_co_rate != null && (
                <p className="text-[11px] text-[#999] mt-2">{profile.sub_co_rate.toFixed(0)}% of subcontractors have change orders</p>
              )}
            </Section>
          )}

          {/* History sparkline bar */}
          {history.length > 1 && (
            <Section title="Snapshot History">
              <div className="flex items-end gap-1 h-16">
                {history.slice().reverse().map((snap, i) => {
                  const maxDoc = Math.max(...history.map(h => h.total_documents || 1));
                  const height = Math.max(8, ((snap.total_documents || 0) / maxDoc) * 100);
                  const isLatest = i === history.length - 1;
                  return (
                    <div key={snap.id} className="flex-1 flex flex-col items-center gap-1" title={`${snap.snapshot_date}: ${snap.total_documents} docs`}>
                      <div
                        className={`w-full rounded-sm transition-all ${isLatest ? 'bg-[#1a1a1a]' : 'bg-[#ddd]'}`}
                        style={{ height: `${height}%` }}
                      />
                      <span className="text-[9px] text-[#999]">{snap.snapshot_date.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function RiskBanner({ riskScore, riskLevel, productivityDrift, burnGap, rateDrift }: {
  riskScore: number | null; riskLevel: string | null;
  productivityDrift: number | null; burnGap: number | null; rateDrift: number | null;
}) {
  if (riskScore == null) return null;

  const config: Record<string, { bg: string; border: string; text: string; icon: string }> = {
    low: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', icon: '✓' },
    moderate: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', icon: '⚠' },
    high: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', icon: '⚠' },
    critical: { bg: 'bg-red-100', border: 'border-red-300', text: 'text-red-900', icon: '✕' },
  };

  const c = config[riskLevel || 'low'] || config.low;

  return (
    <div className={`px-5 py-4 rounded-xl border ${c.bg} ${c.border}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`text-[20px] ${c.text}`}>{c.icon}</span>
          <div>
            <div className={`text-[14px] font-semibold ${c.text}`}>
              Risk: {(riskLevel || 'Unknown').charAt(0).toUpperCase() + (riskLevel || 'unknown').slice(1)}
            </div>
            <div className={`text-[12px] ${c.text} opacity-80`}>
              Score: {riskScore.toFixed(1)} / 100
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6 text-[12px]">
          {productivityDrift != null && (
            <div className={c.text}>
              <span className="opacity-60">Productivity drift:</span>{' '}
              <span className="font-semibold">{productivityDrift > 0 ? '+' : ''}{productivityDrift.toFixed(1)}%</span>
            </div>
          )}
          {burnGap != null && (
            <div className={c.text}>
              <span className="opacity-60">Burn gap:</span>{' '}
              <span className="font-semibold">{burnGap > 0 ? '+' : ''}{burnGap.toFixed(1)}%</span>
            </div>
          )}
          {rateDrift != null && (
            <div className={c.text}>
              <span className="opacity-60">Rate drift:</span>{' '}
              <span className="font-semibold">{rateDrift > 0 ? '+' : ''}{rateDrift.toFixed(1)}%</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[12px] font-semibold text-[#999] uppercase tracking-wider mb-3">{title}</h4>
      {children}
    </div>
  );
}

function KpiCard({ label, value, subtitle, delta, highlight }: {
  label: string; value: string; subtitle?: string;
  delta?: { value: string; direction: 'up' | 'down' | 'flat' } | null;
  highlight?: 'success' | 'warning' | 'danger';
}) {
  const highlightBorder: Record<string, string> = {
    success: 'border-green-200 bg-green-50/30',
    warning: 'border-amber-200 bg-amber-50/30',
    danger: 'border-red-200 bg-red-50/30',
  };
  const border = highlight ? highlightBorder[highlight] : 'border-[#e8e8e8]';

  return (
    <div className={`px-3.5 py-3 rounded-lg border ${border}`}>
      <div className="text-[11px] text-[#999] font-medium mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-[18px] font-bold text-[#1a1a1a]">{value}</span>
        {delta && (
          <span className={`text-[11px] font-medium ${delta.direction === 'up' ? 'text-red-500' : delta.direction === 'down' ? 'text-green-500' : 'text-[#999]'}`}>
            {delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : '→'} {delta.value}
          </span>
        )}
      </div>
      {subtitle && <div className="text-[10px] text-[#999] mt-0.5">{subtitle}</div>}
    </div>
  );
}

function fmtCurrency(val: number | null): string {
  if (val == null || val === 0) return '—';
  const abs = Math.abs(val);
  if (abs >= 1_000_000) {
    return `${val < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${val < 0 ? '-' : ''}$${(abs / 1_000).toFixed(1)}K`;
  }
  return `${val < 0 ? '-' : ''}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNumber(val: number | null): string {
  if (val == null || val === 0) return '—';
  return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function computeDelta(current: number | null, previous: number | null): { value: string; direction: 'up' | 'down' | 'flat' } | null {
  if (current == null || previous == null || previous === 0) return null;
  const diff = current - previous;
  const pct = Math.abs((diff / previous) * 100);
  if (pct < 0.5) return { value: `${pct.toFixed(1)}%`, direction: 'flat' };
  return { value: `${pct.toFixed(1)}%`, direction: diff > 0 ? 'up' : 'down' };
}

function formatSkillName(skill: string): string {
  return skill.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
