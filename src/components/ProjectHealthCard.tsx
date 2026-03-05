'use client';

import { motion } from 'framer-motion';
import { ProjectHealth, HealthStatus } from '@/lib/types';

interface ProjectHealthCardProps {
  project: ProjectHealth;
  onClick: () => void;
  index: number;
  isCompleted: boolean;
}

const healthColors: Record<HealthStatus, { bg: string; text: string; dot: string; border: string }> = {
  healthy: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
    border: 'border-emerald-200',
  },
  warning: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
    border: 'border-amber-200',
  },
  critical: {
    bg: 'bg-red-50',
    text: 'text-red-700',
    dot: 'bg-red-500',
    border: 'border-red-200',
  },
};

const healthLabels: Record<HealthStatus, string> = {
  healthy: 'On Track',
  warning: 'Needs Attention',
  critical: 'At Risk',
};

function formatCompactCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return `$${value.toLocaleString()}`;
}

export default function ProjectHealthCard({
  project,
  onClick,
  index,
  isCompleted,
}: ProjectHealthCardProps) {
  const health = isCompleted ? healthColors.healthy : healthColors[project.overallHealth];
  const label = isCompleted ? 'Completed' : healthLabels[project.overallHealth];

  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: isCompleted ? 0.6 : 1, y: 0 }}
      transition={{ delay: 0.1 + index * 0.05, type: 'spring', damping: 25, stiffness: 200 }}
      whileHover={{ y: -2, boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`w-full text-left p-4 rounded-2xl border transition-all ${
        isCompleted
          ? 'border-[#e8e8e8] bg-[#fafafa]'
          : 'border-[#e8e8e8] bg-white hover:border-[#d0d0d0]'
      }`}
    >
      {/* Header: Name + Status Badge */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div>
          <h3
            className={`text-[14px] font-semibold leading-tight ${
              isCompleted ? 'text-[#999]' : 'text-[#1a1a1a]'
            }`}
          >
            {project.projectName}
          </h3>
          {!isCompleted && (project.foreman || project.projectManager) && (
            <p className="text-[11px] text-[#aeaeb2] mt-0.5">
              {project.projectManager && `PM: ${project.projectManager}`}
              {project.projectManager && project.foreman && ' · '}
              {project.foreman && `Foreman: ${project.foreman}`}
              {project.crewSize > 0 && ` · ${project.crewSize} crew`}
            </p>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${
            isCompleted ? 'bg-[#f0f0f0] text-[#999]' : `${health.bg} ${health.text}`
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isCompleted ? 'bg-[#ccc]' : health.dot
            }`}
          />
          {label}
        </span>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2">
        <div>
          <p className={`text-[10px] uppercase tracking-wider ${isCompleted ? 'text-[#ccc]' : 'text-[#aeaeb2]'}`}>
            Contract
          </p>
          <p className={`text-[14px] font-semibold tabular-nums ${isCompleted ? 'text-[#b4b4b4]' : 'text-[#37352f]'}`}>
            {formatCompactCurrency(project.contractValue)}
          </p>
        </div>
        <div>
          <p className={`text-[10px] uppercase tracking-wider ${isCompleted ? 'text-[#ccc]' : 'text-[#aeaeb2]'}`}>
            Complete
          </p>
          <p className={`text-[14px] font-semibold tabular-nums ${isCompleted ? 'text-[#b4b4b4]' : 'text-[#37352f]'}`}>
            {Math.round(project.percentComplete)}%
          </p>
        </div>
        <div>
          <p className={`text-[10px] uppercase tracking-wider ${isCompleted ? 'text-[#ccc]' : 'text-[#aeaeb2]'}`}>
            Change Orders
          </p>
          <p className={`text-[14px] font-semibold tabular-nums ${isCompleted ? 'text-[#b4b4b4]' : 'text-[#37352f]'}`}>
            {formatCompactCurrency(project.totalCOs)}
          </p>
        </div>
        <div>
          <p className={`text-[10px] uppercase tracking-wider ${isCompleted ? 'text-[#ccc]' : 'text-[#aeaeb2]'}`}>
            Labor Ratio
          </p>
          <p
            className={`text-[14px] font-semibold tabular-nums ${
              isCompleted
                ? 'text-[#b4b4b4]'
                : project.laborPerformanceRatio > 1.1
                  ? 'text-red-600'
                  : project.laborPerformanceRatio > 1
                    ? 'text-amber-600'
                    : 'text-emerald-600'
            }`}
          >
            {project.laborPerformanceRatio.toFixed(2)}x
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-3">
        <div className={`h-1.5 rounded-full ${isCompleted ? 'bg-[#f0f0f0]' : 'bg-[#f0f0f0]'}`}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, project.percentComplete)}%` }}
            transition={{ delay: 0.3 + index * 0.05, duration: 0.6, ease: 'easeOut' }}
            className={`h-full rounded-full ${
              isCompleted
                ? 'bg-[#d4d4d4]'
                : project.overallHealth === 'critical'
                  ? 'bg-red-400'
                  : project.overallHealth === 'warning'
                    ? 'bg-amber-400'
                    : 'bg-emerald-400'
            }`}
          />
        </div>
      </div>

      {/* Alert preview (first alert only) */}
      {!isCompleted && project.alerts.length > 0 && (
        <div className="mt-2.5 flex items-start gap-1.5">
          <span className="text-[11px] mt-px">
            {project.alerts[0].severity === 'critical' ? '🔴' : project.alerts[0].severity === 'warning' ? '⚠️' : 'ℹ️'}
          </span>
          <p className="text-[11px] text-[#6b6b6b] leading-snug line-clamp-1">
            {project.alerts[0].message}
          </p>
        </div>
      )}
    </motion.button>
  );
}
