'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from '@/hooks/useSession';

/* ── Types ────────────────────────────────────────────── */
interface SavedNote {
  id: string;
  content: string;
  crewCount: number | null;
  weather: string | null;
  authorName: string;
  authorEmail: string;
  createdAt: string;
}

interface DailyNoteCardProps {
  projectId: string;
  /** Context-aware prompts generated from dashboard data */
  smartPrompts?: string[];
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

/* ── Constants ────────────────────────────────────────── */
const WEATHER_OPTIONS = [
  { emoji: '☀️', label: 'Sunny' },
  { emoji: '⛅', label: 'Cloudy' },
  { emoji: '🌧️', label: 'Rain' },
  { emoji: '❄️', label: 'Cold' },
  { emoji: '🌬️', label: 'Windy' },
];

const STANDING_PROMPTS = [
  'What did the crew work on today?',
  'Any delays, issues, or blockers?',
  'Safety observations or concerns?',
];

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/* ── Component ────────────────────────────────────────── */
export default function DailyNoteCard({ projectId, smartPrompts = [] }: DailyNoteCardProps) {
  const { user } = useSession();

  /* State */
  const [savedNote, setSavedNote] = useState<SavedNote | null>(null);
  const [noteContent, setNoteContent] = useState('');
  const [crewCount, setCrewCount] = useState<string>('');
  const [weather, setWeather] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalTranscriptRef = useRef('');

  /* ── Init ────────────────────────────────────────────── */
  useEffect(() => {
    setSpeechSupported(!!getSpeechRecognition());
  }, []);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.abort();
    };
  }, []);

  /* Auto-resize textarea */
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }
  }, [noteContent]);

  /* ── Fetch today's note ──────────────────────────────── */
  useEffect(() => {
    if (!projectId) return;
    setIsLoading(true);

    fetch(`/api/daily-note?projectId=${encodeURIComponent(projectId)}&date=${todayStr()}`)
      .then((res) => (res.ok ? res.json() : { note: null }))
      .then((data) => {
        if (data.note) {
          setSavedNote(data.note);
          setNoteContent(data.note.content);
          setCrewCount(data.note.crewCount != null ? String(data.note.crewCount) : '');
          setWeather(data.note.weather);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [projectId]);

  /* ── Speech recognition ──────────────────────────────── */
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

    finalTranscriptRef.current = noteContent;

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

      if (sessionFinal) {
        const sep = finalTranscriptRef.current.length > 0 ? ' ' : '';
        finalTranscriptRef.current += sep + sessionFinal;
      }

      const sep = finalTranscriptRef.current.length > 0 && interim ? ' ' : '';
      setNoteContent(finalTranscriptRef.current + sep + interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Speech error:', event.error);
      if (event.error !== 'no-speech') stopListening();
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    textareaRef.current?.focus();
  }, [noteContent, stopListening]);

  const toggleListening = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  /* ── Save note ───────────────────────────────────────── */
  const handleSave = async () => {
    if (!noteContent.trim() || isSaving) return;
    if (isListening) stopListening();

    setIsSaving(true);
    setSaveError(null);

    try {
      const res = await fetch('/api/daily-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          date: todayStr(),
          content: noteContent.trim(),
          crewCount: crewCount ? parseInt(crewCount, 10) : null,
          weather,
          noteId: savedNote?.id || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSaveError(data.error || 'Failed to save');
        return;
      }

      setSavedNote(data.note);
      setIsEditing(false);
    } catch {
      setSaveError('Network error — try again');
    } finally {
      setIsSaving(false);
    }
  };

  /* ── Edit mode ───────────────────────────────────────── */
  const handleEdit = () => {
    setIsEditing(true);
    finalTranscriptRef.current = noteContent;
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  /* ── Render ──────────────────────────────────────────── */
  const showInput = !savedNote || isEditing;

  if (isLoading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 rounded-2xl ring-1 ring-[#e8e8e8] bg-white p-5"
      >
        <div className="flex items-center gap-2">
          <span className="text-[15px]">📝</span>
          <span className="text-[13px] text-[#999]">Loading today&apos;s note...</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 }}
      className="mb-6 rounded-2xl ring-1 ring-[#e8e8e8] bg-white overflow-hidden"
    >
      {/* ── Header ────────────────────────────────────── */}
      <div className="px-5 py-3 border-b border-[#f0f0f0] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[15px]">📝</span>
          <h3 className="text-[13px] font-semibold text-[#1a1a1a]">Today&apos;s Note</h3>
          <span className="text-[11px] text-[#999]">{formatDate()}</span>
        </div>
        {savedNote && !isEditing && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Saved {formatTime(savedNote.createdAt)}
            </span>
          </div>
        )}
      </div>

      {/* ── Saved state ───────────────────────────────── */}
      <AnimatePresence mode="wait">
        {!showInput && savedNote && (
          <motion.div
            key="saved"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-5 py-4"
          >
            <p className="text-[13px] text-[#37352f] leading-relaxed whitespace-pre-wrap">
              {savedNote.content}
            </p>

            {/* Meta row */}
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              {savedNote.crewCount != null && (
                <span className="text-[11px] text-[#999] flex items-center gap-1">
                  👷 Crew: {savedNote.crewCount}
                </span>
              )}
              {savedNote.weather && (
                <span className="text-[11px] text-[#999]">
                  {savedNote.weather}
                </span>
              )}
              {savedNote.authorName && (
                <span className="text-[11px] text-[#999]">
                  by {savedNote.authorName}
                </span>
              )}
            </div>

            <button
              onClick={handleEdit}
              className="mt-3 text-[12px] text-[#007aff] hover:text-[#0066d6] font-medium transition-colors"
            >
              Edit note
            </button>
          </motion.div>
        )}

        {/* ── Input state ─────────────────────────────── */}
        {showInput && (
          <motion.div
            key="input"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-5 py-4"
          >
            {/* Smart prompts — context-aware */}
            {smartPrompts.length > 0 && (
              <div className="mb-3 space-y-1.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[#aeaeb2] mb-1.5">
                  Cortex wants to know
                </p>
                {smartPrompts.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      const prefix = noteContent.trim() ? noteContent.trim() + '\n\n' : '';
                      setNoteContent(prefix + prompt.replace(/\s*—.*$/, ': '));
                      finalTranscriptRef.current = prefix + prompt.replace(/\s*—.*$/, ': ');
                      textareaRef.current?.focus();
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg bg-amber-50 hover:bg-amber-100/80 text-[12px] text-amber-800 transition-colors flex items-start gap-2"
                  >
                    <span className="text-amber-500 mt-0.5 flex-shrink-0">⚡</span>
                    <span>{prompt}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Standing prompts — always shown */}
            <div className="mb-3">
              {smartPrompts.length > 0 && (
                <p className="text-[10px] font-medium uppercase tracking-wider text-[#aeaeb2] mb-1.5">
                  Quick prompts
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {STANDING_PROMPTS.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      const prefix = noteContent.trim() ? noteContent.trim() + '\n\n' : '';
                      setNoteContent(prefix + prompt.split('?')[0] + ': ');
                      finalTranscriptRef.current = prefix + prompt.split('?')[0] + ': ';
                      textareaRef.current?.focus();
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-[#f7f7f5] hover:bg-[#ebebea] text-[11px] text-[#6b6b6b] transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            {/* Text + voice input */}
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={noteContent}
                onChange={(e) => {
                  setNoteContent(e.target.value);
                  if (!isListening) finalTranscriptRef.current = e.target.value;
                }}
                placeholder="Tap the mic and talk, or type your note..."
                rows={3}
                className={`w-full resize-none rounded-xl border px-4 py-3 pr-16 text-[14px] text-[#1a1a1a] placeholder-[#b4b4b4] focus:outline-none focus:ring-2 transition-all ${
                  isListening
                    ? 'border-[#ff3b30]/30 bg-[#fff8f8] ring-2 ring-[#ff3b30]/10'
                    : 'border-[#e5e5e5] bg-[#fafafa] focus:ring-[#007aff]/15 focus:border-[#007aff]/30 focus:bg-white'
                }`}
              />

              {/* Mic button inside textarea */}
              {speechSupported && (
                <button
                  onClick={toggleListening}
                  className={`absolute right-3 top-3 w-[36px] h-[36px] rounded-full flex items-center justify-center transition-all ${
                    isListening
                      ? 'bg-[#ff3b30] text-white shadow-lg shadow-[#ff3b30]/25'
                      : 'bg-[#f0f0f0] hover:bg-[#e5e5e5] text-[#6b6b6b] hover:text-[#1a1a1a]'
                  }`}
                >
                  {isListening ? (
                    <>
                      <motion.span
                        className="absolute inset-0 rounded-full bg-[#ff3b30]"
                        animate={{ scale: [1, 1.4], opacity: [0.4, 0] }}
                        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
                      />
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="relative z-10">
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                      </svg>
                    </>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                      <path d="M19 10v2a7 7 0 01-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  )}
                </button>
              )}

              {/* Recording badge */}
              <AnimatePresence>
                {isListening && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="absolute left-3 bottom-3 flex items-center gap-1.5 pointer-events-none"
                  >
                    <motion.div
                      className="w-[6px] h-[6px] rounded-full bg-[#ff3b30]"
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    />
                    <span className="text-[10px] text-[#ff3b30] font-semibold tracking-wider uppercase">
                      Listening...
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Bottom row: crew + weather + save */}
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              {/* Crew count */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#999]">👷 Crew:</span>
                <input
                  type="number"
                  value={crewCount}
                  onChange={(e) => setCrewCount(e.target.value)}
                  placeholder="—"
                  min={0}
                  max={99}
                  className="w-[48px] text-center text-[12px] font-medium text-[#1a1a1a] border border-[#e5e5e5] rounded-lg py-1 bg-[#fafafa] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20 focus:border-[#007aff]/30"
                />
              </div>

              {/* Weather */}
              <div className="flex items-center gap-1">
                {WEATHER_OPTIONS.map((w) => (
                  <button
                    key={w.label}
                    onClick={() => setWeather(weather === w.emoji ? null : w.emoji)}
                    title={w.label}
                    className={`w-[30px] h-[30px] rounded-lg flex items-center justify-center text-[14px] transition-all ${
                      weather === w.emoji
                        ? 'bg-[#007aff]/10 ring-1 ring-[#007aff]/30 scale-110'
                        : 'hover:bg-[#f0f0f0]'
                    }`}
                  >
                    {w.emoji}
                  </button>
                ))}
              </div>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Cancel (if editing) */}
              {isEditing && (
                <button
                  onClick={() => {
                    setIsEditing(false);
                    if (savedNote) {
                      setNoteContent(savedNote.content);
                      setCrewCount(savedNote.crewCount != null ? String(savedNote.crewCount) : '');
                      setWeather(savedNote.weather);
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg text-[12px] text-[#999] hover:text-[#666] hover:bg-[#f0f0f0] transition-colors"
                >
                  Cancel
                </button>
              )}

              {/* Save button */}
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={handleSave}
                disabled={!noteContent.trim() || isSaving}
                className="px-4 py-2 rounded-xl bg-[#1a1a1a] hover:bg-[#333] disabled:bg-[#e5e5e5] disabled:text-[#999] text-white text-[12px] font-semibold transition-all flex items-center gap-1.5"
              >
                {isSaving ? (
                  <>
                    <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    Saving...
                  </>
                ) : isEditing ? (
                  'Update Note'
                ) : (
                  'Save Note'
                )}
              </motion.button>
            </div>

            {/* Save error */}
            {saveError && (
              <p className="text-[11px] text-red-500 mt-2">{saveError}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
