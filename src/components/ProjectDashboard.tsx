'use client';

import { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import DailyNoteCard from './DailyNoteCard';
import StaffingPanel from './StaffingPanel';

// ─── Types ────────────────────────────────────────────────
interface CostCode {
  code: string;
  description: string;
  budget: number;
  actual: number;
  variance: number;
  variancePercent: number;
  status: string;
}

interface ProductionItem {
  code: string;
  description: string;
  budgetHours: number;
  actualHours: number;
  hoursRemaining: number;
  performanceRatio: number;
  status: string;
}

interface ChangeOrder {
  coId: string;
  scope: string;
  proposedAmount: number;
  approvedAmount: number;
  approvalStatus: string;
  dateSubmitted: string;
  isPending: boolean;
  rootCause: string;
  preventability: string;
}

interface DashboardAlert {
  type: string;
  severity: string;
  message: string;
}

interface StaffMember {
  name: string;
  role: string;
}

interface DriftDriver {
  metric: string;
  value: string;
  impact: string;
  severity: 'info' | 'warning' | 'critical';
}

interface DriftData {
  productivityDrift: number;
  productivitySignal: string;
  burnGap: number;
  burnGapSignal: string;
  costBurn: number;
  progressPercent: number;
  rateDrift: number;
  rateDriftSignal: string;
  actualLaborRate: number;
  estimatedLaborRate: number;
  driftRiskScore: number;
  driftRiskLevel: string;
  projectedMarginImpact: number;
  projectedLaborOverrun: number;
  drivers: DriftDriver[];
  recommendations: string[];
}

interface PredictionData {
  estimateAtCompletion: number;
  eacVariance: number;
  eacVariancePercent: number;
  budgetAtRisk: number;
  burnMultiplier: number;
  riskScore: number;
  riskLevel: string;
  laborEAC: number;
  laborVariance: number;
  pendingCOExposure: number;
  topRisks: string[];
  drift?: DriftData;
}

interface DashboardData {
  projectId: string;
  projectName: string;
  projectStatus: string;
  budgetOverview: {
    contractValue: number;
    revisedBudget: number;
    jobToDate: number;
    percentComplete: number;
    totalCOValue: number;
    budgetRemaining: number;
    budgetVariance: number;
    budgetVariancePercent: number;
  };
  costCodes: CostCode[];
  production: {
    items: ProductionItem[];
    totalBudgetHours: number;
    totalActualHours: number;
    overallRatio: number;
  };
  changeOrders: {
    items: ChangeOrder[];
    totalProposed: number;
    totalApproved: number;
    pendingCount: number;
    pendingAmount: number;
  };
  healthScore: number;
  healthStatus: string;
  alerts: DashboardAlert[];
  staffing: StaffMember[];
  recordCounts: Record<string, number>;
}

interface ProjectDoc {
  id: string;
  fileName: string;
  documentType: string | null;
  status: string;
  createdAt: string;
}

interface ProjectDashboardProps {
  projectId: string;
  projectName?: string;
  projectAddress?: string;
  projectTrade?: string;
}

// ─── Helpers ──────────────────────────────────────────────
function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtHrs(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function healthColor(status: string) {
  if (status === 'critical') return { bg: 'bg-red-50', text: 'text-red-600', ring: 'ring-red-200', dot: 'bg-red-500' };
  if (status === 'warning') return { bg: 'bg-amber-50', text: 'text-amber-600', ring: 'ring-amber-200', dot: 'bg-amber-500' };
  return { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-200', dot: 'bg-emerald-500' };
}

function alertIcon(severity: string) {
  if (severity === 'critical') return '🔴';
  if (severity === 'warning') return '🟡';
  return '🔵';
}

// ─── Tab type ─────────────────────────────────────────────
type DashboardTab = 'overview' | 'notes' | 'staffing';

// ─── Main Component ───────────────────────────────────────
export default function ProjectDashboard({ projectId, projectName, projectAddress, projectTrade }: ProjectDashboardProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [data, setData] = useState<DashboardData | null>(null);
  const [prediction, setPrediction] = useState<PredictionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectDocs, setProjectDocs] = useState<ProjectDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    // Fetch dashboard + predictions in parallel
    Promise.all([
      fetch(`/api/dashboard?projectId=${encodeURIComponent(projectId)}`).then((res) => {
        if (res.status === 401) { window.location.href = '/login'; return null; }
        if (!res.ok) throw new Error('Failed to fetch');
        return res.json();
      }),
      fetch(`/api/intelligence?projectId=${encodeURIComponent(projectId)}`).then((res) =>
        res.ok ? res.json() : null
      ).catch(() => null),
    ])
      .then(([dashData, predData]) => {
        if (dashData) setData(dashData);
        if (predData && !predData.error) setPrediction(predData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Fetch project documents
  useEffect(() => {
    if (!projectId) return;
    setDocsLoading(true);
    fetch(`/api/pipeline/list?projectId=${encodeURIComponent(projectId)}`)
      .then((res) => res.ok ? res.json() : null)
      .then((result) => {
        if (result?.items) {
          setProjectDocs(
            result.items.map((item: ProjectDoc) => ({
              id: item.id,
              fileName: item.fileName,
              documentType: item.documentType,
              status: item.status,
              createdAt: item.createdAt,
            }))
          );
        }
      })
      .catch(() => setProjectDocs([]))
      .finally(() => setDocsLoading(false));
  }, [projectId]);

  /* ── Smart prompts for Daily Note (must be before early returns) ── */
  const smartPrompts = useMemo(() => {
    if (!data) return [];
    const prompts: string[] = [];
    const prod = data.production;
    const b = data.budgetOverview;

    // Context-aware: worst production item over hours
    const worstProd = prod.items
      .filter((p) => p.performanceRatio > 1.1)
      .sort((a, b) => b.performanceRatio - a.performanceRatio)[0];

    if (worstProd) {
      const overPct = ((worstProd.performanceRatio - 1) * 100).toFixed(0);
      prompts.push(`${worstProd.description} is ${overPct}% over on hours — what's driving it?`);
    }

    // Context-aware: pending change orders
    if (data.changeOrders.pendingCount > 0) {
      prompts.push(
        `${data.changeOrders.pendingCount} CO${data.changeOrders.pendingCount > 1 ? 's' : ''} pending (${fmt(data.changeOrders.pendingAmount)}) — any GC updates?`
      );
    }

    // Context-aware: drift score elevated
    if (prediction?.drift && prediction.drift.driftRiskScore > 30) {
      prompts.push(`Drift score at ${prediction.drift.driftRiskScore}/100 — anything unusual on site?`);
    }

    // Context-aware: budget over
    if (b.budgetVariancePercent > 5) {
      prompts.push(`Budget is ${b.budgetVariancePercent.toFixed(0)}% over — any scope or efficiency changes?`);
    }

    return prompts;
  }, [data, prediction]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3">
          <div className="w-[48px] h-[48px] rounded-[14px] bg-[#1a1a1a] flex items-center justify-center">
            <motion.svg animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }} width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
            </motion.svg>
          </div>
          <p className="text-[13px] text-[#999]">Loading dashboard...</p>
        </motion.div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-center px-4">
        <div>
          <p className="text-[16px] font-medium text-[#1a1a1a] mb-1">Unable to load dashboard</p>
          <p className="text-[13px] text-[#999]">{error || 'No data'}</p>
        </div>
      </div>
    );
  }

  const hc = healthColor(data.healthStatus);
  const b = data.budgetOverview;
  const prod = data.production;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-20">
      {/* ─── Header ─────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
        <div>
          <h1 className="text-[22px] font-bold text-[#1a1a1a] tracking-[-0.02em]">
            {data.projectName}
          </h1>
          <p className="text-[13px] text-[#999] mt-0.5">{data.projectId} &middot; {data.projectStatus || 'Active'}</p>
        </div>
      </motion.div>

      {/* ─── Tab Bar ──────────────────────────────────── */}
      <div className="flex gap-1 mb-6 border-b border-[#e8e8e8]">
        {([
          { key: 'overview' as DashboardTab, label: 'Overview' },
          { key: 'notes' as DashboardTab, label: 'Daily Notes' },
          { key: 'staffing' as DashboardTab, label: 'Staffing' },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-[13px] font-medium transition-colors relative ${
              activeTab === tab.key
                ? 'text-[#1a1a1a]'
                : 'text-[#999] hover:text-[#6b6b6b]'
            }`}
          >
            {tab.label}
            {activeTab === tab.key && (
              <motion.div
                layoutId="dashboardTab"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#1a1a1a] rounded-full"
              />
            )}
          </button>
        ))}
      </div>

      {/* ─── Daily Notes Tab ──────────────────────────── */}
      {activeTab === 'notes' && (
        <DailyNoteCard projectId={projectId} projectAddress={projectAddress} projectTrade={projectTrade} smartPrompts={smartPrompts} />
      )}

      {/* ─── Staffing Tab ─────────────────────────────── */}
      {activeTab === 'staffing' && (
        <StaffingPanel projectId={projectId} />
      )}

      {/* ─── Overview Tab ─────────────────────────────── */}
      {activeTab === 'overview' && (
      <>
      {/* ─── KPI Cards ──────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6"
      >
        {/* Health Score */}
        <div className={`rounded-2xl p-4 ring-1 ${hc.bg} ${hc.ring}`}>
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#999] mb-1">Health Score</p>
          <div className="flex items-end gap-2">
            <span className={`text-[36px] font-bold leading-none tracking-tight ${hc.text}`}>{data.healthScore}</span>
            <span className="text-[14px] text-[#999] mb-1">/100</span>
          </div>
          <div className="mt-2 w-full h-2 rounded-full bg-white/60">
            <div
              className={`h-2 rounded-full transition-all ${data.healthStatus === 'critical' ? 'bg-red-500' : data.healthStatus === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${data.healthScore}%` }}
            />
          </div>
        </div>

        {/* Budget */}
        <div className="rounded-2xl p-4 ring-1 ring-[#e8e8e8] bg-white">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#999] mb-1">Budget Status</p>
          <div className="flex items-end gap-1.5">
            <span className="text-[22px] font-bold text-[#1a1a1a] leading-none">{fmt(b.jobToDate)}</span>
            <span className="text-[13px] text-[#999] mb-0.5">/ {fmt(b.revisedBudget)}</span>
          </div>
          <div className="mt-2 w-full h-2 rounded-full bg-[#f0f0f0]">
            <div
              className={`h-2 rounded-full ${b.budgetVariancePercent > 5 ? 'bg-red-500' : b.budgetVariancePercent > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(100, b.percentComplete)}%` }}
            />
          </div>
          <p className="text-[11px] text-[#999] mt-1.5">{b.percentComplete.toFixed(0)}% complete</p>
        </div>

        {/* Labor */}
        <div className="rounded-2xl p-4 ring-1 ring-[#e8e8e8] bg-white">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#999] mb-1">Labor Ratio</p>
          <div className="flex items-end gap-1.5">
            <span className={`text-[22px] font-bold leading-none ${prod.overallRatio > 1.15 ? 'text-red-600' : prod.overallRatio > 1.0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {prod.overallRatio.toFixed(2)}
            </span>
          </div>
          <p className="text-[11px] text-[#999] mt-1.5">
            {fmtHrs(prod.totalActualHours)} / {fmtHrs(prod.totalBudgetHours)} hrs
          </p>
          <p className={`text-[11px] mt-0.5 ${prod.overallRatio > 1.0 ? 'text-red-500' : 'text-emerald-500'}`}>
            {prod.overallRatio > 1.0
              ? `${((prod.overallRatio - 1) * 100).toFixed(0)}% over budget`
              : `${((1 - prod.overallRatio) * 100).toFixed(0)}% under budget`}
          </p>
        </div>

        {/* Change Orders */}
        <div className="rounded-2xl p-4 ring-1 ring-[#e8e8e8] bg-white">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#999] mb-1">Change Orders</p>
          <div className="flex items-end gap-1.5">
            <span className="text-[22px] font-bold text-[#1a1a1a] leading-none">{data.changeOrders.items.length}</span>
            <span className="text-[13px] text-[#999] mb-0.5">total</span>
          </div>
          <p className="text-[11px] text-[#999] mt-1.5">
            {fmt(data.changeOrders.totalProposed)} proposed
          </p>
          {data.changeOrders.pendingCount > 0 && (
            <p className="text-[11px] text-amber-600 mt-0.5">
              {data.changeOrders.pendingCount} pending ({fmt(data.changeOrders.pendingAmount)})
            </p>
          )}
        </div>
      </motion.div>

      {/* ─── Predictive Intelligence ────────────────── */}
      {prediction && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="mb-6"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            {/* EAC */}
            <div className={`rounded-2xl p-4 ring-1 ${prediction.eacVariancePercent > 5 ? 'ring-red-200 bg-red-50' : prediction.eacVariancePercent > 0 ? 'ring-amber-200 bg-amber-50' : 'ring-emerald-200 bg-emerald-50'}`}>
              <p className="text-[11px] font-medium uppercase tracking-wider text-[#999] mb-1">Projected at Completion</p>
              <span className={`text-[22px] font-bold leading-none ${prediction.eacVariancePercent > 5 ? 'text-red-600' : prediction.eacVariancePercent > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {fmt(prediction.estimateAtCompletion)}
              </span>
              <p className={`text-[11px] mt-1.5 ${prediction.eacVariance > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                {prediction.eacVariance > 0
                  ? `${fmt(prediction.eacVariance)} over budget`
                  : `${fmt(Math.abs(prediction.eacVariance))} under budget`}
              </p>
            </div>

            {/* Risk Score */}
            <div className={`rounded-2xl p-4 ring-1 ${prediction.riskScore >= 60 ? 'ring-red-200 bg-red-50' : prediction.riskScore >= 30 ? 'ring-amber-200 bg-amber-50' : 'ring-emerald-200 bg-emerald-50'}`}>
              <p className="text-[11px] font-medium uppercase tracking-wider text-[#999] mb-1">Risk Score</p>
              <div className="flex items-end gap-2">
                <span className={`text-[36px] font-bold leading-none tracking-tight ${prediction.riskScore >= 60 ? 'text-red-600' : prediction.riskScore >= 30 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {prediction.riskScore}
                </span>
                <span className="text-[14px] text-[#999] mb-1">/100</span>
              </div>
              <p className="text-[11px] text-[#999] mt-1.5 capitalize">{prediction.riskLevel} risk</p>
            </div>

            {/* Burn Rate */}
            <div className={`rounded-2xl p-4 ring-1 ${prediction.burnMultiplier > 1.15 ? 'ring-red-200 bg-red-50' : prediction.burnMultiplier > 1.0 ? 'ring-amber-200 bg-amber-50' : 'ring-emerald-200 bg-emerald-50'}`}>
              <p className="text-[11px] font-medium uppercase tracking-wider text-[#999] mb-1">Burn Rate</p>
              <span className={`text-[22px] font-bold leading-none ${prediction.burnMultiplier > 1.15 ? 'text-red-600' : prediction.burnMultiplier > 1.0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {prediction.burnMultiplier.toFixed(2)}x
              </span>
              <p className="text-[11px] text-[#999] mt-1.5">
                {prediction.burnMultiplier > 1.0
                  ? `Spending ${((prediction.burnMultiplier - 1) * 100).toFixed(0)}% faster than planned`
                  : 'On track or under-spending'}
              </p>
            </div>
          </div>

          {/* Risk Narrative */}
          {prediction.topRisks.length > 0 && (
            <div className="rounded-2xl ring-1 ring-[#e8e8e8] bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[13px]">&#129504;</span>
                <h3 className="text-[13px] font-semibold text-[#1a1a1a]">Cortex Intelligence</h3>
              </div>
              <div className="space-y-1.5">
                {prediction.topRisks.map((risk, i) => (
                  <p key={i} className="text-[12px] text-[#6b6b6b] flex items-start gap-2">
                    <span className="text-[10px] mt-0.5">&#x2022;</span>
                    {risk}
                  </p>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* ─── Drift Intelligence ──────────────────────── */}
      {prediction?.drift && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.09 }}
          className="mb-6"
        >
          <div className="rounded-2xl ring-1 ring-[#e8e8e8] overflow-hidden">
            {/* Dark header bar */}
            <div className="px-5 py-3 bg-[#1a1a1a] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                </div>
                <h3 className="text-[13px] font-semibold text-white">Drift Intelligence</h3>
              </div>
              <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                prediction.drift.driftRiskLevel === 'critical' ? 'bg-red-500/20 text-red-300' :
                prediction.drift.driftRiskLevel === 'high' ? 'bg-orange-500/20 text-orange-300' :
                prediction.drift.driftRiskLevel === 'medium' ? 'bg-amber-500/20 text-amber-300' :
                'bg-emerald-500/20 text-emerald-300'
              }`}>
                {prediction.drift.driftRiskLevel} drift
              </div>
            </div>

            {/* 3 Predictors + Composite Score */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#e8e8e8]">
              {/* Productivity Drift */}
              <div className="bg-white p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className={`w-2 h-2 rounded-full ${
                    prediction.drift.productivitySignal === 'high' ? 'bg-red-500' :
                    prediction.drift.productivitySignal === 'watch' ? 'bg-amber-500' : 'bg-emerald-500'
                  }`} />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[#999]">Productivity</span>
                </div>
                <span className={`text-[24px] font-bold leading-none tracking-tight ${
                  prediction.drift.productivityDrift > 10 ? 'text-red-600' :
                  prediction.drift.productivityDrift > 5 ? 'text-amber-600' : 'text-emerald-600'
                }`}>
                  {prediction.drift.productivityDrift > 0 ? '+' : ''}{prediction.drift.productivityDrift.toFixed(1)}%
                </span>
                <p className="text-[10px] text-[#999] mt-1">hrs actual vs estimated</p>
              </div>

              {/* Burn Gap */}
              <div className="bg-white p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className={`w-2 h-2 rounded-full ${
                    prediction.drift.burnGapSignal === 'high' ? 'bg-red-500' :
                    prediction.drift.burnGapSignal === 'watch' ? 'bg-amber-500' : 'bg-emerald-500'
                  }`} />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[#999]">Burn Gap</span>
                </div>
                <span className={`text-[24px] font-bold leading-none tracking-tight ${
                  prediction.drift.burnGap > 10 ? 'text-red-600' :
                  prediction.drift.burnGap > 5 ? 'text-amber-600' : 'text-emerald-600'
                }`}>
                  {prediction.drift.burnGap > 0 ? '+' : ''}{prediction.drift.burnGap.toFixed(1)}%
                </span>
                <p className="text-[10px] text-[#999] mt-1">
                  {prediction.drift.costBurn.toFixed(0)}% spent · {prediction.drift.progressPercent.toFixed(0)}% done
                </p>
              </div>

              {/* Rate Creep */}
              <div className="bg-white p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className={`w-2 h-2 rounded-full ${
                    prediction.drift.rateDriftSignal === 'high' ? 'bg-red-500' :
                    prediction.drift.rateDriftSignal === 'watch' ? 'bg-amber-500' : 'bg-emerald-500'
                  }`} />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[#999]">Rate Creep</span>
                </div>
                <span className={`text-[24px] font-bold leading-none tracking-tight ${
                  prediction.drift.rateDrift > 10 ? 'text-red-600' :
                  prediction.drift.rateDrift > 5 ? 'text-amber-600' : 'text-emerald-600'
                }`}>
                  {prediction.drift.rateDrift > 0 ? '+' : ''}{prediction.drift.rateDrift.toFixed(1)}%
                </span>
                <p className="text-[10px] text-[#999] mt-1">
                  ${prediction.drift.actualLaborRate.toFixed(0)}/hr vs ${prediction.drift.estimatedLaborRate.toFixed(0)}/hr est
                </p>
              </div>

              {/* Composite Drift Risk Score */}
              <div className={`p-4 ${
                prediction.drift.driftRiskLevel === 'critical' ? 'bg-red-50' :
                prediction.drift.driftRiskLevel === 'high' ? 'bg-orange-50' :
                prediction.drift.driftRiskLevel === 'medium' ? 'bg-amber-50' : 'bg-emerald-50'
              }`}>
                <span className="text-[10px] font-medium uppercase tracking-wider text-[#999]">Drift Score</span>
                <div className="flex items-end gap-1.5 mt-2">
                  <span className={`text-[36px] font-bold leading-none tracking-tight ${
                    prediction.drift.driftRiskScore >= 75 ? 'text-red-600' :
                    prediction.drift.driftRiskScore >= 50 ? 'text-orange-600' :
                    prediction.drift.driftRiskScore >= 25 ? 'text-amber-600' : 'text-emerald-600'
                  }`}>
                    {prediction.drift.driftRiskScore}
                  </span>
                  <span className="text-[14px] text-[#999] mb-1">/100</span>
                </div>
              </div>
            </div>

            {/* Drivers + Recommendations */}
            {prediction.drift.drivers.length > 0 && prediction.drift.drivers[0].metric !== 'All metrics' && (
              <div className="border-t border-[#e8e8e8] bg-white">
                <div className="px-5 py-3 border-b border-[#f5f5f5]">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-[#999] mb-2">Risk Drivers</p>
                  <div className="space-y-2">
                    {prediction.drift.drivers.map((d, i) => (
                      <div key={i} className="flex items-center gap-2 flex-wrap">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          d.severity === 'critical' ? 'bg-red-500' : d.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-400'
                        }`} />
                        <span className="text-[12px] font-medium text-[#1a1a1a]">{d.metric}</span>
                        <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
                          d.severity === 'critical' ? 'bg-red-50 text-red-600' :
                          d.severity === 'warning' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'
                        }`}>{d.value}</span>
                        <span className="text-[11px] text-[#999]">{d.impact}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {prediction.drift.recommendations.length > 0 && (
                  <div className="px-5 py-3">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-[#999] mb-2">Recommended Actions</p>
                    <div className="space-y-1.5">
                      {prediction.drift.recommendations.map((rec, i) => (
                        <p key={i} className="text-[12px] text-[#6b6b6b] flex items-start gap-2">
                          <span className="text-[10px] text-amber-500 mt-0.5">&#x25B6;</span>
                          {rec}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Projected Impact Footer */}
            {(prediction.drift.projectedMarginImpact > 0 || prediction.drift.projectedLaborOverrun > 0) && (
              <div className="border-t border-[#e8e8e8] px-5 py-2.5 bg-[#fafafa] flex items-center gap-4 flex-wrap">
                {prediction.drift.projectedMarginImpact > 0 && (
                  <span className="text-[11px] text-[#999]">
                    Projected margin impact: <span className="font-semibold text-red-600">{fmt(prediction.drift.projectedMarginImpact)}</span>
                  </span>
                )}
                {prediction.drift.projectedLaborOverrun > 0 && (
                  <span className="text-[11px] text-[#999]">
                    Labor overrun: <span className="font-semibold text-red-600">{fmt(prediction.drift.projectedLaborOverrun)}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ─── Alerts ─────────────────────────────────── */}
      {data.alerts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-6 rounded-2xl ring-1 ring-[#e8e8e8] bg-white overflow-hidden"
        >
          <div className="px-5 py-3 border-b border-[#f0f0f0] flex items-center gap-2">
            <span className="text-[14px]">&#9888;&#65039;</span>
            <h3 className="text-[13px] font-semibold text-[#1a1a1a]">Active Alerts</h3>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#f0f0f0] text-[#666]">{data.alerts.length}</span>
          </div>
          <div className="divide-y divide-[#f5f5f5]">
            {data.alerts.map((alert, i) => (
              <div key={i} className="px-5 py-2.5 flex items-start gap-2.5">
                <span className="text-[12px] mt-0.5">{alertIcon(alert.severity)}</span>
                <div>
                  <span className="text-[12px] text-[#37352f]">{alert.message}</span>
                  <span className="text-[10px] text-[#999] ml-2 uppercase">{alert.type.replace('_', ' ')}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ─── Two-Column: Production + Change Orders ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Production Performance */}
        {prod.items.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="rounded-2xl ring-1 ring-[#e8e8e8] bg-white overflow-hidden"
          >
            <div className="px-5 py-3 border-b border-[#f0f0f0]">
              <h3 className="text-[13px] font-semibold text-[#1a1a1a]">Production Performance</h3>
              <p className="text-[11px] text-[#999]">Labor hours by activity — ratio &gt; 1.0 = over budget</p>
            </div>
            <div className="divide-y divide-[#f5f5f5]">
              {prod.items.map((p, i) => {
                const maxRatio = Math.max(...prod.items.map(x => x.performanceRatio), 1.5);
                const barWidth = Math.min(100, (p.performanceRatio / maxRatio) * 100);
                return (
                  <div key={i} className="px-5 py-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex-1 min-w-0">
                        <span className="text-[12px] font-medium text-[#1a1a1a]">{p.code}</span>
                        <span className="text-[11px] text-[#999] ml-1.5 truncate">{p.description}</span>
                      </div>
                      <span className={`text-[13px] font-bold ml-3 ${p.status === 'critical' ? 'text-red-600' : p.status === 'warning' ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {p.performanceRatio.toFixed(2)}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-[#f0f0f0]">
                      <div
                        className={`h-2 rounded-full transition-all ${p.status === 'critical' ? 'bg-red-400' : p.status === 'warning' ? 'bg-amber-400' : 'bg-emerald-400'}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-[10px] text-[#999]">{fmtHrs(p.actualHours)} / {fmtHrs(p.budgetHours)} hrs</span>
                      <span className={`text-[10px] ${p.performanceRatio > 1 ? 'text-red-500' : 'text-emerald-500'}`}>
                        {p.performanceRatio > 1
                          ? `+${fmtHrs(p.actualHours - p.budgetHours)} hrs over`
                          : `${fmtHrs(p.budgetHours - p.actualHours)} hrs under`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Change Orders */}
        {data.changeOrders.items.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="rounded-2xl ring-1 ring-[#e8e8e8] bg-white overflow-hidden"
          >
            <div className="px-5 py-3 border-b border-[#f0f0f0]">
              <h3 className="text-[13px] font-semibold text-[#1a1a1a]">Change Orders</h3>
              <p className="text-[11px] text-[#999]">
                {fmt(data.changeOrders.totalProposed)} total
                {data.changeOrders.pendingCount > 0 && ` · ${data.changeOrders.pendingCount} pending`}
              </p>
            </div>
            <div className="divide-y divide-[#f5f5f5] max-h-[400px] overflow-y-auto">
              {data.changeOrders.items.map((co, i) => (
                <div key={i} className="px-5 py-3">
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-[#1a1a1a]">{co.coId || `CO-${i + 1}`}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        co.isPending
                          ? 'bg-amber-50 text-amber-700'
                          : co.approvalStatus.toLowerCase().includes('approv')
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {co.approvalStatus || 'Unknown'}
                      </span>
                    </div>
                    <span className="text-[13px] font-semibold text-[#1a1a1a]">{fmt(co.proposedAmount)}</span>
                  </div>
                  <p className="text-[11px] text-[#6b6b6b] line-clamp-2">{co.scope}</p>
                  {(co.rootCause || co.preventability) && (
                    <div className="flex items-center gap-2 mt-1">
                      {co.rootCause && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                          {co.rootCause}
                        </span>
                      )}
                      {co.preventability && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          co.preventability === 'Preventable'
                            ? 'bg-red-50 text-red-700'
                            : co.preventability === 'Not Preventable'
                            ? 'bg-gray-100 text-gray-600'
                            : co.preventability === 'Partially Preventable'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-purple-50 text-purple-700'
                        }`}>
                          {co.preventability}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {/* ─── Project Documents ──────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.28 }}
        className="mb-6 rounded-2xl ring-1 ring-[#e8e8e8] bg-white overflow-hidden"
      >
        <div className="px-5 py-3 border-b border-[#f0f0f0] flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b6b6b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          <h3 className="text-[13px] font-semibold text-[#1a1a1a]">Project Documents</h3>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#f0f0f0] text-[#666]">{projectDocs.length}</span>
        </div>
        {docsLoading ? (
          <div className="px-5 py-4">
            <p className="text-[12px] text-[#999]">Loading documents...</p>
          </div>
        ) : projectDocs.length === 0 ? (
          <div className="px-5 py-4">
            <p className="text-[12px] text-[#999]">No documents uploaded yet</p>
          </div>
        ) : (
          <div className="divide-y divide-[#f5f5f5]">
            {projectDocs.map((doc) => (
              <div key={doc.id} className="px-5 py-2.5 flex items-center gap-3">
                <span className="flex-shrink-0 text-[13px]">
                  {doc.status === 'pushed' ? '✅' : doc.status === 'approved' ? '🟢' : doc.status === 'rejected' ? '🔴' : '🟡'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-[#1a1a1a] truncate">{doc.fileName}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {doc.documentType && (
                      <span className="text-[10px] text-[#999]">{doc.documentType}</span>
                    )}
                    <span className="text-[10px] text-[#ccc]">·</span>
                    <span className={`text-[10px] ${
                      doc.status === 'pushed' ? 'text-emerald-600' :
                      doc.status === 'approved' ? 'text-blue-600' :
                      doc.status === 'rejected' ? 'text-red-600' :
                      'text-amber-600'
                    }`}>
                      {doc.status === 'pushed' ? 'In Database' :
                       doc.status === 'pending_review' ? 'Pending Review' :
                       doc.status === 'approved' ? 'Approved' :
                       doc.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      </>
      )}
    </div>
  );
}
