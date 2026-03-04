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

const QUICK_ACTIONS = [
  { label: 'Full project summary', icon: '📋', query: 'Give me a full project summary' },
  { label: 'Budget breakdown', icon: '💰', query: 'How is the budget tracking by category?' },
  { label: 'Labor performance', icon: '👷', query: 'Show me production metrics and labor performance' },
  { label: 'Change order status', icon: '📝', query: 'What are the biggest change orders?' },
];

export default function Dashboard({ onSelectProject, onSendMessage }: DashboardProps) {
  const [healthData, setHealthData] = useState<ProjectHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchHealth() {
      try {
        const res = await fetch('/api/project-health');
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setHealthData(data);
      } catch (err) {
        console.error('Dashboard fetch error:', err);
        setError('Unable to load project health data');
      } finally {
        setLoading(false);
      }
    }
    fetchHealth();
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
