'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { useChat } from '@/hooks/useChat';
import { useConversationHistory } from '@/hooks/useConversationHistory';
import { useSession } from '@/hooks/useSession';
import { useAppShellFooter } from './AppShell';
import { ProjectSummary } from '@/lib/types';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import Dashboard from './Dashboard';
import UploadJobCost from './UploadJobCost';

const PipelineReview = dynamic(() => import('./PipelineReview'), { ssr: false });
const ProjectDashboard = dynamic(() => import('./ProjectDashboard'), { ssr: false });

interface ChatContainerProps {
  projects: ProjectSummary[];
}

export default function ChatContainer({ projects }: ChatContainerProps) {
  const {
    messages,
    isStreaming,
    error,
    currentProjectId,
    sourcesMap,
    sendMessage,
    clearConversation,
    setProject,
    clearProject,
    setMessages,
  } = useChat();

  const {
    saveConversation,
    startNewConversation,
    pendingLoad,
    consumePendingLoad,
  } = useConversationHistory();

  const { user, isAdmin } = useSession();
  const { setFooter } = useAppShellFooter();

  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'csv' | null>(null);
  const [currentView, setCurrentView] = useState<'chat' | 'pipeline' | 'dashboard'>('chat');
  const [showUpload, setShowUpload] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const prevMessagesLenRef = useRef(0);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages]);

  useEffect(() => {
    if (pendingLoad) {
      setMessages(pendingLoad.messages);
      if (pendingLoad.projectId) {
        setProject(pendingLoad.projectId);
      } else {
        clearProject();
      }
      prevMessagesLenRef.current = pendingLoad.messages.length;
      setCurrentView('chat');
      consumePendingLoad();
    }
  }, [pendingLoad, setMessages, setProject, clearProject, consumePendingLoad]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (messages.length > 0 && !isStreaming && messages.length !== prevMessagesLenRef.current) {
      const project = projects.find((p) => p.projectId === currentProjectId);
      saveConversation(
        messages,
        currentProjectId,
        project?.projectName || null
      );
      prevMessagesLenRef.current = messages.length;
    }
  }, [messages, isStreaming, currentProjectId, projects, saveConversation]);

  // Register ChatInput in AppShell's footer slot
  useEffect(() => {
    if (currentView !== 'pipeline') {
      setFooter(
        <ChatInput
          onSend={(msg) => {
            if (currentView === 'dashboard') setCurrentView('chat');
            sendMessage(msg);
          }}
          disabled={isStreaming}
        />
      );
    } else {
      setFooter(null);
    }
    return () => setFooter(null);
  }, [currentView, isStreaming, sendMessage, setFooter]);

  const currentProject = projects.find((p) => p.projectId === currentProjectId);

  const handleExport = useCallback(
    async (type: 'pdf' | 'csv') => {
      if (!currentProjectId || !currentProject) return;
      setExporting(type);
      setExportOpen(false);

      try {
        const endpoint = type === 'pdf' ? '/api/brief' : '/api/export-csv';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: currentProjectId,
            projectName: currentProject.projectName,
          }),
        });

        if (!res.ok) throw new Error('Export failed');

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download =
          type === 'pdf'
            ? `${currentProject.projectName}-Brief.pdf`
            : `${currentProject.projectName}-Data.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Export error:', err);
      } finally {
        setExporting(null);
      }
    },
    [currentProjectId, currentProject]
  );

  const handleNewChat = useCallback(() => {
    clearConversation();
    startNewConversation();
    prevMessagesLenRef.current = 0;
  }, [clearConversation, startNewConversation]);

  const handleGoHome = useCallback(() => {
    clearConversation();
    clearProject();
    startNewConversation();
    prevMessagesLenRef.current = 0;
    setCurrentView('chat');
  }, [clearConversation, clearProject, startNewConversation]);

  const handleDashboardSelectProject = useCallback(
    (projectId: string) => {
      setProject(projectId);
      clearConversation();
      startNewConversation();
      prevMessagesLenRef.current = 0;
      setCurrentView('dashboard');
    },
    [setProject, clearConversation, startNewConversation]
  );

  return (
    <>
      {currentView === 'pipeline' ? (
        <div className="flex-1 overflow-hidden">
          <PipelineReview />
        </div>
      ) : currentView === 'dashboard' && currentProjectId ? (
        <>
          {/* Dashboard top bar — desktop only (mobile gets AppShell hamburger) */}
          <div className="hidden lg:flex items-center gap-3 px-5 h-[52px] border-b border-[#f0f0f0] bg-white/80 backdrop-blur-xl flex-shrink-0">
            <div className="flex-1 flex items-center gap-2">
              <button
                onClick={handleGoHome}
                className="p-1 rounded-md hover:bg-[#f0f0f0] text-[#999] hover:text-[#1a1a1a] transition-colors"
                title="Back to home"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 className="text-[14px] font-medium text-[#1a1a1a]">
                {currentProject?.projectName || currentProjectId} — Dashboard
              </h2>
            </div>
            {isAdmin && (
              <button
                onClick={() => setShowUpload(true)}
                className="px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[12px] font-medium hover:bg-[#333] transition-colors flex items-center gap-1.5"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                </svg>
                Upload
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            <ProjectDashboard
              projectId={currentProjectId}
              projectName={currentProject?.projectName}
              projectAddress={currentProject?.address}
              projectTrade={currentProject?.trade}
            />
          </div>
        </>
      ) : (
        <>
          {/* Chat top bar — desktop only */}
          <div className="hidden lg:flex items-center gap-3 px-5 h-[52px] border-b border-[#f0f0f0] bg-white/80 backdrop-blur-xl flex-shrink-0">
            <div className="flex-1 flex items-center gap-2">
              {currentProjectId ? (
                <>
                  <button
                    onClick={handleGoHome}
                    className="p-1 rounded-md hover:bg-[#f0f0f0] text-[#999] hover:text-[#1a1a1a] transition-colors"
                    title="Back to dashboard"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <h2 className="text-[14px] font-medium text-[#1a1a1a]">
                    {currentProject?.projectName || currentProjectId}
                  </h2>
                </>
              ) : (
                <Image
                  src="/owp-logo.png"
                  alt="One Way Plumbing"
                  width={150}
                  height={30}
                  className="h-[24px] w-auto"
                />
              )}
            </div>

            {currentProjectId && (
              <div className="relative" ref={exportRef}>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setExportOpen(!exportOpen)}
                  disabled={!!exporting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium text-[#6b6b6b] hover:text-[#1a1a1a] hover:bg-[#f0f0f0] transition-colors disabled:opacity-50"
                >
                  {exporting ? (
                    <>
                      <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      {exporting === 'pdf' ? 'Generating...' : 'Exporting...'}
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                      </svg>
                      Export
                    </>
                  )}
                </motion.button>

                <AnimatePresence>
                  {exportOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-full mt-1 w-[200px] bg-white rounded-xl border border-[#e8e8e8] shadow-lg overflow-hidden z-50"
                    >
                      <button
                        onClick={() => handleExport('pdf')}
                        className="w-full text-left px-4 py-2.5 text-[13px] text-[#37352f] hover:bg-[#f7f7f5] transition-colors flex items-center gap-2.5"
                      >
                        <span className="text-[16px]">📄</span>
                        <div>
                          <div className="font-medium">One Page Brief</div>
                          <div className="text-[11px] text-[#999]">PDF with tables & flags</div>
                        </div>
                      </button>
                      <div className="h-px bg-[#f0f0f0]" />
                      <button
                        onClick={() => handleExport('csv')}
                        className="w-full text-left px-4 py-2.5 text-[13px] text-[#37352f] hover:bg-[#f7f7f5] transition-colors flex items-center gap-2.5"
                      >
                        <span className="text-[16px]">📊</span>
                        <div>
                          <div className="font-medium">Export Data</div>
                          <div className="text-[11px] text-[#999]">CSV for Excel / Sheets</div>
                        </div>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Messages area */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto bg-white">
            <div className="max-w-3xl mx-auto px-5 py-6">
              <AnimatePresence mode="sync">
                {messages.length === 0 ? (
                  <Dashboard
                    key="dashboard"
                    onSelectProject={handleDashboardSelectProject}
                    onSendMessage={sendMessage}
                  />
                ) : (
                  messages.map((message, i) => (
                    <ChatMessage
                      key={message.id}
                      message={message}
                      sources={sourcesMap[message.id]}
                      isStreaming={
                        isStreaming && i === messages.length - 1 && message.role === 'assistant'
                      }
                    />
                  ))
                )}
              </AnimatePresence>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 p-4 rounded-xl bg-[#fff5f5] border border-[#fecaca] text-[#dc2626] text-[14px]"
                >
                  {error}
                </motion.div>
              )}
            </div>
          </div>
        </>
      )}

      {showUpload && user && (
        <UploadJobCost orgId={user.orgId} onClose={() => setShowUpload(false)} />
      )}
    </>
  );
}
