'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ProjectSummary, ConversationSummary } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

interface SidebarProps {
  projects: ProjectSummary[];
  selectedProject: string | null;
  onSelectProject: (projectId: string) => void;
  onNewChat: () => void;
  onGoHome?: () => void;
  isOpen: boolean;
  onToggle: () => void;
  conversations?: ConversationSummary[];
  activeConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  currentView?: 'chat' | 'pipeline' | 'dashboard';
  onNavigate?: (view: 'chat' | 'pipeline' | 'dashboard') => void;
  isAdmin?: boolean;
  userName?: string;
  userEmail?: string;
  onLogout?: () => void;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Sidebar({
  projects,
  selectedProject,
  onSelectProject,
  onNewChat,
  onGoHome,
  isOpen,
  onToggle,
  conversations = [],
  activeConversationId,
  onSelectConversation,
  onDeleteConversation,
  currentView = 'chat',
  onNavigate,
  isAdmin = false,
  userName,
  userEmail,
  onLogout,
}: SidebarProps) {
  const [dailyStatus, setDailyStatus] = useState<Record<string, { hasNotes: boolean; hasStaffing: boolean }>>({});

  useEffect(() => {
    if (projects.length === 0) return;
    fetch('/api/daily-status')
      .then((r) => r.json())
      .then((d) => { if (d.status) setDailyStatus(d.status); })
      .catch(() => {});
  }, [projects]);

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
          <div
            className="flex items-center gap-2.5 mb-3 px-2 cursor-default select-none"
          >
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
            {isAdmin && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#1a1a1a] text-white font-medium tracking-wide uppercase">
                Admin
              </span>
            )}
          </div>

          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={onGoHome}
            className={`w-full px-3 py-2 rounded-lg hover:bg-[#ebebea] text-[13px] transition-colors flex items-center gap-2 ${
              currentView === 'chat' && !selectedProject ? 'bg-[#ebebea] text-[#37352f] font-medium' : 'text-[#6b6b6b] hover:text-[#37352f]'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            Home
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={onNewChat}
            className={`w-full px-3 py-2 rounded-lg hover:bg-[#ebebea] text-[13px] transition-colors flex items-center gap-2 ${
              currentView === 'chat' && selectedProject ? 'text-[#37352f] font-medium' : 'text-[#6b6b6b] hover:text-[#37352f]'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5V19M5 12H19" />
            </svg>
            New chat
          </motion.button>

          {isAdmin && (
            <a
              href="/staff-roster"
              className="w-full px-3 py-2 rounded-lg hover:bg-[#ebebea] text-[13px] transition-colors flex items-center gap-2 text-[#6b6b6b] hover:text-[#37352f]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87" />
                <path d="M16 3.13a4 4 0 010 7.75" />
              </svg>
              Staff Roster
            </a>
          )}

          {isAdmin && (
            <a
              href="/staff-calendar"
              className="w-full px-3 py-2 rounded-lg hover:bg-[#ebebea] text-[13px] transition-colors flex items-center gap-2 text-[#6b6b6b] hover:text-[#37352f]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              Crew Calendar
            </a>
          )}

          {isAdmin && (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => onNavigate?.('pipeline')}
              className={`w-full px-3 py-2 rounded-lg hover:bg-[#ebebea] text-[13px] transition-colors flex items-center gap-2 ${
                currentView === 'pipeline' ? 'bg-[#ebebea] text-[#37352f] font-medium' : 'text-[#6b6b6b] hover:text-[#37352f]'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M9 15l2 2 4-4" />
              </svg>
              Document Pipeline
            </motion.button>
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-3 pt-2">
          {/* Projects */}
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#aeaeb2] mb-2 px-2">
            Projects
          </p>
          {projects.length === 0 ? (
            <p className="text-[12px] text-[#b4b4b4] px-2">No projects</p>
          ) : (
            <div className="space-y-0.5 mb-4">
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
                  <div className="font-medium truncate flex items-center gap-2">
                    <span
                      className={`inline-block w-[8px] h-[8px] rounded-full flex-shrink-0 ${
                        project.status.toLowerCase().includes('complete') ||
                        project.status.toLowerCase().includes('closed')
                          ? 'bg-[#c0c0c0]'
                          : 'bg-[#34c759]'
                      }`}
                    />
                    {project.projectName}
                  </div>
                  <div className="flex items-center justify-between mt-0.5 ml-[16px]">
                    <span className="text-[11px] text-[#aeaeb2] truncate">
                      {project.address || formatCurrency(project.contractValue)}
                    </span>
                    {!(
                      project.status.toLowerCase().includes('complete') ||
                      project.status.toLowerCase().includes('closed')
                    ) && (
                      <span className="flex items-center gap-1.5 flex-shrink-0">
                        {/* Daily Notes indicator */}
                        <span title={dailyStatus[project.projectId]?.hasNotes ? 'Daily note submitted' : 'Daily note missing'}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                            stroke={dailyStatus[project.projectId]?.hasNotes ? '#34c759' : '#ff3b30'}
                            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                            <path d="M14 2v6h6" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                          </svg>
                        </span>
                        {/* Staffing indicator */}
                        <span title={dailyStatus[project.projectId]?.hasStaffing ? 'Staffing submitted' : 'Staffing missing'}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                            stroke={dailyStatus[project.projectId]?.hasStaffing ? '#34c759' : '#ff3b30'}
                            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" />
                            <circle cx="9" cy="7" r="4" />
                          </svg>
                        </span>
                      </span>
                    )}
                  </div>
                </motion.button>
              ))}
            </div>
          )}

          {/* Conversation History */}
          {conversations.length > 0 && (
            <>
              <p className="text-[11px] font-medium uppercase tracking-wider text-[#aeaeb2] mb-2 px-2 mt-3">
                Recent Chats
              </p>
              <div className="space-y-0.5">
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`group relative rounded-lg transition-colors ${
                      activeConversationId === conv.id
                        ? 'bg-[#ebebea]'
                        : 'hover:bg-[#ebebea]'
                    }`}
                  >
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={() => onSelectConversation?.(conv.id)}
                      className="w-full text-left px-3 py-2 text-[13px]"
                    >
                      <div
                        className={`font-medium truncate ${
                          activeConversationId === conv.id
                            ? 'text-[#1a1a1a]'
                            : 'text-[#6b6b6b]'
                        }`}
                      >
                        {conv.firstMessage.length > 40
                          ? conv.firstMessage.substring(0, 40) + '...'
                          : conv.firstMessage}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {conv.projectName && (
                          <span className="text-[10px] text-[#aeaeb2] truncate max-w-[100px]">
                            {conv.projectName}
                          </span>
                        )}
                        <span className="text-[10px] text-[#d0d0d0]">·</span>
                        <span className="text-[10px] text-[#d0d0d0]">
                          {timeAgo(conv.updatedAt)}
                        </span>
                      </div>
                    </motion.button>

                    {/* Delete button */}
                    {onDeleteConversation && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteConversation(conv.id);
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-[#e0e0e0] text-[#999] hover:text-[#666] transition-all"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer — user info + logout */}
        <div className="p-3 border-t border-[#e8e8e8]">
          {userEmail ? (
            <div className="flex items-center gap-2 px-2">
              <div className="w-7 h-7 rounded-full bg-[#1a1a1a] flex items-center justify-center flex-shrink-0">
                <span className="text-[11px] font-medium text-white">
                  {(userName || userEmail).charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                {userName && (
                  <p className="text-[12px] font-medium text-[#37352f] truncate">{userName}</p>
                )}
                <p className="text-[11px] text-[#999] truncate">{userEmail}</p>
              </div>
              {onLogout && (
                <button
                  onClick={onLogout}
                  className="p-1.5 rounded-md hover:bg-[#ebebea] text-[#999] hover:text-[#666] transition-colors flex-shrink-0"
                  title="Sign out"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                </button>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-[#b4b4b4] text-center">
              Powered by Claude AI
            </p>
          )}
        </div>
      </motion.aside>
    </>
  );
}
