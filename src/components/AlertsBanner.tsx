'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ProjectAlert } from '@/lib/types';

interface AlertsBannerProps {
  alerts: ProjectAlert[];
  onAlertClick: (projectId: string) => void;
}

export default function AlertsBanner({ alerts, onAlertClick }: AlertsBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || alerts.length === 0) return null;

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const warningCount = alerts.filter((a) => a.severity === 'warning').length;

  const sortedAlerts = [...alerts].sort((a, b) => {
    const priority = { critical: 0, warning: 1, info: 2 };
    return priority[a.severity] - priority[b.severity];
  });

  const displayAlerts = expanded ? sortedAlerts : sortedAlerts.slice(0, 3);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="rounded-2xl border border-[#e8e8e8] bg-white overflow-hidden"
    >
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#fafafa] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#1a1a1a] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L2 7L12 12L22 7L12 2Z"
                stroke="white"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="text-left">
            <p className="text-[13px] font-semibold text-[#1a1a1a]">
              {alerts.length} item{alerts.length !== 1 ? 's' : ''} need attention
            </p>
            <p className="text-[11px] text-[#999]">
              {criticalCount > 0 && (
                <span className="text-red-600 font-medium">{criticalCount} critical</span>
              )}
              {criticalCount > 0 && warningCount > 0 && ' · '}
              {warningCount > 0 && (
                <span className="text-amber-600 font-medium">{warningCount} warning{warningCount !== 1 ? 's' : ''}</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={(e) => {
              e.stopPropagation();
              setDismissed(true);
            }}
            className="p-1 rounded-md hover:bg-[#f0f0f0] text-[#999] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </motion.button>
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2">
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.div>
        </div>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-[#f0f0f0]">
              {displayAlerts.map((alert, i) => (
                <motion.button
                  key={`${alert.projectId}-${alert.type}-${i}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => onAlertClick(alert.projectId)}
                  className="w-full text-left px-4 py-2.5 hover:bg-[#fafafa] transition-colors flex items-start gap-2.5 border-b border-[#f8f8f8] last:border-b-0"
                >
                  <span className="text-[12px] mt-0.5 flex-shrink-0">
                    {alert.severity === 'critical'
                      ? '🔴'
                      : alert.severity === 'warning'
                        ? '⚠️'
                        : 'ℹ️'}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium text-[#1a1a1a] truncate">
                      {alert.projectName}
                    </p>
                    <p className="text-[11px] text-[#6b6b6b] leading-snug">
                      {alert.message}
                    </p>
                  </div>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collapsed preview */}
      {!expanded && sortedAlerts.length > 0 && (
        <div className="border-t border-[#f0f0f0] px-4 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-[#999]">
            {sortedAlerts.slice(0, 2).map((alert, i) => (
              <span key={i} className="flex items-center gap-1">
                {alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '⚠️' : 'ℹ️'}
                <span className="truncate max-w-[140px]">{alert.projectName}</span>
                {i < Math.min(sortedAlerts.length, 2) - 1 && <span className="text-[#ddd] mx-0.5">·</span>}
              </span>
            ))}
            {sortedAlerts.length > 2 && (
              <span className="text-[#aeaeb2]">+{sortedAlerts.length - 2} more</span>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
