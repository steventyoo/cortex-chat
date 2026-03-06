'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ProjectHealth, ProjectAlert } from '@/lib/types';
import ProjectHealthCard from './ProjectHealthCard';
import AlertsBanner from './AlertsBanner';

interface DashboardProps {
  onSelectProject: (projectId: string) => void;
  onSendMessage: (message: string) => void;
}

interface Insight {
  type: string;
  severity: string;
  title: string;
  detail: string;
  projects: string[];
  action: string;
}

interface PortfolioIntelligence {
  portfolio?: {
    totalBudgetAtRisk: number;
    averageRiskScore: number;
    portfolioRisk: string;
  };
  projects?: Array<{
    projectName: string;
    riskScore: number;
    riskLevel: string;
    eacVariancePercent: number;
    budgetAtRisk: number;
    burnMultiplier: number;
  }>;
  insights?: Array<{
    type: string;
    severity: string;
    message: string;
    projects: string[];
  }>;
}

const QUICK_ACTIONS = [
  { label: 'Portfolio overview', icon: '🧠', query: 'How are all projects doing? Show me a cross-project comparison with risk levels.' },
  { label: 'Budget risks', icon: '💰', query: 'Which projects are trending over budget? Show projected cost at completion.' },
  { label: 'Labor anomalies', icon: '👷', query: 'Are there any labor performance anomalies across projects?' },
  { label: 'Pending exposure', icon: '📝', query: 'What is our total pending change order exposure across all projects?' },
];

export default function Dashboard({ onSelectProject, onSendMessage }: DashboardProps) {
  const [healthData, setHealthData] = useState<ProjectHealth[]>([]);
  const [intelligence, setIntelligence] = useState<PortfolioIntelligence | null>(null);
  const [aiInsights, setAiInsights] = useState<Insight[]>([]);
  const [aiSummary, setAiSummary] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAll() {
      try {
        // Fetch health data + portfolio intelligence in parallel
        const [healthRes, intelRes] = await Promise.all([
          fetch('/api/project-health'),
          fetch('/api/intelligence').catch(() => null),
        ]);

        if (healthRes.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (!healthRes.ok) throw new Error('Failed to fetch');
        const healthJson = await healthRes.json();
        setHealthData(healthJson);

        if (intelRes?.ok) {
          const intelJson = await intelRes.json();
          setIntelligence(intelJson);
        }

        // Fetch AI insights in background (slower call)
        fetch('/api/insights')
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            if (data?.insights) setAiInsights(data.insights);
            if (data?.portfolioSummary) setAiSummary(data.portfolioSummary);
          })
          .catch(() => {});

      } catch (err) {
        console.error('Dashboard fetch error:', err);
        setError('Unable to load project health data');
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, []);

  // Separate active vs completed projects
  const activeProjects = healthData.filter(
    (p) => !p.status.toLowerCase().includes('complete') && !p.status.toLowerCase().includes('closed')
  );
  const completedProjects = healthData.filter(
    (p) => p.status.toLowerCase().includes('complete') || p.status.toLowerCase().includes('closed')
  );

  // Collect all alerts from active projects only
  const allAlerts: ProjectAlert[] = activeProjects.flatMap((p) => p.alerts);

  const handleAlertClick = (projectId: string) => {
    onSelectProject(projectId);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="w-[52px] h-[52px] rounded-[14px] bg-[#1a1a1a] flex items-center justify-center">
            <motion.svg
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
            </motion.svg>
          </div>
          <p className="text-[14px] text-[#999]">Loading project health data...</p>
        </motion.div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-[52px] h-[52px] rounded-[14px] bg-[#1a1a1a] flex items-center justify-center mb-5">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="text-[22px] font-semibold text-[#1a1a1a] mb-1.5 tracking-[-0.02em]">
          Project Cortex
        </h2>
        <p className="text-[14px] text-[#999] mb-4">{error}</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center min-h-[60vh]"
    >
      {/* Header */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200, delay: 0.1 }}
        className="w-[44px] h-[44px] rounded-[12px] bg-[#1a1a1a] flex items-center justify-center mb-4"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </motion.div>

      <motion.h2
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="text-[20px] font-semibold text-[#1a1a1a] mb-0.5 tracking-[-0.02em]"
      >
        Good {getTimeOfDay()}
      </motion.h2>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-[14px] text-[#999] mb-6"
      >
        {activeProjects.length} active project{activeProjects.length !== 1 ? 's' : ''}
        {completedProjects.length > 0 && ` · ${completedProjects.length} completed`}
      </motion.p>

      {/* Alerts Banner */}
      {allAlerts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="w-full max-w-2xl mb-5"
        >
          <AlertsBanner alerts={allAlerts} onAlertClick={handleAlertClick} />
        </motion.div>
      )}

      {/* Portfolio Intelligence */}
      {(intelligence?.portfolio || aiInsights.length > 0 || aiSummary) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.27 }}
          className="w-full max-w-2xl mb-5"
        >
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#aeaeb2] mb-2.5 px-1">
            Cortex Intelligence
          </p>

          {/* Portfolio risk metrics */}
          {intelligence?.portfolio && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className={`rounded-xl p-3 ring-1 ${intelligence.portfolio.totalBudgetAtRisk > 50000 ? 'ring-red-200 bg-red-50' : 'ring-emerald-200 bg-emerald-50'}`}>
                <p className="text-[10px] font-medium uppercase tracking-wider text-[#999]">Budget at Risk</p>
                <p className={`text-[18px] font-bold ${intelligence.portfolio.totalBudgetAtRisk > 50000 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {intelligence.portfolio.totalBudgetAtRisk >= 1000
                    ? `$${Math.round(intelligence.portfolio.totalBudgetAtRisk / 1000)}K`
                    : `$${Math.round(intelligence.portfolio.totalBudgetAtRisk)}`}
                </p>
              </div>
              <div className={`rounded-xl p-3 ring-1 ${intelligence.portfolio.averageRiskScore >= 40 ? 'ring-amber-200 bg-amber-50' : 'ring-emerald-200 bg-emerald-50'}`}>
                <p className="text-[10px] font-medium uppercase tracking-wider text-[#999]">Avg Risk</p>
                <p className={`text-[18px] font-bold ${intelligence.portfolio.averageRiskScore >= 40 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {Math.round(intelligence.portfolio.averageRiskScore)}/100
                </p>
              </div>
              <div className={`rounded-xl p-3 ring-1 ${intelligence.portfolio.portfolioRisk === 'critical' ? 'ring-red-200 bg-red-50' : intelligence.portfolio.portfolioRisk === 'high' ? 'ring-amber-200 bg-amber-50' : 'ring-emerald-200 bg-emerald-50'}`}>
                <p className="text-[10px] font-medium uppercase tracking-wider text-[#999]">Portfolio</p>
                <p className={`text-[14px] font-bold capitalize ${intelligence.portfolio.portfolioRisk === 'critical' ? 'text-red-600' : intelligence.portfolio.portfolioRisk === 'high' ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {intelligence.portfolio.portfolioRisk}
                </p>
              </div>
            </div>
          )}

          {/* Pattern insights from intelligence API */}
          {intelligence?.insights && intelligence.insights.length > 0 && (
            <div className="rounded-xl ring-1 ring-[#e8e8e8] bg-white p-4 mb-3">
              <div className="space-y-2">
                {intelligence.insights.map((insight, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-[11px] mt-0.5">
                      {insight.severity === 'critical' ? '🔴' : insight.severity === 'warning' ? '🟡' : '🔵'}
                    </span>
                    <p className="text-[12px] text-[#37352f]">{insight.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI-generated insights */}
          {aiSummary && (
            <div className="rounded-xl ring-1 ring-[#e8e8e8] bg-white p-4 mb-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[13px]">&#129504;</span>
                <span className="text-[12px] font-semibold text-[#1a1a1a]">AI Analysis</span>
              </div>
              <p className="text-[12px] text-[#6b6b6b]">{aiSummary}</p>
            </div>
          )}

          {aiInsights.length > 0 && (
            <div className="space-y-2">
              {aiInsights.slice(0, 4).map((insight, i) => (
                <div key={i} className="rounded-xl ring-1 ring-[#e8e8e8] bg-white p-3">
                  <div className="flex items-start gap-2 mb-1">
                    <span className="text-[11px] mt-0.5">
                      {insight.severity === 'critical' ? '🔴' : insight.severity === 'warning' ? '🟡' : '🔵'}
                    </span>
                    <p className="text-[12px] font-medium text-[#1a1a1a]">{insight.title}</p>
                  </div>
                  <p className="text-[11px] text-[#6b6b6b] ml-5">{insight.detail}</p>
                  {insight.action && (
                    <p className="text-[11px] text-[#007aff] ml-5 mt-1">→ {insight.action}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Active Projects */}
      {activeProjects.length > 0 && (
        <div className="w-full max-w-2xl mb-5">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-[11px] font-medium uppercase tracking-wider text-[#aeaeb2] mb-2.5 px-1"
          >
            Active Projects
          </motion.p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {activeProjects.map((project, i) => (
              <ProjectHealthCard
                key={project.projectId}
                project={project}
                onClick={() => onSelectProject(project.projectId)}
                index={i}
                isCompleted={false}
              />
            ))}
          </div>
        </div>
      )}

      {/* Completed Projects */}
      {completedProjects.length > 0 && (
        <div className="w-full max-w-2xl mb-5">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-[11px] font-medium uppercase tracking-wider text-[#aeaeb2] mb-2.5 px-1"
          >
            Completed
          </motion.p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {completedProjects.map((project, i) => (
              <ProjectHealthCard
                key={project.projectId}
                project={project}
                onClick={() => onSelectProject(project.projectId)}
                index={i + activeProjects.length}
                isCompleted={true}
              />
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="w-full max-w-2xl">
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-[11px] font-medium uppercase tracking-wider text-[#aeaeb2] mb-2.5 px-1"
        >
          Quick Actions
        </motion.p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {QUICK_ACTIONS.map((action, i) => (
            <motion.button
              key={action.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 + i * 0.04 }}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onSendMessage(action.query)}
              className="text-center px-3 py-3 rounded-xl border border-[#e8e8e8] hover:border-[#d0d0d0] hover:bg-[#fafafa] transition-all"
            >
              <span className="text-[18px] block mb-1">{action.icon}</span>
              <span className="text-[11px] text-[#6b6b6b] leading-snug">{action.label}</span>
            </motion.button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
