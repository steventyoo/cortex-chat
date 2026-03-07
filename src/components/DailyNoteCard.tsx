'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from '@/hooks/useSession';

/* ── Types ────────────────────────────────────────────── */
interface NoteEntry {
  id: string;
  content: string;
  crewCount: number | null;
  weather: string | null;
  authorName: string;
  authorEmail: string;
  date: string;
  createdAt: string;
  updatedAt: string;
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
  { emoji: '\u2600\uFE0F', label: 'Sunny' },
  { emoji: '\u26C5', label: 'Cloudy' },
  { emoji: '\uD83C\uDF27\uFE0F', label: 'Rain' },
  { emoji: '\u2744\uFE0F', label: 'Cold' },
  { emoji: '\uD83C\uDF2C\uFE0F', label: 'Windy' },
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

function formatNoteDate(dateStr: string): string {
  try {
    // dateStr is YYYY-MM-DD — parse as local date
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const today = new Date();
    const todayDate = todayStr();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (dateStr === todayDate) return 'Today';
    if (dateStr === yesterdayStr) return 'Yesterday';

    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatHeaderDate(): string {
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
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [noteContent, setNoteContent] = useState('');
  const [noteDate, setNoteDate] = useState(todayStr());
  const [crewCount, setCrewCount] = useState<string>('');
  const [weather, setWeather] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [showNewNote, setShowNewNote] = useState(false);
  const [expandedLog, setExpandedLog] = useState(true);

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

  /* ── Fetch all notes for project (log mode) ────────── */
  const fetchNotes = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);

    try {
      const res = await fetch(
        `/api/daily-note?projectId=${encodeURIComponent(projectId)}&mode=log`
      );
      const data = res.ok ? await res.json() : { notes: [] };
      setNotes(data.notes || []);
    } catch {
      setNotes([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

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

  /* ── Save note (create or update) ──────────────────── */
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
          date: noteDate,
          content: noteContent.trim(),
          crewCount: crewCount ? parseInt(crewCount, 10) : null,
          weather,
          noteId: editingNoteId || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSaveError(data.error || 'Failed to save');
        return;
      }

      // Refresh notes list
      await fetchNotes();

      // Reset form
      setNoteContent('');
      setNoteDate(todayStr());
      setCrewCount('');
      setWeather(null);
      setEditingNoteId(null);
      setShowNewNote(false);
      finalTranscriptRef.current = '';
    } catch {
      setSaveError('Network error — try again');
    } finally {
      setIsSaving(false);
    }
  };

  /* ── Edit note ─────────────────────────────────────── */
  const handleEdit = (note: NoteEntry) => {
    setEditingNoteId(note.id);
    setNoteContent(note.content);
    setNoteDate(note.date);
    setCrewCount(note.crewCount != null ? String(note.crewCount) : '');
    setWeather(note.weather);
    setShowNewNote(true);
    finalTranscriptRef.current = note.content;
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  /* ── Delete note (soft delete) ─────────────────────── */
  const handleDelete = async (noteId: string) => {
    setDeletingNoteId(noteId);
    try {
      const res = await fetch('/api/daily-note', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId }),
      });

      if (res.ok) {
        await fetchNotes();
      }
    } catch {
      // Silently fail
    } finally {
      setDeletingNoteId(null);
      setConfirmDeleteId(null);
    }
  };

  /* ── Cancel editing ────────────────────────────────── */
  const handleCancel = () => {
    setEditingNoteId(null);
    setNoteContent('');
    setNoteDate(todayStr());
    setCrewCount('');
    setWeather(null);
    setShowNewNote(false);
    setSaveError(null);
    finalTranscriptRef.current = '';
    if (isListening) stopListening();
  };

  /* ── Render ──────────────────────────────────────────── */
  const hasNotesToday = notes.some((n) => n.date === todayStr());

  if (isLoading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 rounded-2xl ring-1 ring-[#e8e8e8] bg-white p-5"
      >
        <div className="flex items-center gap-2">
          <span className="text-[15px]">{'\uD83D\uDCDD'}</span>
          <span className="text-[13px] text-[#999]">Loading notes...</span>
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
        <button
          onClick={() => setExpandedLog(!expandedLog)}
          className="flex items-center gap-2 hover:opacity-70 transition-opacity"
        >
          <span className="text-[15px]">{'\uD83D\uDCDD'}</span>
          <h3 className="text-[13px] font-semibold text-[#1a1a1a]">Daily Notes</h3>
          <span className="text-[11px] text-[#999]">{formatHeaderDate()}</span>
          {notes.length > 0 && (
            <span className="text-[10px] bg-[#f0f0f0] text-[#666] px-1.5 py-0.5 rounded-full font-medium">
              {notes.length}
            </span>
          )}
          <svg
            className={`w-3 h-3 text-[#999] transition-transform ${expandedLog ? 'rotate-0' : '-rotate-90'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {!showNewNote && expandedLog && (
          <button
            onClick={() => { setShowNewNote(true); setTimeout(() => textareaRef.current?.focus(), 100); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a1a1a] hover:bg-[#333] text-white text-[11px] font-semibold transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Note
          </button>
        )}
      </div>

      <AnimatePresence>
        {expandedLog && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* ── New/Edit note form ─────────────────────── */}
            <AnimatePresence>
              {showNewNote && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border-b border-[#f0f0f0]"
                >
                  <div className="px-5 py-4">
                    {/* Date selector */}
                    <div className="flex items-center gap-2 mb-3">
                      <label className="text-[11px] text-[#999] font-medium">Date:</label>
                      <input
                        type="date"
                        value={noteDate}
                        onChange={(e) => setNoteDate(e.target.value)}
                        max={todayStr()}
                        className="text-[12px] text-[#1a1a1a] border border-[#e5e5e5] rounded-lg px-2 py-1 bg-[#fafafa] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20"
                      />
                      {editingNoteId && (
                        <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
                          Editing — previous version saved
                        </span>
                      )}
                    </div>

                    {/* Smart prompts — context-aware */}
                    {!editingNoteId && smartPrompts.length > 0 && (
                      <div className="mb-3 space-y-1.5">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-[#aeaeb2] mb-1.5">
                          Cortex wants to know
                        </p>
                        {smartPrompts.map((prompt, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              const prefix = noteContent.trim() ? noteContent.trim() + '\n\n' : '';
                              setNoteContent(prefix + prompt.replace(/\s*\u2014.*$/, ': '));
                              finalTranscriptRef.current = prefix + prompt.replace(/\s*\u2014.*$/, ': ');
                              textareaRef.current?.focus();
                            }}
                            className="w-full text-left px-3 py-2 rounded-lg bg-amber-50 hover:bg-amber-100/80 text-[12px] text-amber-800 transition-colors flex items-start gap-2"
                          >
                            <span className="text-amber-500 mt-0.5 flex-shrink-0">{'\u26A1'}</span>
                            <span>{prompt}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Standing prompts — always shown for new notes */}
                    {!editingNoteId && (
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
                    )}

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
                        <span className="text-[11px] text-[#999]">{'\uD83D\uDC77'} Crew:</span>
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

                      {/* Cancel */}
                      <button
                        onClick={handleCancel}
                        className="px-3 py-1.5 rounded-lg text-[12px] text-[#999] hover:text-[#666] hover:bg-[#f0f0f0] transition-colors"
                      >
                        Cancel
                      </button>

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
                        ) : editingNoteId ? (
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
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Notes log ───────────────────────────────── */}
            {notes.length === 0 && !showNewNote ? (
              <div className="px-5 py-8 text-center">
                <p className="text-[13px] text-[#999]">No notes yet for this project.</p>
                <button
                  onClick={() => { setShowNewNote(true); setTimeout(() => textareaRef.current?.focus(), 100); }}
                  className="mt-2 text-[12px] text-[#007aff] hover:text-[#0066d6] font-medium"
                >
                  Add the first note
                </button>
              </div>
            ) : (
              <div className="divide-y divide-[#f0f0f0]">
                {notes.map((note) => (
                  <div key={note.id} className="px-5 py-3.5 hover:bg-[#fafafa] transition-colors group">
                    {/* Note header: date + author + actions */}
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-[#1a1a1a]">
                          {formatNoteDate(note.date)}
                        </span>
                        <span className="text-[10px] text-[#bbb]">{'\u00B7'}</span>
                        <span className="text-[11px] text-[#999]">
                          {note.authorName}
                        </span>
                        {note.updatedAt && (
                          <>
                            <span className="text-[10px] text-[#bbb]">{'\u00B7'}</span>
                            <span className="text-[10px] text-[#bbb] italic">edited</span>
                          </>
                        )}
                      </div>

                      {/* Actions — visible on hover */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleEdit(note)}
                          className="px-2 py-1 rounded text-[10px] text-[#007aff] hover:bg-[#007aff]/5 font-medium transition-colors"
                        >
                          Edit
                        </button>
                        {confirmDeleteId === note.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(note.id)}
                              disabled={deletingNoteId === note.id}
                              className="px-2 py-1 rounded text-[10px] text-red-600 hover:bg-red-50 font-medium transition-colors"
                            >
                              {deletingNoteId === note.id ? 'Deleting...' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 rounded text-[10px] text-[#999] hover:bg-[#f0f0f0] font-medium transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(note.id)}
                            className="px-2 py-1 rounded text-[10px] text-red-400 hover:text-red-600 hover:bg-red-50 font-medium transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Note content */}
                    <p className="text-[13px] text-[#37352f] leading-relaxed whitespace-pre-wrap">
                      {note.content}
                    </p>

                    {/* Meta row */}
                    {(note.crewCount != null || note.weather) && (
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        {note.crewCount != null && (
                          <span className="text-[11px] text-[#999] flex items-center gap-1">
                            {'\uD83D\uDC77'} Crew: {note.crewCount}
                          </span>
                        )}
                        {note.weather && (
                          <span className="text-[11px] text-[#999]">
                            {note.weather}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── Empty state prompt for today ───────────── */}
            {!hasNotesToday && notes.length > 0 && !showNewNote && (
              <div className="px-5 py-3 bg-[#fffbeb] border-t border-amber-100">
                <button
                  onClick={() => { setShowNewNote(true); setNoteDate(todayStr()); setTimeout(() => textareaRef.current?.focus(), 100); }}
                  className="text-[12px] text-amber-700 hover:text-amber-900 font-medium flex items-center gap-1.5"
                >
                  <span>{'\u26A1'}</span>
                  No note for today yet — tap to add one
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
