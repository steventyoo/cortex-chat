'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { useChat } from '@/hooks/useChat';
import { useConversationHistory } from '@/hooks/useConversationHistory';
import { ProjectSummary } from '@/lib/types';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import Sidebar from './Sidebar';
import Dashboard from './Dashboard';
import PipelineReview from './PipelineReview';

interface ChatContainerProps {
  projects: ProjectSummary[];
}

export default function ChatContainer({ projects }: ChatContainerProps) {
  const {
    messages,
    isStreaming,
    error,
    currentProjectId,
    sendMessage,
    clearConversation,
    setProject,
    clearProject,
    setMessages,
  } = useChat();

  const {
    currentConversationId,
    saveConversation,
    loadConversation,
    startNewConversation,
    deleteConversation,
    getSummaries,
  } = useConversationHistory();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'csv' | null>(null);
  const [currentView, setCurrentView] = useState<'chat' | 'pipeline'>('chat');
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

  // Close export dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Auto-save conversation when messages change (after streaming completes)
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
  }, [clearConversation, clearProject, startNewConversation]);

  const handleSelectProject = useCallback(
    (projectId: string) => {
      setProject(projectId);
      clearConversation();
      startNewConversation();
      prevMessagesLenRef.current = 0;
      setSidebarOpen(false);
    },
    [setProject, clearConversation, startNewConversation]
  );

  const handleSelectConversation = useCallback(
    (convId: string) => {
      const conv = loadConversation(convId);
      if (conv) {
        if (conv.projectId) {
          setProject(conv.projectId);
        }
        setMessages(conv.messages);
        prevMessagesLenRef.current = conv.messages.length;
      }
      setSidebarOpen(false);
    },
    [loadConversation, setProject, setMessages]
  );

  const handleNavigate = useCallback(
    (view: 'chat' | 'pipeline') => {
      setCurrentView(view);
      if (view === 'chat') {
        handleNewChat();
      }
      setSidebarOpen(false);
    },
    [handleNewChat]
  );

  const handleDashboardSelectProject = useCallback(
    (projectId: string) => {
      setProject(projectId);
      clearConversation();
      startNewConversation();
      prevMessagesLenRef.current = 0;
    },
    [setProject, clearConversation, startNewConversation]
  );

  const conversationSummaries = getSummaries();

  return (
    <div className="flex h-dvh bg-white">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar
          projects={projects}
          selectedProject={currentProjectId}
          onSelectProject={handleSelectProject}
          onNewChat={() => { handleNewChat(); setCurrentView('chat'); }}
          isOpen={true}
          onToggle={() => {}}
          conversations={conversationSummaries}
          activeConversationId={currentConversationId}
          onSelectConversation={(id) => { handleSelectConversation(id); setCurrentView('chat'); }}
          onDeleteConversation={deleteConversation}
          currentView={currentView}
          onNavigate={handleNavigate}
        />
      </div>

      {/* Mobile sidebar */}
      <div className="lg:hidden">
        <Sidebar
          projects={projects}
          selectedProject={currentProjectId}
          onSelectProject={(id) => { handleSelectProject(id); setCurrentView('chat'); }}
          onNewChat={() => {
            handleNewChat();
            setCurrentView('chat');
            setSidebarOpen(false);
          }}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          conversations={conversationSummaries}
          activeConversationId={currentConversationId}
          onSelectConversation={(id) => {
            handleSelectConversation(id);
            setCurrentView('chat');
            setSidebarOpen(false);
          }}
          onDeleteConversation={deleteConversation}
          currentView={currentView}
          onNavigate={(view) => { handleNavigate(view); setSidebarOpen(false); }}
        />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {currentView === 'pipeline' ? (
          /* ─── Pipeline View ─────────────────────────── */
          <>
            {/* Pipeline top bar (mobile hamburger only) */}
            <div className="flex items-center gap-3 px-5 h-[52px] border-b border-[#f0f0f0] bg-white/80 backdrop-blur-xl flex-shrink-0 lg:hidden">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-1.5 rounded-lg hover:bg-[#f0f0f0] text-[#6b6b6b] transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M3 12H21M3 6H21M3 18H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <PipelineReview />
            </div>
          </>
        ) : (
          /* ─── Chat View ─────────────────────────────── */
          <>
            {/* Top bar */}
            <div className="flex items-center gap-3 px-5 h-[52px] border-b border-[#f0f0f0] bg-white/80 backdrop-blur-xl flex-shrink-0">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden p-1.5 rounded-lg hover:bg-[#f0f0f0] text-[#6b6b6b] transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M3 12H21M3 6H21M3 18H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>

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

              {/* Export dropdown */}
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

            <ChatInput onSend={sendMessage} disabled={isStreaming} />
          </>
        )}
      </div>
    </div>
  );
}
