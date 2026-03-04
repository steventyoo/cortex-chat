'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { useChat } from '@/hooks/useChat';
import { ProjectSummary } from '@/lib/types';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import Sidebar from './Sidebar';

interface ChatContainerProps {
  projects: ProjectSummary[];
}

const SUGGESTED_QUERIES = [
  'Give me a full summary of Compass Northgate M2',
  'What are the biggest change orders?',
  'Show me production metrics and labor performance',
  'Which COs were caused by design changes?',
  'How is the budget tracking by category?',
  'Trace the ASI-04 document chain',
];

export default function ChatContainer({ projects }: ChatContainerProps) {
  const {
    messages,
    isStreaming,
    error,
    currentProjectId,
    sendMessage,
    clearConversation,
    setProject,
  } = useChat();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'csv' | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="flex h-dvh bg-white">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar
          projects={projects}
          selectedProject={currentProjectId}
          onSelectProject={(id) => {
            setProject(id);
            clearConversation();
          }}
          onNewChat={clearConversation}
          isOpen={true}
          onToggle={() => {}}
        />
      </div>

      {/* Mobile sidebar */}
      <div className="lg:hidden">
        <Sidebar
          projects={projects}
          selectedProject={currentProjectId}
          onSelectProject={(id) => {
            setProject(id);
            clearConversation();
            setSidebarOpen(false);
          }}
          onNewChat={() => {
            clearConversation();
            setSidebarOpen(false);
          }}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
        />
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar — clean, minimal */}
        <div className="flex items-center gap-3 px-5 h-[52px] border-b border-[#f0f0f0] bg-white/80 backdrop-blur-xl flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-1.5 rounded-lg hover:bg-[#f0f0f0] text-[#6b6b6b] transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M3 12H21M3 6H21M3 18H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          <div className="flex-1">
            {currentProjectId ? (
              <h2 className="text-[14px] font-medium text-[#1a1a1a]">
                {currentProject?.projectName || currentProjectId}
              </h2>
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
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="flex flex-col items-center justify-center min-h-[60vh] text-center"
                >
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 200, delay: 0.1 }}
                    className="w-[52px] h-[52px] rounded-[14px] bg-[#1a1a1a] flex items-center justify-center mb-5"
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
                      <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
                      <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                  </motion.div>

                  <motion.h2
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="text-[22px] font-semibold text-[#1a1a1a] mb-1.5 tracking-[-0.02em]"
                  >
                    Project Cortex
                  </motion.h2>
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="text-[15px] text-[#999] mb-8 max-w-sm"
                  >
                    Ask about change orders, budgets, production metrics, or get a full project summary.
                  </motion.p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl w-full">
                    {SUGGESTED_QUERIES.map((query, i) => (
                      <motion.button
                        key={query}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.35 + i * 0.04 }}
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => sendMessage(query)}
                        className="text-left px-4 py-3 rounded-xl border border-[#e8e8e8] hover:border-[#d0d0d0] hover:bg-[#fafafa] text-[13px] text-[#6b6b6b] hover:text-[#37352f] transition-all"
                      >
                        {query}
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
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
      </div>
    </div>
  );
}
