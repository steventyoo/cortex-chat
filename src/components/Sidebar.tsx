'use client';

import { motion } from 'framer-motion';
import { ProjectSummary, ConversationSummary } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

interface SidebarProps {
  projects: ProjectSummary[];
  selectedProject: string | null;
  onSelectProject: (projectId: string) => void;
  onNewChat: () => void;
  isOpen: boolean;
  onToggle: () => void;
  conversations?: ConversationSummary[];
  activeConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  currentView?: 'chat' | 'pipeline';
  onNavigate?: (view: 'chat' | 'pipeline') => void;
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
  isOpen,
  onToggle,
  conversations = [],
  activeConversationId,
  onSelectConversation,
  onDeleteConversation,
  currentView = 'chat',
  onNavigate,
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
            className={`w-full px-3 py-2 rounded-lg hover:bg-[#ebebea] text-[13px] transition-colors flex items-center gap-2 ${
              currentView === 'chat' ? 'text-[#37352f] font-medium' : 'text-[#6b6b6b] hover:text-[#37352f]'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5V19M5 12H19" />
            </svg>
            New chat
          </motion.button>

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
