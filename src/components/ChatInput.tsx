'use client';

import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

/* ── Web Speech API types ─────────────────────────────── */
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}
type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/* ── Component ────────────────────────────────────────── */
export default function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalTranscriptRef = useRef('');

  /* Check browser support once */
  useEffect(() => {
    setSpeechSupported(!!getSpeechRecognition());
  }, []);

  /* Cleanup on unmount */
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  /* Auto-resize textarea */
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    }
  }, [value]);

  /* ── Speech recognition controls ────────────────────── */
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) return;

    // Preserve whatever is already typed
    finalTranscriptRef.current = value;

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let sessionFinal = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          sessionFinal += transcript;
        } else {
          interim += transcript;
        }
      }

      // Append finalized speech to stored text
      if (sessionFinal) {
        const sep = finalTranscriptRef.current.length > 0 ? ' ' : '';
        finalTranscriptRef.current += sep + sessionFinal;
      }

      // Show final + interim in textarea
      const sep =
        finalTranscriptRef.current.length > 0 && interim ? ' ' : '';
      setValue(finalTranscriptRef.current + sep + interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Speech recognition error:', event.error);
      if (event.error !== 'no-speech') {
        stopListening();
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);

    // Focus textarea so PM can see text streaming in
    textareaRef.current?.focus();
  }, [value, stopListening]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  /* ── Send / keyboard ────────────────────────────────── */
  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    if (isListening) stopListening();
    onSend(trimmed);
    setValue('');
    finalTranscriptRef.current = '';
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
        {/* ── Mic button ──────────────────────────────── */}
        {speechSupported && (
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={toggleListening}
            disabled={disabled}
            title={isListening ? 'Stop recording' : 'Voice input'}
            className={`relative flex-shrink-0 w-[42px] h-[42px] rounded-full flex items-center justify-center transition-all mb-0.5 disabled:opacity-50 ${
              isListening
                ? 'bg-[#ff3b30] text-white shadow-lg shadow-[#ff3b30]/25'
                : 'bg-[#f0f0f0] hover:bg-[#e5e5e5] text-[#6b6b6b] hover:text-[#1a1a1a]'
            }`}
          >
            {/* Pulse ring behind button while recording */}
            {isListening && (
              <motion.span
                className="absolute inset-0 rounded-full bg-[#ff3b30]"
                animate={{ scale: [1, 1.4], opacity: [0.4, 0] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
              />
            )}

            {isListening ? (
              /* Stop icon */
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="relative z-10"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              /* Mic icon */
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="relative z-10"
              >
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                <path d="M19 10v2a7 7 0 01-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </motion.button>
        )}

        {/* ── Textarea ────────────────────────────────── */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              // Keep finalTranscript in sync with manual edits
              if (!isListening) {
                finalTranscriptRef.current = e.target.value;
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={isListening ? 'Listening — speak now...' : 'Ask about your project...'}
            disabled={disabled}
            rows={1}
            className={`w-full resize-none rounded-xl border px-4 py-3 text-[15px] text-[#1a1a1a] placeholder-[#b4b4b4] focus:outline-none focus:ring-2 disabled:opacity-50 transition-all ${
              isListening
                ? 'border-[#ff3b30]/30 bg-[#fff8f8] ring-2 ring-[#ff3b30]/10 focus:ring-[#ff3b30]/15 focus:border-[#ff3b30]/30'
                : 'border-[#e5e5e5] bg-[#f9f9f9] focus:ring-[#007aff]/15 focus:border-[#007aff]/30 focus:bg-white'
            }`}
          />

          {/* Recording badge inside textarea */}
          <AnimatePresence>
            {isListening && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none"
              >
                <motion.div
                  className="w-[6px] h-[6px] rounded-full bg-[#ff3b30]"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
                <span className="text-[10px] text-[#ff3b30] font-semibold tracking-wider uppercase">
                  Rec
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Send button ─────────────────────────────── */}
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className="flex-shrink-0 w-[42px] h-[42px] rounded-full bg-[#007aff] hover:bg-[#0066d6] disabled:bg-[#e5e5e5] flex items-center justify-center transition-colors mb-0.5"
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

      {/* Helper text — first time or when listening */}
      <AnimatePresence>
        {isListening && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="max-w-3xl mx-auto text-[11px] text-[#999] mt-1.5 px-1"
          >
            Speak naturally — your words appear above. Tap stop when done, review, then send.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
