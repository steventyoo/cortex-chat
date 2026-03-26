'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
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
  orgName?: string;
  orgId?: string;
  onLogout?: () => void;
  hideFooter?: boolean;
}

export interface SidebarFooterProps {
  userName?: string;
  userEmail?: string;
  onLogout?: () => void;
}

export function SidebarFooter({ userName, userEmail, onLogout }: SidebarFooterProps) {
  return (
    <div className="w-full px-4 border-t border-[#f0f0f0] flex items-center py-3 bg-[#f7f7f5]">
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
  );
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

interface OrgItem {
  orgId: string;
  orgName: string;
  role: string;
}

function OrgSwitcher({ orgName, orgId }: { orgName?: string; orgId?: string }) {
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/org/list');
      if (res.ok) {
        const data = await res.json();
        setOrgs(data.orgs || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) fetchOrgs();
  }, [open, fetchOrgs]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setNewOrgName('');
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  async function handleSwitch(targetOrgId: string) {
    if (targetOrgId === orgId) {
      setOpen(false);
      return;
    }
    try {
      const res = await fetch('/api/auth/switch-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: targetOrgId }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch { /* ignore */ }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newOrgName.trim() || createLoading) return;
    setCreateLoading(true);
    try {
      const res = await fetch('/api/org/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgName: newOrgName.trim() }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch { /* ignore */ }
    setCreateLoading(false);
  }

  const displayName = orgName || 'Project Cortex';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2.5 px-2 py-1 -mx-1 rounded-lg hover:bg-[#ebebea] transition-colors w-full text-left group"
      >
        <div className="w-6 h-6 rounded-[6px] bg-[#1a1a1a] flex items-center justify-center flex-shrink-0">
          <span className="text-[10px] font-bold text-white">
            {displayName.charAt(0).toUpperCase()}
          </span>
        </div>
        <span className="text-[14px] font-semibold text-[#37352f] tracking-[-0.01em] truncate flex-1">
          {displayName}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#999"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 right-0 top-full mt-1 bg-white rounded-lg border border-[#e8e8e8] shadow-lg z-50 overflow-hidden"
          >
            <div className="py-1 max-h-[240px] overflow-y-auto">
              {loading ? (
                <div className="px-3 py-2 text-[12px] text-[#999]">Loading...</div>
              ) : orgs.length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-[#999]">No organizations</div>
              ) : (
                orgs.map((org) => (
                  <button
                    key={org.orgId}
                    onClick={() => handleSwitch(org.orgId)}
                    className={`w-full text-left px-3 py-2 text-[13px] flex items-center gap-2 transition-colors ${
                      org.orgId === orgId
                        ? 'bg-[#f5f5f4] text-[#37352f]'
                        : 'text-[#6b6b6b] hover:bg-[#f5f5f4] hover:text-[#37352f]'
                    }`}
                  >
                    <div className="w-5 h-5 rounded-[4px] bg-[#e8e8e8] flex items-center justify-center flex-shrink-0 text-[9px] font-bold text-[#666]">
                      {org.orgName.charAt(0).toUpperCase()}
                    </div>
                    <span className="truncate flex-1 font-medium">{org.orgName}</span>
                    {org.orgId === orgId && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#37352f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                ))
              )}
            </div>

            <div className="border-t border-[#f0f0f0]">
              {creating ? (
                <form onSubmit={handleCreate} className="p-2">
                  <input
                    autoFocus
                    type="text"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    placeholder="Organization name"
                    className="w-full px-2.5 py-1.5 rounded-md border border-[#e5e5e5] text-[13px] text-[#37352f] placeholder-[#b4b4b4] focus:outline-none focus:ring-1 focus:ring-[#007aff]/30 focus:border-[#007aff]/40"
                    onKeyDown={(e) => { if (e.key === 'Escape') { setCreating(false); setNewOrgName(''); } }}
                  />
                  <div className="flex gap-1.5 mt-1.5">
                    <button
                      type="submit"
                      disabled={!newOrgName.trim() || createLoading}
                      className="flex-1 px-2.5 py-1.5 rounded-md bg-[#1a1a1a] text-white text-[12px] font-medium disabled:opacity-40 hover:bg-[#333] transition-colors"
                    >
                      {createLoading ? 'Creating...' : 'Create'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCreating(false); setNewOrgName(''); }}
                      className="px-2.5 py-1.5 rounded-md text-[12px] text-[#6b6b6b] hover:bg-[#f0f0f0] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="w-full text-left px-3 py-2 text-[13px] text-[#6b6b6b] hover:bg-[#f5f5f4] hover:text-[#37352f] transition-colors flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5V19M5 12H19" />
                  </svg>
                  Create new organization
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
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
  orgName,
  orgId,
  onLogout,
  hideFooter = false,
}: SidebarProps) {
  const [dailyStatus, setDailyStatus] = useState<Record<string, { hasNotes: boolean; hasStaffing: boolean }>>({});
  const pathname = usePathname();
  const router = useRouter();

  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState('');

  const handleCreateProject = useCallback(async () => {
    if (!newProjectName.trim()) return;
    setCreatingProject(true);
    setCreateProjectError('');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setCreateProjectError(data.error || 'Failed to create project');
        return;
      }
      setShowCreateProject(false);
      setNewProjectName('');
      router.refresh();
    } catch {
      setCreateProjectError('Network error');
    } finally {
      setCreatingProject(false);
    }
  }, [newProjectName, router]);

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
        className="fixed left-0 top-0 bottom-0 w-[260px] bg-[#f7f7f5] border-r border-[#e8e8e8] z-50 flex flex-col lg:static lg:w-full lg:h-full lg:border-r-0 lg:translate-x-0"
        style={{ transform: undefined }}
      >
        {/* Header */}
        <div className="p-3 pt-4">
          <div className="mb-3">
            <OrgSwitcher orgName={orgName} orgId={orgId} />
            {isAdmin && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#1a1a1a] text-white font-medium tracking-wide uppercase ml-[36px] mt-1 inline-block">
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
            <Link
              href="/staff-roster"
              className={`w-full px-3 py-2 rounded-lg hover:bg-[#ebebea] text-[13px] transition-colors flex items-center gap-2 ${
                pathname === '/staff-roster' ? 'bg-[#ebebea] text-[#37352f] font-medium' : 'text-[#6b6b6b] hover:text-[#37352f]'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87" />
                <path d="M16 3.13a4 4 0 010 7.75" />
              </svg>
              Staff Roster
            </Link>
          )}

          {isAdmin && (
            <Link
              href="/staff-calendar"
              className={`w-full px-3 py-2 rounded-lg hover:bg-[#ebebea] text-[13px] transition-colors flex items-center gap-2 ${
                pathname === '/staff-calendar' ? 'bg-[#ebebea] text-[#37352f] font-medium' : 'text-[#6b6b6b] hover:text-[#37352f]'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              Crew Calendar
            </Link>
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
          <div className="flex items-center justify-between mb-2 px-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[#aeaeb2]">
              Projects
            </p>
            <button
              onClick={() => setShowCreateProject((v) => !v)}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#e0e0e0] text-[#aeaeb2] hover:text-[#666] transition-colors"
              title="Create project"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5V19M5 12H19" />
              </svg>
            </button>
          </div>

          {showCreateProject && (
            <div className="mb-3 px-1">
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => { setNewProjectName(e.target.value); setCreateProjectError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateProject(); if (e.key === 'Escape') { setShowCreateProject(false); setNewProjectName(''); } }}
                placeholder="Project name..."
                autoFocus
                className="w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/30 focus:border-[#007aff] bg-white"
              />
              {createProjectError && (
                <p className="text-[11px] text-[#dc2626] mt-1 px-1">{createProjectError}</p>
              )}
              <div className="flex gap-1.5 mt-1.5">
                <button
                  onClick={handleCreateProject}
                  disabled={!newProjectName.trim() || creatingProject}
                  className="flex-1 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[12px] font-medium hover:bg-[#333] transition-colors disabled:opacity-40"
                >
                  {creatingProject ? 'Creating...' : 'Create'}
                </button>
                <button
                  onClick={() => { setShowCreateProject(false); setNewProjectName(''); setCreateProjectError(''); }}
                  className="px-3 py-1.5 rounded-lg text-[12px] text-[#666] hover:bg-[#f0f0f0] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {projects.length === 0 && !showCreateProject ? (
            <button
              onClick={() => setShowCreateProject(true)}
              className="w-full text-left px-3 py-2.5 rounded-lg text-[13px] text-[#999] hover:bg-[#ebebea] hover:text-[#666] transition-colors"
            >
              + Create your first project
            </button>
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

        {!hideFooter && (
          <SidebarFooter userName={userName} userEmail={userEmail} onLogout={onLogout} />
        )}
      </motion.aside>
    </>
  );
}
