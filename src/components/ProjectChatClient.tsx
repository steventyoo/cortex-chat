'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChat } from '@/hooks/useChat';
import { useConversationHistory } from '@/hooks/useConversationHistory';
import { useSession } from '@/hooks/useSession';
import { useAppShellFooter } from './AppShell';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';

interface Props {
  projectId: string;
}

export default function ProjectChatClient({ projectId }: Props) {
  const {
    messages,
    isStreaming,
    error,
    currentProjectId,
    sourcesMap,
    sendMessage,
    clearConversation,
    setProject,
    setMessages,
  } = useChat();

  const {
    saveConversation,
    pendingLoad,
    consumePendingLoad,
  } = useConversationHistory();

  const { user } = useSession();
  const { setFooter } = useAppShellFooter();

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMessagesLenRef = useRef(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'csv' | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setProject(projectId);
  }, [projectId, setProject]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    if (pendingLoad) {
      setMessages(pendingLoad.messages);
      prevMessagesLenRef.current = pendingLoad.messages.length;
      consumePendingLoad();
    }
  }, [pendingLoad, setMessages, consumePendingLoad]);

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
      saveConversation(messages, projectId, null);
      prevMessagesLenRef.current = messages.length;
    }
  }, [messages, isStreaming, projectId, saveConversation]);

  useEffect(() => {
    setFooter(
      <ChatInput
        onSend={(msg) => sendMessage(msg)}
        disabled={isStreaming}
      />
    );
    return () => setFooter(null);
  }, [isStreaming, sendMessage, setFooter]);

  const handleExport = useCallback(
    async (type: 'pdf' | 'csv') => {
      if (!projectId) return;
      setExporting(type);
      setExportOpen(false);
      try {
        const endpoint = type === 'pdf' ? '/api/brief' : '/api/export-csv';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId }),
        });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = type === 'pdf' ? `${projectId}-Brief.pdf` : `${projectId}-Data.csv`;
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
    [projectId]
  );

  return (
    <>
      {/* Export bar for project chat (desktop only, hidden by layout header on mobile) */}
      <div className="hidden lg:flex items-center gap-3 px-5 h-[44px] border-b border-[#f0f0f0] bg-white/80 backdrop-blur-xl flex-shrink-0">
        <div className="flex-1" />
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
                  className="w-full text-left px-4 py-2.5 text-[13px] text-[#37352f] hover:bg-[#f7f7f5] transition-colors"
                >
                  One Page Brief (PDF)
                </button>
                <div className="h-px bg-[#f0f0f0]" />
                <button
                  onClick={() => handleExport('csv')}
                  className="w-full text-left px-4 py-2.5 text-[13px] text-[#37352f] hover:bg-[#f7f7f5] transition-colors"
                >
                  Export Data (CSV)
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-white">
        <div className="max-w-3xl mx-auto px-5 py-6">
          <AnimatePresence mode="sync">
            {messages.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center py-20"
              >
                <p className="text-[15px] text-[#999]">Ask a question about this project...</p>
              </motion.div>
            ) : (
              messages.map((message, i) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  sources={sourcesMap[message.id]}
                  isStreaming={isStreaming && i === messages.length - 1 && message.role === 'assistant'}
                />
              ))
            )}
          </AnimatePresence>

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-[#fef2f2] border border-[#fecaca] text-[13px] text-[#dc2626]">
              {error}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
