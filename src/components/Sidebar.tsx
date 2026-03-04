'use client';

import { motion } from 'framer-motion';
import { ProjectSummary } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

interface SidebarProps {
  projects: ProjectSummary[];
  selectedProject: string | null;
  onSelectProject: (projectId: string) => void;
  onNewChat: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

export default function Sidebar({
  projects,
  selectedProject,
  onSelectProject,
  onNewChat,
  isOpen,
  onToggle,
}: SidebarProps) {
  return (
    <>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden"
          onClick={onToggle}
        />
      )}

      <motion.aside
        initial={{ x: -260 }}
        animate={{ x: isOpen ? 0 : -260 }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed left-0 top-0 bottom-0 w-[260px] bg-[#f7f7f5] border-r border-[#e8e8e8] z-50 flex flex-col lg:relative lg:translate-x-0"
        style={{ transform: undefined }}
      >
        {/* Header */}
        <div className="p-3 pt-4">
          <div className="flex items-center gap-2.5 mb-3 px-2">
            <div className="w-6 h-6 rounded-[6px] bg-[#1a1a1a] flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-[14px] font-semibold text-[#37352f] tracking-[-0.01em]">
              Project Cortex
            </span>
          </div>

          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={onNewChat}
            className="w-full px-3 py-2 rounded-lg hover:bg-[#ebebea] text-[13px] text-[#6b6b6b] hover:text-[#37352f] transition-colors flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5V19M5 12H19" />
            </svg>
            New chat
          </motion.button>
        </div>

        {/* Projects */}
        <div className="flex-1 overflow-y-auto px-3 pt-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#aeaeb2] mb-2 px-2">
            Projects
          </p>
          {projects.length === 0 ? (
            <p className="text-[12px] text-[#b4b4b4] px-2">No projects</p>
          ) : (
            <div className="space-y-0.5">
              {projects.map((project) => (
                <motion.button
                  key={project.projectId}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onSelectProject(project.projectId)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-[13px] transition-colors ${
                    selectedProject === project.projectId
                      ? 'bg-[#ebebea] text-[#1a1a1a]'
                      : 'text-[#6b6b6b] hover:bg-[#ebebea] hover:text-[#37352f]'
                  }`}
                >
                  <div className="font-medium truncate">
                    {project.projectName}
                  </div>
                  <div className="text-[11px] mt-0.5 text-[#aeaeb2]">
                    {formatCurrency(project.contractValue)}
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#e8e8e8]">
          <p className="text-[11px] text-[#b4b4b4] text-center">
            Powered by Claude AI
          </p>
        </div>
      </motion.aside>
    </>
  );
}
