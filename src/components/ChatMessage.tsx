'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ChatMessage as ChatMessageType } from '@/lib/types';
import MarkdownRenderer from './MarkdownRenderer';
import { StreamingProvider } from './DataTable';
import LoadingDots from './LoadingDots';

interface ChatMessageProps {
  message: ChatMessageType;
  isStreaming?: boolean;
}

export default function ChatMessage({
  message,
  isStreaming = false,
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [message.content]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', damping: 28, stiffness: 280 }}
      className={`group/msg flex ${isUser ? 'justify-end' : 'justify-start'} mb-5`}
    >
      {!isUser && (
        <div className="w-7 h-7 rounded-[8px] bg-[#1a1a1a] flex items-center justify-center mr-3 mt-0.5 flex-shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </div>
      )}

      <div
        className={`${
          isUser
            ? 'max-w-[75%] bg-[#007aff] text-white rounded-[18px] rounded-br-[6px] px-4 py-2.5'
            : 'flex-1 min-w-0'
        }`}
      >
        {isUser ? (
          <p className="text-[15px] leading-[1.5]">{message.content}</p>
        ) : message.content ? (
          <StreamingProvider isStreaming={isStreaming}>
            <MarkdownRenderer content={message.content} />
          </StreamingProvider>
        ) : isStreaming ? (
          <LoadingDots />
        ) : null}

        {isStreaming && message.content && (
          <motion.span
            animate={{ opacity: [1, 0] }}
            transition={{ duration: 0.5, repeat: Infinity }}
            className="inline-block w-[2px] h-[18px] bg-[#007aff] ml-0.5 rounded-full"
          />
        )}

        {/* Copy response button — assistant only, after streaming done */}
        {!isUser && message.content && !isStreaming && (
          <div className="mt-2 opacity-0 group-hover/msg:opacity-100 transition-opacity">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-[#aeaeb2] hover:text-[#1a1a1a] hover:bg-[#f0f0f0] transition-all"
            >
              {copied ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  Copy response
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
