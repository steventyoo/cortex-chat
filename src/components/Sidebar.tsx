'use client';

import Image from 'next/image';
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
          <div className="flex items-center mb-3 px-2">
            <Image
              src="/owp-logo.png"
              alt="One Way Plumbing"
              width={180}
              height={36}
              className="h-[32px] w-auto"
              priority
            />
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
