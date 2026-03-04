'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { motion } from 'framer-motion';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    }
  }, [value]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-[#f0f0f0] bg-white/80 backdrop-blur-xl px-4 py-3">
      <div className="max-w-3xl mx-auto relative flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your project..."
            disabled={disabled}
            rows={1}
            className="w-full resize-none rounded-xl border border-[#e5e5e5] bg-[#f9f9f9] px-4 py-3 text-[15px] text-[#1a1a1a] placeholder-[#b4b4b4] focus:outline-none focus:ring-2 focus:ring-[#007aff]/15 focus:border-[#007aff]/30 focus:bg-white disabled:opacity-50 transition-all"
          />
        </div>
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className="flex-shrink-0 w-[38px] h-[38px] rounded-full bg-[#007aff] hover:bg-[#0066d6] disabled:bg-[#e5e5e5] flex items-center justify-center transition-colors mb-0.5"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            className="text-white"
          >
            <path
              d="M7 11L12 6L17 11M12 18V7"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </motion.button>
      </div>
    </div>
  );
}
