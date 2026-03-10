'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from '@/hooks/useSession';

/* ── Types ────────────────────────────────────────────── */
interface ProductionData {
  trade?: string;
  metrics?: Record<string, number | null>;
  customItems?: { label: string; value: string }[];
  safetyIncident?: boolean;
  safetyNotes?: string;
  rfis?: string;
  deliveries?: string;
  tempF?: number;
  // Legacy fields (backward compat)
  pipeInstalled?: number | null;
  fixturesInstalled?: number | null;
  unitsCompleted?: number | null;
}

interface NoteEntry {
  id: string;
  content: string;
  crewCount: number | null;
  weather: string | null;
  productionData: ProductionData | null;
  authorName: string;
  authorEmail: string;
  date: string;
  createdAt: string;
  updatedAt: string;
}

interface DailyNoteCardProps {
  projectId: string;
  projectAddress?: string;
  projectTrade?: string;
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

const TRADES = ['Plumbing', 'Electrical', 'Mechanical', 'General'] as const;

const TRADE_METRICS: Record<string, { key: string; label: string; unit: string }[]> = {
  Plumbing: [
    { key: 'pipeInstalled', label: 'Pipe', unit: 'LF' },
    { key: 'fixtures', label: 'Fixtures', unit: '' },
    { key: 'units', label: 'Units', unit: '' },
  ],
  Electrical: [
    { key: 'wirePulled', label: 'Wire', unit: 'LF' },
    { key: 'devices', label: 'Devices', unit: '' },
    { key: 'lightFixtures', label: 'Lights', unit: '' },
    { key: 'panels', label: 'Panels', unit: '' },
  ],
  Mechanical: [
    { key: 'ductInstalled', label: 'Duct', unit: 'LF' },
    { key: 'unitsSet', label: 'Units', unit: '' },
    { key: 'diffusers', label: 'Diffusers', unit: '' },
  ],
  General: [],
};

const TRADE_COLORS: Record<string, { text: string; bg: string }> = {
  Plumbing: { text: '#007aff', bg: 'rgba(0,122,255,0.08)' },
  Electrical: { text: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  Mechanical: { text: '#10b981', bg: 'rgba(16,185,129,0.1)' },
  General: { text: '#666', bg: '#f0f0f0' },
};

/* ── SVG Icons (small inline) ─────────────────────────── */
const Icons = {
  wrench: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  bolt: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  gear: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
  list: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  shield: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  document: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  truck: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  ),
  chart: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  warning: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  ),
};

const TRADE_ICON: Record<string, React.ReactNode> = {
  Plumbing: Icons.wrench,
  Electrical: Icons.bolt,
  Mechanical: Icons.gear,
  General: Icons.list,
};

/* ── Helpers ──────────────────────────────────────────── */
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function formatNoteDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const todayDate = todayStr();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    if (dateStr === todayDate) return 'Today';
    if (dateStr === yesterdayStr) return 'Yesterday';
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

function formatHeaderDate(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

/** Normalize legacy productionData to new format */
function normalizePD(pd: ProductionData | null): ProductionData | null {
  if (!pd) return null;
  if (!pd.trade && (pd.pipeInstalled != null || pd.fixturesInstalled != null || pd.unitsCompleted != null)) {
    return {
      ...pd,
      trade: 'Plumbing',
      metrics: {
        pipeInstalled: pd.pipeInstalled ?? null,
        fixtures: pd.fixturesInstalled ?? null,
        units: pd.unitsCompleted ?? null,
      },
    };
  }
  return pd;
}

/* ── Component ────────────────────────────────────────── */
export default function DailyNoteCard({ projectId, projectAddress, projectTrade }: DailyNoteCardProps) {
  const { user } = useSession();

  /* State */
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [noteDate, setNoteDate] = useState(todayStr());
  const [weather, setWeather] = useState<string | null>(null);
  const [weatherTemp, setWeatherTemp] = useState<number | null>(null);
  const [trade, setTrade] = useState(projectTrade || '');
  const [metrics, setMetrics] = useState<Record<string, string>>({});
  const [customItems, setCustomItems] = useState<{ label: string; value: string }[]>([]);
  const [safetyIncident, setSafetyIncident] = useState(false);
  const [safetyNotes, setSafetyNotes] = useState('');
  const [rfis, setRfis] = useState('');
  const [deliveries, setDeliveries] = useState('');
  const [issuesText, setIssuesText] = useState('');
  const [generalNotes, setGeneralNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [showNewReport, setShowNewReport] = useState(false);
  const [expandedLog, setExpandedLog] = useState(true);

  const issuesRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalTranscriptRef = useRef('');

  /* ── Init ────────────────────────────────────────────── */
  useEffect(() => { setSpeechSupported(!!getSpeechRecognition()); }, []);
  useEffect(() => { return () => { if (recognitionRef.current) recognitionRef.current.abort(); }; }, []);

  /* Auto-resize issues textarea */
  useEffect(() => {
    const ta = issuesRef.current;
    if (ta) { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`; }
  }, [issuesText]);

  /* ── Auto-fetch weather ─────────────────────────────── */
  useEffect(() => {
    if (!showNewReport || weather !== null || !projectAddress || editingNoteId) return;
    let cancelled = false;
    fetch(`/api/weather?address=${encodeURIComponent(projectAddress)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.emoji) {
          setWeather(data.emoji);
          if (data.tempF != null) setWeatherTemp(data.tempF);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [showNewReport, weather, projectAddress, editingNoteId]);

  /* ── Fetch notes ────────────────────────────────────── */
  const fetchNotes = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/daily-note?projectId=${encodeURIComponent(projectId)}&mode=log`);
      const data = res.ok ? await res.json() : { notes: [] };
      setNotes(data.notes || []);
    } catch { setNotes([]); }
    finally { setIsLoading(false); }
  }, [projectId]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  /* ── Speech recognition (for Issues field) ──────────── */
  const stopListening = useCallback(() => {
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) return;
    finalTranscriptRef.current = issuesText;
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let sessionFinal = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) sessionFinal += transcript;
        else interim += transcript;
      }
      if (sessionFinal) {
        const sep = finalTranscriptRef.current.length > 0 ? ' ' : '';
        finalTranscriptRef.current += sep + sessionFinal;
      }
      const sep = finalTranscriptRef.current.length > 0 && interim ? ' ' : '';
      setIssuesText(finalTranscriptRef.current + sep + interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== 'no-speech') stopListening();
    };
    recognition.onend = () => { setIsListening(false); recognitionRef.current = null; };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    issuesRef.current?.focus();
  }, [issuesText, stopListening]);

  const toggleListening = useCallback(() => {
    if (isListening) stopListening(); else startListening();
  }, [isListening, startListening, stopListening]);

  /* ── Save report ────────────────────────────────────── */
  const handleSave = async () => {
    if (isSaving) return;
    const hasMetrics = Object.values(metrics).some((v) => v !== '');
    const hasCustom = customItems.some((i) => i.label.trim() || i.value.trim());
    const hasContent = issuesText.trim() || generalNotes.trim() || rfis.trim() || deliveries.trim() || safetyNotes.trim();
    if (!hasMetrics && !hasCustom && !hasContent && !safetyIncident) return;

    if (isListening) stopListening();
    setIsSaving(true);
    setSaveError(null);

    // Build content from issues + general notes
    let content = '';
    if (issuesText.trim()) content += issuesText.trim();
    if (generalNotes.trim()) {
      content += content ? '\n---\n' + generalNotes.trim() : generalNotes.trim();
    }
    if (!content) content = 'Production report';

    const productionData: ProductionData = {
      trade: trade || undefined,
      metrics: Object.fromEntries(
        Object.entries(metrics).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])
      ),
      customItems: customItems.filter((i) => i.label.trim() || i.value.trim()),
      safetyIncident,
      safetyNotes: safetyNotes.trim() || undefined,
      rfis: rfis.trim() || undefined,
      deliveries: deliveries.trim() || undefined,
      tempF: weatherTemp ?? undefined,
    };

    try {
      const res = await fetch('/api/daily-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          date: noteDate,
          content,
          weather,
          productionData,
          noteId: editingNoteId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.error || 'Failed to save'); return; }

      await fetchNotes();
      resetForm();
    } catch { setSaveError('Network error — try again'); }
    finally { setIsSaving(false); }
  };

  /* ── Edit note ──────────────────────────────────────── */
  const handleEdit = (note: NoteEntry) => {
    setEditingNoteId(note.id);
    setNoteDate(note.date);
    setWeather(note.weather);

    const pd = normalizePD(note.productionData);
    if (pd) {
      setTrade(pd.trade || '');
      setMetrics(
        Object.fromEntries(
          Object.entries(pd.metrics || {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])
        )
      );
      setCustomItems(pd.customItems || []);
      setSafetyIncident(pd.safetyIncident || false);
      setSafetyNotes(pd.safetyNotes || '');
      setRfis(pd.rfis || '');
      setDeliveries(pd.deliveries || '');
      setWeatherTemp(pd.tempF ?? null);
    }

    const parts = note.content.split('\n---\n');
    setIssuesText(parts[0] || '');
    setGeneralNotes(parts.slice(1).join('\n---\n') || '');

    setShowNewReport(true);
    finalTranscriptRef.current = parts[0] || '';
    setTimeout(() => issuesRef.current?.focus(), 100);
  };

  /* ── Delete note ────────────────────────────────────── */
  const handleDelete = async (noteId: string) => {
    setDeletingNoteId(noteId);
    try {
      const res = await fetch('/api/daily-note', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId }),
      });
      if (res.ok) await fetchNotes();
    } catch { /* silent */ }
    finally { setDeletingNoteId(null); setConfirmDeleteId(null); }
  };

  /* ── Reset form ─────────────────────────────────────── */
  const resetForm = () => {
    setEditingNoteId(null);
    setNoteDate(todayStr());
    setWeather(null);
    setWeatherTemp(null);
    setTrade(projectTrade || '');
    setMetrics({});
    setCustomItems([]);
    setSafetyIncident(false);
    setSafetyNotes('');
    setRfis('');
    setDeliveries('');
    setIssuesText('');
    setGeneralNotes('');
    setShowNewReport(false);
    setSaveError(null);
    finalTranscriptRef.current = '';
    if (isListening) stopListening();
  };

  /* ── Custom item helpers ────────────────────────────── */
  const addCustomItem = () => setCustomItems([...customItems, { label: '', value: '' }]);
  const updateCustomItem = (idx: number, field: 'label' | 'value', val: string) => {
    const updated = [...customItems];
    updated[idx] = { ...updated[idx], [field]: val };
    setCustomItems(updated);
  };
  const removeCustomItem = (idx: number) => setCustomItems(customItems.filter((_, i) => i !== idx));

  /* ── Trade change (clears metrics) ──────────────────── */
  const handleTradeChange = (newTrade: string) => {
    setTrade(newTrade);
    setMetrics({});
  };

  /* ── Current trade metrics ──────────────────────────── */
  const currentMetrics = TRADE_METRICS[trade] || [];

  /* ── Render helpers ─────────────────────────────────── */
  const hasReportToday = notes.some((n) => n.date === todayStr());

  const inputClass = 'w-full text-[13px] font-medium text-[#1a1a1a] border border-[#e5e5e5] rounded-lg px-3 py-2 bg-[#fafafa] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20 focus:border-[#007aff]/30 focus:bg-white transition-all';
  const sectionHeader = (icon: React.ReactNode, label: string, color?: string) => (
    <p className="text-[10px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5"
      style={{ color: color || '#aeaeb2' }}>
      {icon} {label}
    </p>
  );

  /* ── Loading state ──────────────────────────────────── */
  if (isLoading) {
    return (
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="mb-6 rounded-2xl ring-1 ring-[#e8e8e8] bg-white p-5">
        <div className="flex items-center gap-2">
          <span className="text-[15px]">{'\uD83D\uDCCB'}</span>
          <span className="text-[13px] text-[#999]">Loading reports...</span>
        </div>
      </motion.div>
    );
  }

  /* ── Main render ────────────────────────────────────── */
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}
      className="mb-6 rounded-2xl ring-1 ring-[#e8e8e8] bg-white overflow-hidden">

      {/* ── Header ──────────────────────────────────────── */}
      <div className="px-5 py-3 border-b border-[#f0f0f0] flex items-center justify-between">
        <button onClick={() => setExpandedLog(!expandedLog)}
          className="flex items-center gap-2 hover:opacity-70 transition-opacity">
          <span className="text-[15px]">{'\uD83D\uDCCB'}</span>
          <h3 className="text-[13px] font-semibold text-[#1a1a1a]">Daily Report</h3>
          <span className="text-[11px] text-[#999]">{formatHeaderDate()}</span>
          {notes.length > 0 && (
            <span className="text-[10px] bg-[#f0f0f0] text-[#666] px-1.5 py-0.5 rounded-full font-medium">
              {notes.length}
            </span>
          )}
          <svg className={`w-3 h-3 text-[#999] transition-transform ${expandedLog ? 'rotate-0' : '-rotate-90'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {!showNewReport && expandedLog && (
          <button onClick={() => { setShowNewReport(true); setTimeout(() => issuesRef.current?.focus(), 100); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a1a1a] hover:bg-[#333] text-white text-[11px] font-semibold transition-colors">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Report
          </button>
        )}
      </div>

      <AnimatePresence>
        {expandedLog && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>

            {/* ── New/Edit report form ───────────────────── */}
            <AnimatePresence>
              {showNewReport && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }} className="border-b border-[#f0f0f0]">
                  <div className="px-5 py-4 space-y-4">

                    {/* Row 1: Date + Weather */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-[#999] font-medium">Date:</label>
                        <input type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)}
                          max={todayStr()}
                          className="text-[12px] text-[#1a1a1a] border border-[#e5e5e5] rounded-lg px-2 py-1 bg-[#fafafa] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20" />
                      </div>
                      {editingNoteId && (
                        <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
                          Editing
                        </span>
                      )}
                      {weatherTemp != null && (
                        <span className="text-[11px] text-[#666] font-medium">{weatherTemp}°F</span>
                      )}
                      <div className="flex-1" />
                      <div className="flex items-center gap-1">
                        {WEATHER_OPTIONS.map((w) => (
                          <button key={w.label} onClick={() => { setWeather(weather === w.emoji ? null : w.emoji); if (weather === w.emoji) setWeatherTemp(null); }}
                            title={w.label}
                            className={`w-[28px] h-[28px] rounded-lg flex items-center justify-center text-[13px] transition-all ${
                              weather === w.emoji ? 'bg-[#007aff]/10 ring-1 ring-[#007aff]/30 scale-110' : 'hover:bg-[#f0f0f0]'
                            }`}>
                            {w.emoji}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Trade Selector — hidden when project has a trade set */}
                    {!projectTrade && (
                      <div>
                        {sectionHeader(Icons.chart, 'Trade')}
                        <div className="flex items-center gap-2 flex-wrap">
                          {TRADES.map((t) => {
                            const colors = TRADE_COLORS[t];
                            const selected = trade === t;
                            return (
                              <button key={t} onClick={() => handleTradeChange(t)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                                  selected
                                    ? 'text-white shadow-sm'
                                    : 'hover:opacity-80'
                                }`}
                                style={{
                                  backgroundColor: selected ? colors.text : colors.bg,
                                  color: selected ? '#fff' : colors.text,
                                }}>
                                {TRADE_ICON[t]}
                                {t}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Production Metrics (dynamic per trade) */}
                    {(currentMetrics.length > 0 || customItems.length > 0) && (
                      <div>
                        {sectionHeader(Icons.chart, 'Production')}
                        {currentMetrics.length > 0 && (
                          <div className={`grid gap-2 ${currentMetrics.length <= 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
                            {currentMetrics.map((m) => (
                              <div key={m.key}>
                                <label className="text-[10px] text-[#999] mb-1 block">
                                  {m.label}{m.unit ? ` (${m.unit})` : ''}
                                </label>
                                <input type="number" value={metrics[m.key] || ''}
                                  onChange={(e) => setMetrics({ ...metrics, [m.key]: e.target.value })}
                                  placeholder="0" min={0}
                                  className={inputClass} />
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Custom items */}
                        {customItems.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-2 mt-2">
                            <input type="text" value={item.label}
                              onChange={(e) => updateCustomItem(idx, 'label', e.target.value)}
                              placeholder="Item name"
                              className="flex-1 text-[12px] text-[#1a1a1a] border border-[#e5e5e5] rounded-lg px-3 py-1.5 bg-[#fafafa] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20" />
                            <input type="text" value={item.value}
                              onChange={(e) => updateCustomItem(idx, 'value', e.target.value)}
                              placeholder="Qty"
                              className="w-[80px] text-[12px] font-medium text-[#1a1a1a] border border-[#e5e5e5] rounded-lg px-3 py-1.5 bg-[#fafafa] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20" />
                            <button onClick={() => removeCustomItem(idx)}
                              className="p-1 rounded text-[#ccc] hover:text-red-400 transition-colors">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                              </svg>
                            </button>
                          </div>
                        ))}
                        <button onClick={addCustomItem}
                          className="mt-2 text-[11px] text-[#007aff] hover:text-[#0066d6] font-medium flex items-center gap-1">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                          </svg>
                          Add item
                        </button>
                      </div>
                    )}

                    {/* Always show Add Item even when General trade (no metrics) */}
                    {currentMetrics.length === 0 && trade === 'General' && (
                      <div>
                        {sectionHeader(Icons.chart, 'Production')}
                        {customItems.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-2 mt-2 first:mt-0">
                            <input type="text" value={item.label}
                              onChange={(e) => updateCustomItem(idx, 'label', e.target.value)}
                              placeholder="Item name"
                              className="flex-1 text-[12px] text-[#1a1a1a] border border-[#e5e5e5] rounded-lg px-3 py-1.5 bg-[#fafafa] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20" />
                            <input type="text" value={item.value}
                              onChange={(e) => updateCustomItem(idx, 'value', e.target.value)}
                              placeholder="Qty"
                              className="w-[80px] text-[12px] font-medium text-[#1a1a1a] border border-[#e5e5e5] rounded-lg px-3 py-1.5 bg-[#fafafa] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20" />
                            <button onClick={() => removeCustomItem(idx)}
                              className="p-1 rounded text-[#ccc] hover:text-red-400 transition-colors">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                              </svg>
                            </button>
                          </div>
                        ))}
                        <button onClick={addCustomItem}
                          className="mt-2 text-[11px] text-[#007aff] hover:text-[#0066d6] font-medium flex items-center gap-1">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                          </svg>
                          Add item
                        </button>
                      </div>
                    )}

                    {/* Issues & Risks */}
                    <div>
                      {sectionHeader(Icons.warning, 'Issues & Risks', '#ff3b30')}
                      <div className="relative">
                        <textarea ref={issuesRef} value={issuesText}
                          onChange={(e) => { setIssuesText(e.target.value); if (!isListening) finalTranscriptRef.current = e.target.value; }}
                          placeholder="Delays, blockers, safety concerns, damage..."
                          rows={2}
                          className={`w-full resize-none rounded-xl border px-4 py-3 pr-14 text-[13px] text-[#1a1a1a] placeholder-[#b4b4b4] focus:outline-none focus:ring-2 transition-all ${
                            isListening
                              ? 'border-[#ff3b30]/30 bg-[#fff8f8] ring-2 ring-[#ff3b30]/10'
                              : 'border-[#ffcccc] bg-[#fffbfb] focus:ring-[#ff3b30]/10 focus:border-[#ff3b30]/30'
                          }`} />

                        {/* Mic button */}
                        {speechSupported && (
                          <button onClick={toggleListening}
                            className={`absolute right-3 top-3 w-[32px] h-[32px] rounded-full flex items-center justify-center transition-all ${
                              isListening
                                ? 'bg-[#ff3b30] text-white shadow-lg shadow-[#ff3b30]/25'
                                : 'bg-[#f0f0f0] hover:bg-[#e5e5e5] text-[#6b6b6b] hover:text-[#1a1a1a]'
                            }`}>
                            {isListening ? (
                              <>
                                <motion.span className="absolute inset-0 rounded-full bg-[#ff3b30]"
                                  animate={{ scale: [1, 1.4], opacity: [0.4, 0] }}
                                  transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }} />
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="relative z-10">
                                  <rect x="6" y="6" width="12" height="12" rx="2" />
                                </svg>
                              </>
                            ) : (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                                <path d="M19 10v2a7 7 0 01-14 0v-2" />
                                <line x1="12" y1="19" x2="12" y2="23" />
                                <line x1="8" y1="23" x2="16" y2="23" />
                              </svg>
                            )}
                          </button>
                        )}

                        {/* Listening indicator */}
                        <AnimatePresence>
                          {isListening && (
                            <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.8 }}
                              className="absolute left-3 bottom-3 flex items-center gap-1.5 pointer-events-none">
                              <motion.div className="w-[6px] h-[6px] rounded-full bg-[#ff3b30]"
                                animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }} />
                              <span className="text-[10px] text-[#ff3b30] font-semibold tracking-wider uppercase">
                                Listening...
                              </span>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>

                    {/* Safety */}
                    <div>
                      {sectionHeader(Icons.shield, 'Safety')}
                      <div className="flex items-center gap-3">
                        <button onClick={() => setSafetyIncident(!safetyIncident)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                            safetyIncident
                              ? 'bg-red-50 text-red-600 ring-1 ring-red-200'
                              : 'bg-[#f0fdf4] text-[#16a34a] ring-1 ring-[#bbf7d0]'
                          }`}>
                          {safetyIncident ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                            </svg>
                          )}
                          {safetyIncident ? 'Incident reported' : 'No incidents'}
                        </button>
                        {safetyIncident && (
                          <input type="text" value={safetyNotes}
                            onChange={(e) => setSafetyNotes(e.target.value)}
                            placeholder="Describe the incident..."
                            className="flex-1 text-[12px] text-[#1a1a1a] border border-red-200 rounded-lg px-3 py-1.5 bg-red-50/50 focus:outline-none focus:ring-1 focus:ring-red-300 placeholder-red-300" />
                        )}
                      </div>
                    </div>

                    {/* RFIs / Change Orders + Deliveries (compact row) */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        {sectionHeader(Icons.document, 'RFIs / Changes')}
                        <input type="text" value={rfis}
                          onChange={(e) => setRfis(e.target.value)}
                          placeholder="RFI #42, PCO for extra valve..."
                          className="w-full text-[12px] text-[#1a1a1a] border border-[#e5e5e5] rounded-lg px-3 py-1.5 bg-[#fafafa] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20 placeholder-[#b4b4b4]" />
                      </div>
                      <div>
                        {sectionHeader(Icons.truck, 'Deliveries / Inspections')}
                        <input type="text" value={deliveries}
                          onChange={(e) => setDeliveries(e.target.value)}
                          placeholder="Pipe delivery, rough-in passed..."
                          className="w-full text-[12px] text-[#1a1a1a] border border-[#e5e5e5] rounded-lg px-3 py-1.5 bg-[#fafafa] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20 placeholder-[#b4b4b4]" />
                      </div>
                    </div>

                    {/* General Notes (optional) */}
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#aeaeb2] mb-2 flex items-center gap-1.5">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        Notes (optional)
                      </p>
                      <textarea value={generalNotes}
                        onChange={(e) => setGeneralNotes(e.target.value)}
                        placeholder="Anything else to note..."
                        rows={2}
                        className="w-full resize-none rounded-xl border border-[#e5e5e5] bg-[#fafafa] px-4 py-3 text-[13px] text-[#1a1a1a] placeholder-[#b4b4b4] focus:outline-none focus:ring-2 focus:ring-[#007aff]/15 focus:border-[#007aff]/30 focus:bg-white transition-all" />
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={resetForm}
                        className="px-3 py-1.5 rounded-lg text-[12px] text-[#999] hover:text-[#666] hover:bg-[#f0f0f0] transition-colors">
                        Cancel
                      </button>
                      <motion.button whileTap={{ scale: 0.96 }} onClick={handleSave}
                        disabled={isSaving}
                        className="px-5 py-2 rounded-xl bg-[#1a1a1a] hover:bg-[#333] disabled:bg-[#e5e5e5] disabled:text-[#999] text-white text-[12px] font-semibold transition-all flex items-center gap-1.5">
                        {isSaving ? (
                          <>
                            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                            </svg>
                            Saving...
                          </>
                        ) : editingNoteId ? 'Update Report' : 'Save Report'}
                      </motion.button>
                    </div>

                    {saveError && <p className="text-[11px] text-red-500">{saveError}</p>}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Report log ─────────────────────────────── */}
            {notes.length === 0 && !showNewReport ? (
              <div className="px-5 py-8 text-center">
                <p className="text-[13px] text-[#999]">No reports yet for this project.</p>
                <button onClick={() => { setShowNewReport(true); setTimeout(() => issuesRef.current?.focus(), 100); }}
                  className="mt-2 text-[12px] text-[#007aff] hover:text-[#0066d6] font-medium">
                  Submit the first daily report
                </button>
              </div>
            ) : (
              <div className="divide-y divide-[#f0f0f0]">
                {notes.map((note) => {
                  const pd = normalizePD(note.productionData);
                  const contentParts = note.content.split('\n---\n');
                  const issues = contentParts[0];
                  const general = contentParts.slice(1).join('\n---\n');
                  const tc = TRADE_COLORS[pd?.trade || ''] || TRADE_COLORS.General;
                  const tradeMetrics = TRADE_METRICS[pd?.trade || ''] || [];

                  return (
                    <div key={note.id} className="px-5 py-3.5 hover:bg-[#fafafa] transition-colors group">
                      {/* Header */}
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold text-[#1a1a1a]">
                            {formatNoteDate(note.date)}
                          </span>
                          <span className="text-[10px] text-[#bbb]">{'\u00B7'}</span>
                          <span className="text-[11px] text-[#999]">{note.authorName}</span>
                          {note.weather && <span className="text-[12px]">{note.weather}</span>}
                          {pd?.tempF != null && (
                            <span className="text-[10px] text-[#999]">{pd.tempF}°F</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => handleEdit(note)}
                            className="px-2 py-1 rounded text-[10px] text-[#007aff] hover:bg-[#007aff]/5 font-medium transition-colors">
                            Edit
                          </button>
                          {confirmDeleteId === note.id ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => handleDelete(note.id)}
                                disabled={deletingNoteId === note.id}
                                className="px-2 py-1 rounded text-[10px] text-red-600 hover:bg-red-50 font-medium transition-colors">
                                {deletingNoteId === note.id ? '...' : 'Confirm'}
                              </button>
                              <button onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-1 rounded text-[10px] text-[#999] hover:bg-[#f0f0f0] font-medium transition-colors">
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmDeleteId(note.id)}
                              className="px-2 py-1 rounded text-[10px] text-red-400 hover:text-red-600 hover:bg-red-50 font-medium transition-colors">
                              Delete
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Trade badge + Production pills */}
                      {pd && (pd.trade || Object.keys(pd.metrics || {}).length > 0 || (pd.customItems?.length ?? 0) > 0) && (
                        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                          {pd.trade && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1"
                              style={{ color: tc.text, backgroundColor: tc.bg }}>
                              {TRADE_ICON[pd.trade]}
                              {pd.trade}
                            </span>
                          )}
                          {pd.metrics && Object.entries(pd.metrics).filter(([, v]) => v != null).map(([key, val]) => {
                            const def = tradeMetrics.find((m) => m.key === key);
                            const display = def
                              ? (def.unit ? `${val} ${def.unit} ${def.label.toLowerCase()}` : `${val} ${def.label.toLowerCase()}`)
                              : `${val} ${key}`;
                            return (
                              <span key={key} className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                                style={{ color: tc.text, backgroundColor: tc.bg }}>
                                {display}
                              </span>
                            );
                          })}
                          {pd.customItems?.map((item, i) => (
                            <span key={i} className="text-[10px] font-medium text-[#666] bg-[#f0f0f0] px-2 py-0.5 rounded-full">
                              {item.value} {item.label}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Safety indicator */}
                      {pd?.safetyIncident && (
                        <div className="flex items-center gap-1.5 mb-1.5 text-red-600">
                          <span className="text-red-500">{Icons.shield}</span>
                          <span className="text-[11px] font-semibold">Safety Incident</span>
                          {pd.safetyNotes && (
                            <span className="text-[11px] text-red-500"> — {pd.safetyNotes}</span>
                          )}
                        </div>
                      )}

                      {/* Issues */}
                      {issues && issues !== 'Production report' && (
                        <div className="mb-1.5">
                          <p className="text-[13px] text-[#37352f] leading-relaxed whitespace-pre-wrap">{issues}</p>
                        </div>
                      )}

                      {/* RFIs */}
                      {pd?.rfis && (
                        <div className="flex items-center gap-1.5 mb-1 text-amber-600">
                          <span className="text-amber-500">{Icons.document}</span>
                          <span className="text-[11px]">{pd.rfis}</span>
                        </div>
                      )}

                      {/* Deliveries */}
                      {pd?.deliveries && (
                        <div className="flex items-center gap-1.5 mb-1 text-blue-600">
                          <span className="text-blue-500">{Icons.truck}</span>
                          <span className="text-[11px]">{pd.deliveries}</span>
                        </div>
                      )}

                      {/* General notes */}
                      {general && (
                        <p className="text-[12px] text-[#999] leading-relaxed whitespace-pre-wrap mt-1">{general}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Prompt for today */}
            {!hasReportToday && notes.length > 0 && !showNewReport && (
              <div className="px-5 py-3 bg-[#fff5f5] border-t border-red-100">
                <button onClick={() => { setShowNewReport(true); setNoteDate(todayStr()); setTimeout(() => issuesRef.current?.focus(), 100); }}
                  className="text-[12px] text-red-600 hover:text-red-800 font-medium flex items-center gap-1.5">
                  {Icons.warning}
                  No report submitted today — tap to add
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
