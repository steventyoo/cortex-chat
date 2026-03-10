'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/* ── Types ────────────────────────────────────────────── */
interface Project {
  projectId: string;
  projectName: string;
}

interface ProductionData {
  hours: number | null;
  area: string;
  pipeInstalled: number | null;
  fixturesInstalled: number | null;
  unitsCompleted: number | null;
  customItems: { label: string; value: string }[];
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

interface UserInfo {
  name: string;
  email: string;
  role: string;
}

interface RosterEntry {
  id: string;
  workerName: string;
  role: string;
  hourlyRate: number | null;
}

interface StaffingRow {
  workerName: string;
  role: string;
  regularHours: number;
  otHours: number;
  hourlyRate: number;
}

interface StaffingSummary {
  totalRegHours: number;
  totalOtHours: number;
  totalLaborCost: number;
  workDays: number;
  avgDailyCost: number;
  otPercent: number;
}

const ROLES = ['Foreman', 'Journeyman', 'Apprentice', 'Laborer', 'Helper'];

/* ── Speech types ─────────────────────────────────────── */
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

/* ── Helpers ──────────────────────────────────────────── */
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function formatNoteDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const today = todayStr();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    if (dateStr === today) return 'Today';
    if (dateStr === yesterdayStr) return 'Yesterday';
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatHeaderDate(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/* ── Page Component ───────────────────────────────────── */
export default function DailyNotesPage() {
  /* Auth + user */
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  /* Projects */
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  /* Notes */
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  /* Form state */
  const [noteContent, setNoteContent] = useState('');
  const [noteDate, setNoteDate] = useState(todayStr());
  const [crewCount, setCrewCount] = useState('');
  const [weather, setWeather] = useState<string | null>(null);
  const [currentWeather, setCurrentWeather] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  /* Production */
  const [hours, setHours] = useState('');
  const [area, setArea] = useState('');
  const [pipeInstalled, setPipeInstalled] = useState('');
  const [fixturesInstalled, setFixturesInstalled] = useState('');
  const [unitsCompleted, setUnitsCompleted] = useState('');
  const [customItems, setCustomItems] = useState<{ label: string; value: string }[]>([]);

  /* Staffing */
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [staffingRows, setStaffingRows] = useState<StaffingRow[]>([]);
  const [staffingSummary, setStaffingSummary] = useState<StaffingSummary | null>(null);
  const [staffingSaving, setStaffingSaving] = useState(false);
  const [staffingSaved, setStaffingSaved] = useState(false);
  const [showRosterForm, setShowRosterForm] = useState(false);
  const [newWorkerName, setNewWorkerName] = useState('');
  const [newWorkerRole, setNewWorkerRole] = useState('Journeyman');
  const [newWorkerRate, setNewWorkerRate] = useState('');

  /* Speech */
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalTranscriptRef = useRef('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* ── Init: check auth ───────────────────────────────── */
  useEffect(() => {
    setSpeechSupported(!!getSpeechRecognition());
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
          window.location.href = '/login';
          return;
        }
        const data = await res.json();
        setUser(data);
      } catch {
        window.location.href = '/login';
      } finally {
        setAuthLoading(false);
      }
    })();
    return () => {
      if (recognitionRef.current) recognitionRef.current.abort();
    };
  }, []);

  /* ── Fetch projects ─────────────────────────────────── */
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await fetch('/api/projects');
        if (res.ok) {
          const data = await res.json();
          const list: Project[] = (data.projects || data || []).map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (p: any) => ({ projectId: p.projectId || p.project_id, projectName: p.projectName || p.project_name })
          );
          setProjects(list);
          if (list.length === 1) setSelectedProjectId(list[0].projectId);
        }
      } catch { /* ignore */ }
    })();
  }, [user]);

  /* ── Fetch notes when project changes ───────────────── */
  const fetchNotes = useCallback(async () => {
    if (!selectedProjectId) return;
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/daily-note?projectId=${encodeURIComponent(selectedProjectId)}&mode=log&includeWeather=true`
      );
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes || []);
        if (data.currentWeather) setCurrentWeather(data.currentWeather);
      }
    } catch { /* ignore */ }
    finally { setIsLoading(false); }
  }, [selectedProjectId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  /* ── Fetch roster + staffing when project/date changes ── */
  const fetchRosterAndStaffing = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      const [rosterRes, staffingRes, summaryRes] = await Promise.all([
        fetch(`/api/staffing/roster?projectId=${encodeURIComponent(selectedProjectId)}`),
        fetch(`/api/staffing?projectId=${encodeURIComponent(selectedProjectId)}&date=${noteDate}`),
        fetch(`/api/staffing?projectId=${encodeURIComponent(selectedProjectId)}&summary=true`),
      ]);

      if (rosterRes.ok) {
        const data = await rosterRes.json();
        setRoster(data.roster || []);
      }

      let existingEntries: StaffingRow[] = [];
      if (staffingRes.ok) {
        const data = await staffingRes.json();
        existingEntries = (data.entries || []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (e: any) => ({
            workerName: e.workerName,
            role: e.role,
            regularHours: e.regularHours,
            otHours: e.otHours,
            hourlyRate: e.hourlyRate,
          })
        );
      }

      if (summaryRes.ok) {
        const data = await summaryRes.json();
        if (data.summary) setStaffingSummary(data.summary);
      }

      // If entries exist for this date, use them; otherwise pre-populate from roster
      if (existingEntries.length > 0) {
        setStaffingRows(existingEntries);
      } else if (rosterRes.ok) {
        const data = await rosterRes.json();
        const rosterList: RosterEntry[] = data.roster || [];
        setStaffingRows(
          rosterList.map(r => ({
            workerName: r.workerName,
            role: r.role,
            regularHours: 0,
            otHours: 0,
            hourlyRate: r.hourlyRate || 0,
          }))
        );
      }
    } catch { /* ignore */ }
  }, [selectedProjectId, noteDate]);

  useEffect(() => {
    fetchRosterAndStaffing();
  }, [fetchRosterAndStaffing]);

  /* Auto-resize textarea */
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 300)}px`;
    }
  }, [noteContent]);

  /* ── Speech recognition ─────────────────────────────── */
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
        if (event.results[i].isFinal) sessionFinal += transcript;
        else interim += transcript;
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
    recognition.onend = () => { setIsListening(false); recognitionRef.current = null; };
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    textareaRef.current?.focus();
  }, [noteContent, stopListening]);

  const toggleListening = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  /* ── Save note ──────────────────────────────────────── */
  const handleSave = async () => {
    if (!noteContent.trim() || !selectedProjectId || isSaving) return;
    if (isListening) stopListening();
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    // Build production data (only include if any field is filled)
    const prodData: ProductionData = {
      hours: hours ? parseFloat(hours) : null,
      area: area.trim(),
      pipeInstalled: pipeInstalled ? parseFloat(pipeInstalled) : null,
      fixturesInstalled: fixturesInstalled ? parseInt(fixturesInstalled, 10) : null,
      unitsCompleted: unitsCompleted ? parseInt(unitsCompleted, 10) : null,
      customItems: customItems.filter(i => i.label.trim() && i.value.trim()),
    };
    const hasProduction = prodData.hours || prodData.area || prodData.pipeInstalled ||
      prodData.fixturesInstalled || prodData.unitsCompleted || prodData.customItems.length > 0;

    try {
      const res = await fetch('/api/daily-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId,
          date: noteDate,
          content: noteContent.trim(),
          crewCount: crewCount ? parseInt(crewCount, 10) : null,
          weather: weather || currentWeather || null,
          productionData: hasProduction ? prodData : null,
          noteId: editingNoteId || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) { setSaveError(data.error || 'Failed to save'); return; }

      await fetchNotes();
      setNoteContent('');
      setNoteDate(todayStr());
      setCrewCount('');
      setWeather(null);
      setHours('');
      setArea('');
      setPipeInstalled('');
      setFixturesInstalled('');
      setUnitsCompleted('');
      setCustomItems([]);
      setEditingNoteId(null);
      finalTranscriptRef.current = '';
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      setSaveError('Network error — try again');
    } finally {
      setIsSaving(false);
    }
  };

  /* ── Edit note ──────────────────────────────────────── */
  const handleEdit = (note: NoteEntry) => {
    setEditingNoteId(note.id);
    setNoteContent(note.content);
    setNoteDate(note.date);
    setCrewCount(note.crewCount != null ? String(note.crewCount) : '');
    setWeather(note.weather);
    // Restore production data
    const pd = note.productionData;
    setHours(pd?.hours != null ? String(pd.hours) : '');
    setArea(pd?.area || '');
    setPipeInstalled(pd?.pipeInstalled != null ? String(pd.pipeInstalled) : '');
    setFixturesInstalled(pd?.fixturesInstalled != null ? String(pd.fixturesInstalled) : '');
    setUnitsCompleted(pd?.unitsCompleted != null ? String(pd.unitsCompleted) : '');
    setCustomItems(pd?.customItems || []);
    finalTranscriptRef.current = note.content;
    setSaveSuccess(false);
    setTimeout(() => textareaRef.current?.focus(), 100);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    } catch { /* ignore */ }
    finally { setDeletingNoteId(null); setConfirmDeleteId(null); }
  };

  /* ── Cancel editing ─────────────────────────────────── */
  const handleCancel = () => {
    setEditingNoteId(null);
    setNoteContent('');
    setNoteDate(todayStr());
    setCrewCount('');
    setWeather(null);
    setHours('');
    setArea('');
    setPipeInstalled('');
    setFixturesInstalled('');
    setUnitsCompleted('');
    setCustomItems([]);
    setSaveError(null);
    finalTranscriptRef.current = '';
    if (isListening) stopListening();
  };

  /* ── Staffing: save hours ─────────────────────────────── */
  const handleSaveStaffing = async () => {
    if (!selectedProjectId || staffingSaving) return;
    setStaffingSaving(true);
    setStaffingSaved(false);
    try {
      const res = await fetch('/api/staffing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId,
          date: noteDate,
          entries: staffingRows,
        }),
      });
      if (res.ok) {
        setStaffingSaved(true);
        setTimeout(() => setStaffingSaved(false), 3000);
        // Refresh summary
        const summaryRes = await fetch(`/api/staffing?projectId=${encodeURIComponent(selectedProjectId)}&summary=true`);
        if (summaryRes.ok) {
          const data = await summaryRes.json();
          if (data.summary) setStaffingSummary(data.summary);
        }
      }
    } catch { /* ignore */ }
    finally { setStaffingSaving(false); }
  };

  /* ── Staffing: add worker to roster ─────────────────── */
  const handleAddToRoster = async () => {
    if (!selectedProjectId || !newWorkerName.trim()) return;
    try {
      const res = await fetch('/api/staffing/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId,
          workerName: newWorkerName.trim(),
          role: newWorkerRole,
          hourlyRate: newWorkerRate ? parseFloat(newWorkerRate) : null,
        }),
      });
      if (res.ok) {
        // Add to local state
        setStaffingRows(prev => [...prev, {
          workerName: newWorkerName.trim(),
          role: newWorkerRole,
          regularHours: 0,
          otHours: 0,
          hourlyRate: newWorkerRate ? parseFloat(newWorkerRate) : 0,
        }]);
        setNewWorkerName('');
        setNewWorkerRate('');
        setShowRosterForm(false);
        // Refresh roster
        const rosterRes = await fetch(`/api/staffing/roster?projectId=${encodeURIComponent(selectedProjectId)}`);
        if (rosterRes.ok) {
          const data = await rosterRes.json();
          setRoster(data.roster || []);
        }
      }
    } catch { /* ignore */ }
  };

  /* ── Staffing: remove from roster ───────────────────── */
  const handleRemoveFromRoster = async (workerName: string) => {
    const rosterEntry = roster.find(r => r.workerName === workerName);
    if (!rosterEntry) return;
    try {
      await fetch('/api/staffing/roster', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterId: rosterEntry.id }),
      });
      setStaffingRows(prev => prev.filter(r => r.workerName !== workerName));
      setRoster(prev => prev.filter(r => r.id !== rosterEntry.id));
    } catch { /* ignore */ }
  };

  /* ── Staffing: compute daily cost ───────────────────── */
  const dailyLaborCost = staffingRows.reduce((sum, r) => {
    return sum + (r.regularHours * r.hourlyRate) + (r.otHours * r.hourlyRate * 1.5);
  }, 0);
  const dailyTotalHours = staffingRows.reduce((sum, r) => sum + r.regularHours + r.otHours, 0);
  const dailyOtHours = staffingRows.reduce((sum, r) => sum + r.otHours, 0);

  /* ── Standing prompts ───────────────────────────────── */
  const PROMPTS = [
    { label: 'Work completed', prefix: 'Work completed today: ' },
    { label: 'Delays / issues', prefix: 'Delays or issues: ' },
    { label: 'Safety observations', prefix: 'Safety observations: ' },
    { label: 'Plan for tomorrow', prefix: 'Plan for tomorrow: ' },
  ];

  /* ── Loading state ──────────────────────────────────── */
  if (authLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[#f7f7f5]">
        <div className="flex items-center gap-3">
          <svg className="animate-spin w-5 h-5 text-[#999]" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span className="text-[14px] text-[#999]">Loading...</span>
        </div>
      </div>
    );
  }

  const selectedProject = projects.find(p => p.projectId === selectedProjectId);
  const hasNotesToday = notes.some(n => n.date === todayStr());

  /* ── Render ─────────────────────────────────────────── */
  return (
    <div className="min-h-dvh bg-[#f7f7f5]">
      {/* ── Top bar ─────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-[#e8e8e8]">
        <div className="max-w-2xl mx-auto px-4 h-[56px] flex items-center gap-3">
          <a
            href="/"
            className="p-1.5 rounded-lg hover:bg-[#f0f0f0] text-[#999] hover:text-[#1a1a1a] transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </a>
          <div className="flex-1">
            <h1 className="text-[15px] font-semibold text-[#1a1a1a]">Daily Notes</h1>
            <p className="text-[11px] text-[#999]">{formatHeaderDate()}</p>
          </div>
          {user && (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-[#1a1a1a] flex items-center justify-center">
                <span className="text-[11px] font-medium text-white">
                  {(user.name || user.email).charAt(0).toUpperCase()}
                </span>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 pb-20">
        {/* ── Project selector ──────────────────────────── */}
        {projects.length > 1 && (
          <div className="mb-4">
            <label className="block text-[11px] font-medium uppercase tracking-wider text-[#aeaeb2] mb-1.5">
              Project
            </label>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-[#e5e5e5] bg-white text-[14px] text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#007aff]/15 focus:border-[#007aff]/30 appearance-none"
            >
              <option value="">Select a project...</option>
              {projects.map(p => (
                <option key={p.projectId} value={p.projectId}>{p.projectName}</option>
              ))}
            </select>
          </div>
        )}

        {projects.length === 1 && (
          <div className="mb-4 flex items-center gap-2">
            <span className="inline-block w-[8px] h-[8px] rounded-full bg-[#34c759] flex-shrink-0" />
            <span className="text-[14px] font-medium text-[#1a1a1a]">{projects[0].projectName}</span>
          </div>
        )}

        {/* ── Weather display ───────────────────────────── */}
        {currentWeather && selectedProjectId && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-white border border-[#e8e8e8] flex items-center gap-2">
            <span className="text-[14px]">{currentWeather}</span>
            <span className="text-[11px] text-[#999] ml-auto">Auto-detected</span>
          </div>
        )}

        {/* ── Note form ─────────────────────────────────── */}
        {selectedProjectId && (
          <div className="mb-6 rounded-2xl bg-white border border-[#e8e8e8] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#f0f0f0] flex items-center gap-2">
              <span className="text-[14px]">{editingNoteId ? '\u270F\uFE0F' : '\u270D\uFE0F'}</span>
              <span className="text-[13px] font-semibold text-[#1a1a1a]">
                {editingNoteId ? 'Edit Note' : 'New Note'}
              </span>
              {editingNoteId && (
                <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium ml-auto">
                  Editing
                </span>
              )}
            </div>

            <div className="p-4 space-y-3">
              {/* Date + Crew count row */}
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <label className="text-[11px] text-[#999] font-medium">Date:</label>
                  <input
                    type="date"
                    value={noteDate}
                    onChange={(e) => setNoteDate(e.target.value)}
                    max={todayStr()}
                    className="text-[13px] text-[#1a1a1a] border border-[#e5e5e5] rounded-lg px-2.5 py-1.5 bg-[#fafafa] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-[11px] text-[#999] font-medium">Crew:</label>
                  <input
                    type="number"
                    value={crewCount}
                    onChange={(e) => setCrewCount(e.target.value)}
                    placeholder="0"
                    min={0}
                    max={200}
                    className="w-[56px] text-center text-[13px] font-medium text-[#1a1a1a] border border-[#e5e5e5] rounded-lg py-1.5 bg-[#fafafa] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20"
                  />
                </div>
              </div>

              {/* ── Production quantities ──────────────── */}
              <div className="rounded-xl border border-[#e8e8e8] bg-[#fafafa] p-3 space-y-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-[#aeaeb2]">
                  Production
                </p>

                {/* Hours + Area row */}
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[11px] text-[#999] font-medium">Hours:</label>
                    <input
                      type="number"
                      value={hours}
                      onChange={(e) => setHours(e.target.value)}
                      placeholder="0"
                      min={0}
                      step={0.5}
                      className="w-[64px] text-center text-[13px] font-medium text-[#1a1a1a] border border-[#e5e5e5] rounded-lg py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-[#007aff]/20"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 flex-1 min-w-[140px]">
                    <label className="text-[11px] text-[#999] font-medium whitespace-nowrap">Area:</label>
                    <input
                      type="text"
                      value={area}
                      onChange={(e) => setArea(e.target.value)}
                      placeholder="e.g. Building B - Level 3"
                      className="flex-1 text-[13px] text-[#1a1a1a] border border-[#e5e5e5] rounded-lg px-2.5 py-1.5 bg-white placeholder-[#c0c0c0] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20"
                    />
                  </div>
                </div>

                {/* Quantity inputs */}
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[11px] text-[#999] font-medium whitespace-nowrap">Pipe (ft):</label>
                    <input
                      type="number"
                      value={pipeInstalled}
                      onChange={(e) => setPipeInstalled(e.target.value)}
                      placeholder="0"
                      min={0}
                      className="w-[72px] text-center text-[13px] font-medium text-[#1a1a1a] border border-[#e5e5e5] rounded-lg py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-[#007aff]/20"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-[11px] text-[#999] font-medium whitespace-nowrap">Fixtures:</label>
                    <input
                      type="number"
                      value={fixturesInstalled}
                      onChange={(e) => setFixturesInstalled(e.target.value)}
                      placeholder="0"
                      min={0}
                      className="w-[64px] text-center text-[13px] font-medium text-[#1a1a1a] border border-[#e5e5e5] rounded-lg py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-[#007aff]/20"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-[11px] text-[#999] font-medium whitespace-nowrap">Units:</label>
                    <input
                      type="number"
                      value={unitsCompleted}
                      onChange={(e) => setUnitsCompleted(e.target.value)}
                      placeholder="0"
                      min={0}
                      className="w-[64px] text-center text-[13px] font-medium text-[#1a1a1a] border border-[#e5e5e5] rounded-lg py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-[#007aff]/20"
                    />
                  </div>
                </div>

                {/* Custom production items */}
                {customItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={item.label}
                      onChange={(e) => {
                        const updated = [...customItems];
                        updated[i] = { ...updated[i], label: e.target.value };
                        setCustomItems(updated);
                      }}
                      placeholder="Item name"
                      className="flex-1 text-[13px] text-[#1a1a1a] border border-[#e5e5e5] rounded-lg px-2.5 py-1.5 bg-white placeholder-[#c0c0c0] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20"
                    />
                    <input
                      type="text"
                      value={item.value}
                      onChange={(e) => {
                        const updated = [...customItems];
                        updated[i] = { ...updated[i], value: e.target.value };
                        setCustomItems(updated);
                      }}
                      placeholder="Qty"
                      className="w-[80px] text-center text-[13px] text-[#1a1a1a] border border-[#e5e5e5] rounded-lg py-1.5 bg-white placeholder-[#c0c0c0] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20"
                    />
                    <button
                      onClick={() => setCustomItems(customItems.filter((_, j) => j !== i))}
                      className="p-1 rounded-md hover:bg-[#f0f0f0] text-[#999] hover:text-[#666]"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                ))}

                <button
                  onClick={() => setCustomItems([...customItems, { label: '', value: '' }])}
                  className="text-[11px] text-[#007aff] hover:text-[#0066d6] font-medium flex items-center gap-1"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                  </svg>
                  Add custom item
                </button>
              </div>

              {/* Quick prompts */}
              {!editingNoteId && (
                <div className="flex flex-wrap gap-1.5">
                  {PROMPTS.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        const prefix = noteContent.trim() ? noteContent.trim() + '\n\n' : '';
                        setNoteContent(prefix + p.prefix);
                        finalTranscriptRef.current = prefix + p.prefix;
                        textareaRef.current?.focus();
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-[#f7f7f5] hover:bg-[#ebebea] text-[11px] text-[#6b6b6b] transition-colors"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Textarea + mic */}
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={noteContent}
                  onChange={(e) => {
                    setNoteContent(e.target.value);
                    if (!isListening) finalTranscriptRef.current = e.target.value;
                  }}
                  placeholder="What happened on site today? Tap mic to dictate..."
                  rows={5}
                  className={`w-full resize-none rounded-xl border px-4 py-3 pr-14 text-[14px] text-[#1a1a1a] placeholder-[#b4b4b4] focus:outline-none focus:ring-2 transition-all ${
                    isListening
                      ? 'border-[#ff3b30]/30 bg-[#fff8f8] ring-2 ring-[#ff3b30]/10'
                      : 'border-[#e5e5e5] bg-[#fafafa] focus:ring-[#007aff]/15 focus:border-[#007aff]/30 focus:bg-white'
                  }`}
                />

                {speechSupported && (
                  <button
                    onClick={toggleListening}
                    className={`absolute right-3 top-3 w-[40px] h-[40px] rounded-full flex items-center justify-center transition-all ${
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
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="relative z-10">
                          <rect x="6" y="6" width="12" height="12" rx="2" />
                        </svg>
                      </>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                        <path d="M19 10v2a7 7 0 01-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                    )}
                  </button>
                )}

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

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                {editingNoteId && (
                  <button
                    onClick={handleCancel}
                    className="px-4 py-2.5 rounded-xl text-[13px] text-[#999] hover:text-[#666] hover:bg-[#f0f0f0] transition-colors font-medium"
                  >
                    Cancel
                  </button>
                )}
                <div className="flex-1" />
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={handleSave}
                  disabled={!noteContent.trim() || isSaving}
                  className="px-6 py-2.5 rounded-xl bg-[#1a1a1a] hover:bg-[#333] disabled:bg-[#e5e5e5] disabled:text-[#999] text-white text-[13px] font-semibold transition-all flex items-center gap-2"
                >
                  {isSaving ? (
                    <>
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Saving...
                    </>
                  ) : editingNoteId ? 'Update Note' : 'Save Note'}
                </motion.button>
              </div>

              {/* Error / success messages */}
              {saveError && <p className="text-[12px] text-red-500">{saveError}</p>}
              <AnimatePresence>
                {saveSuccess && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-[12px] text-green-600 font-medium flex items-center gap-1"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Note saved successfully
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* ── Staffing section ────────────────────────── */}
        {selectedProjectId && (
          <div className="mb-6 rounded-2xl bg-white border border-[#e8e8e8] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#f0f0f0] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[14px]">&#128119;</span>
                <span className="text-[13px] font-semibold text-[#1a1a1a]">Staffing & Hours</span>
                <span className="text-[11px] text-[#999]">{noteDate === todayStr() ? 'Today' : noteDate}</span>
              </div>
              <div className="flex items-center gap-2">
                {dailyLaborCost > 0 && (
                  <span className="text-[12px] font-semibold text-[#1a1a1a]">
                    ${dailyLaborCost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </span>
                )}
              </div>
            </div>

            <div className="p-4">
              {/* Summary banner */}
              {staffingSummary && staffingSummary.workDays > 0 && (
                <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="px-3 py-2 rounded-lg bg-[#f7f7f5]">
                    <p className="text-[10px] text-[#999] uppercase tracking-wider">Total Labor</p>
                    <p className="text-[14px] font-semibold text-[#1a1a1a]">
                      ${staffingSummary.totalLaborCost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <div className="px-3 py-2 rounded-lg bg-[#f7f7f5]">
                    <p className="text-[10px] text-[#999] uppercase tracking-wider">Avg/Day</p>
                    <p className="text-[14px] font-semibold text-[#1a1a1a]">
                      ${staffingSummary.avgDailyCost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <div className="px-3 py-2 rounded-lg bg-[#f7f7f5]">
                    <p className="text-[10px] text-[#999] uppercase tracking-wider">OT %</p>
                    <p className={`text-[14px] font-semibold ${staffingSummary.otPercent > 20 ? 'text-red-600' : 'text-[#1a1a1a]'}`}>
                      {staffingSummary.otPercent}%
                    </p>
                  </div>
                  <div className="px-3 py-2 rounded-lg bg-[#f7f7f5]">
                    <p className="text-[10px] text-[#999] uppercase tracking-wider">Work Days</p>
                    <p className="text-[14px] font-semibold text-[#1a1a1a]">{staffingSummary.workDays}</p>
                  </div>
                </div>
              )}

              {/* Staffing table */}
              {staffingRows.length > 0 ? (
                <div className="overflow-x-auto -mx-4 px-4">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-[#aeaeb2]">
                        <th className="text-left py-2 pr-2 font-medium">Name</th>
                        <th className="text-left py-2 pr-2 font-medium w-[90px]">Role</th>
                        <th className="text-center py-2 pr-2 font-medium w-[56px]">Reg</th>
                        <th className="text-center py-2 pr-2 font-medium w-[56px]">OT</th>
                        <th className="text-center py-2 pr-2 font-medium w-[64px]">Rate</th>
                        <th className="text-right py-2 font-medium w-[64px]">Cost</th>
                        <th className="w-[28px]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffingRows.map((row, i) => {
                        const rowCost = (row.regularHours * row.hourlyRate) + (row.otHours * row.hourlyRate * 1.5);
                        return (
                          <tr key={i} className="border-t border-[#f0f0f0]">
                            <td className="py-1.5 pr-2">
                              <span className="text-[13px] font-medium text-[#1a1a1a]">{row.workerName}</span>
                            </td>
                            <td className="py-1.5 pr-2">
                              <select
                                value={row.role}
                                onChange={(e) => {
                                  const updated = [...staffingRows];
                                  updated[i] = { ...updated[i], role: e.target.value };
                                  setStaffingRows(updated);
                                }}
                                className="w-full text-[12px] text-[#666] border border-[#e5e5e5] rounded px-1 py-1 bg-white focus:outline-none"
                              >
                                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                type="number"
                                value={row.regularHours || ''}
                                onChange={(e) => {
                                  const updated = [...staffingRows];
                                  updated[i] = { ...updated[i], regularHours: parseFloat(e.target.value) || 0 };
                                  setStaffingRows(updated);
                                }}
                                placeholder="0"
                                min={0}
                                step={0.5}
                                className="w-full text-center text-[13px] border border-[#e5e5e5] rounded px-1 py-1 bg-[#fafafa] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                type="number"
                                value={row.otHours || ''}
                                onChange={(e) => {
                                  const updated = [...staffingRows];
                                  updated[i] = { ...updated[i], otHours: parseFloat(e.target.value) || 0 };
                                  setStaffingRows(updated);
                                }}
                                placeholder="0"
                                min={0}
                                step={0.5}
                                className={`w-full text-center text-[13px] border rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-[#007aff]/20 ${
                                  row.otHours > 0 ? 'border-amber-300 bg-amber-50 text-amber-800 font-medium' : 'border-[#e5e5e5] bg-[#fafafa]'
                                }`}
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                type="number"
                                value={row.hourlyRate || ''}
                                onChange={(e) => {
                                  const updated = [...staffingRows];
                                  updated[i] = { ...updated[i], hourlyRate: parseFloat(e.target.value) || 0 };
                                  setStaffingRows(updated);
                                }}
                                placeholder="0"
                                min={0}
                                step={0.5}
                                className="w-full text-center text-[13px] border border-[#e5e5e5] rounded px-1 py-1 bg-[#fafafa] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20"
                              />
                            </td>
                            <td className="py-1.5 text-right">
                              <span className={`text-[12px] font-medium ${rowCost > 0 ? 'text-[#1a1a1a]' : 'text-[#ccc]'}`}>
                                ${rowCost.toFixed(0)}
                              </span>
                            </td>
                            <td className="py-1.5 text-center">
                              <button
                                onClick={() => handleRemoveFromRoster(row.workerName)}
                                className="p-0.5 rounded hover:bg-[#f0f0f0] text-[#ccc] hover:text-[#999]"
                                title="Remove from roster"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                                </svg>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-[#e8e8e8]">
                        <td className="py-2 text-[12px] font-semibold text-[#1a1a1a]">Total</td>
                        <td></td>
                        <td className="py-2 text-center text-[12px] font-semibold text-[#1a1a1a]">
                          {staffingRows.reduce((s, r) => s + r.regularHours, 0) || ''}
                        </td>
                        <td className={`py-2 text-center text-[12px] font-semibold ${dailyOtHours > 0 ? 'text-amber-700' : 'text-[#1a1a1a]'}`}>
                          {dailyOtHours || ''}
                        </td>
                        <td></td>
                        <td className="py-2 text-right text-[13px] font-bold text-[#1a1a1a]">
                          ${dailyLaborCost.toFixed(0)}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="text-[13px] text-[#999] text-center py-4">
                  No crew members yet. Add workers below to start tracking hours.
                </p>
              )}

              {/* Add worker form */}
              {showRosterForm ? (
                <div className="mt-3 pt-3 border-t border-[#f0f0f0] flex items-end gap-2 flex-wrap">
                  <div className="flex-1 min-w-[120px]">
                    <label className="text-[10px] text-[#999] font-medium uppercase tracking-wider">Name</label>
                    <input
                      type="text"
                      value={newWorkerName}
                      onChange={(e) => setNewWorkerName(e.target.value)}
                      placeholder="Worker name"
                      className="w-full text-[13px] border border-[#e5e5e5] rounded-lg px-2.5 py-1.5 bg-[#fafafa] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20 mt-0.5"
                      onKeyDown={(e) => e.key === 'Enter' && handleAddToRoster()}
                    />
                  </div>
                  <div className="w-[110px]">
                    <label className="text-[10px] text-[#999] font-medium uppercase tracking-wider">Role</label>
                    <select
                      value={newWorkerRole}
                      onChange={(e) => setNewWorkerRole(e.target.value)}
                      className="w-full text-[13px] border border-[#e5e5e5] rounded-lg px-2 py-1.5 bg-[#fafafa] focus:outline-none mt-0.5"
                    >
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="w-[80px]">
                    <label className="text-[10px] text-[#999] font-medium uppercase tracking-wider">$/hr</label>
                    <input
                      type="number"
                      value={newWorkerRate}
                      onChange={(e) => setNewWorkerRate(e.target.value)}
                      placeholder="0"
                      min={0}
                      step={0.5}
                      className="w-full text-center text-[13px] border border-[#e5e5e5] rounded-lg py-1.5 bg-[#fafafa] focus:outline-none focus:ring-1 focus:ring-[#007aff]/20 mt-0.5"
                    />
                  </div>
                  <button
                    onClick={handleAddToRoster}
                    disabled={!newWorkerName.trim()}
                    className="px-3 py-1.5 rounded-lg bg-[#1a1a1a] hover:bg-[#333] disabled:bg-[#e5e5e5] text-white disabled:text-[#999] text-[12px] font-semibold"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => { setShowRosterForm(false); setNewWorkerName(''); setNewWorkerRate(''); }}
                    className="px-3 py-1.5 rounded-lg text-[12px] text-[#999] hover:bg-[#f0f0f0]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowRosterForm(true)}
                  className="mt-3 text-[11px] text-[#007aff] hover:text-[#0066d6] font-medium flex items-center gap-1"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                  </svg>
                  Add crew member
                </button>
              )}

              {/* Save staffing button */}
              {staffingRows.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[#f0f0f0] flex items-center gap-2">
                  <div className="flex-1">
                    {dailyOtHours > 0 && (
                      <span className="text-[11px] text-amber-700 font-medium">
                        {dailyOtHours}h OT ({dailyTotalHours > 0 ? Math.round((dailyOtHours / dailyTotalHours) * 100) : 0}%)
                      </span>
                    )}
                  </div>
                  <AnimatePresence>
                    {staffingSaved && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="text-[11px] text-green-600 font-medium"
                      >
                        Saved
                      </motion.span>
                    )}
                  </AnimatePresence>
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={handleSaveStaffing}
                    disabled={staffingSaving}
                    className="px-4 py-2 rounded-xl bg-[#1a1a1a] hover:bg-[#333] disabled:bg-[#e5e5e5] disabled:text-[#999] text-white text-[12px] font-semibold transition-all flex items-center gap-1.5"
                  >
                    {staffingSaving ? 'Saving...' : 'Save Hours'}
                  </motion.button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Today prompt ──────────────────────────────── */}
        {selectedProjectId && !hasNotesToday && notes.length > 0 && !editingNoteId && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-[#fffbeb] border border-amber-200 flex items-center gap-2">
            <span className="text-[13px]">&#9889;</span>
            <span className="text-[13px] text-amber-800 font-medium">No note for today yet</span>
          </div>
        )}

        {/* ── Notes list ────────────────────────────────── */}
        {selectedProjectId && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-[11px] font-medium uppercase tracking-wider text-[#aeaeb2]">
                Recent Notes
              </h2>
              {notes.length > 0 && (
                <span className="text-[10px] bg-[#f0f0f0] text-[#666] px-1.5 py-0.5 rounded-full font-medium">
                  {notes.length}
                </span>
              )}
            </div>

            {isLoading ? (
              <div className="text-center py-8">
                <svg className="animate-spin w-5 h-5 text-[#999] mx-auto" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
            ) : notes.length === 0 ? (
              <div className="text-center py-8 text-[13px] text-[#999]">
                No notes yet. Add your first daily note above.
              </div>
            ) : (
              <div className="space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-xl bg-white border border-[#e8e8e8] overflow-hidden group"
                  >
                    <div className="px-4 py-3">
                      {/* Note header */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] font-semibold text-[#1a1a1a]">
                            {formatNoteDate(note.date)}
                          </span>
                          <span className="text-[10px] text-[#d0d0d0]">&middot;</span>
                          <span className="text-[11px] text-[#999]">{note.authorName}</span>
                          {note.updatedAt && (
                            <>
                              <span className="text-[10px] text-[#d0d0d0]">&middot;</span>
                              <span className="text-[10px] text-[#bbb] italic">edited</span>
                            </>
                          )}
                        </div>
                        {/* Actions */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleEdit(note)}
                            className="px-2 py-1 rounded text-[10px] text-[#007aff] hover:bg-[#007aff]/5 font-medium"
                          >
                            Edit
                          </button>
                          {confirmDeleteId === note.id ? (
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleDelete(note.id)}
                                disabled={deletingNoteId === note.id}
                                className="px-2 py-1 rounded text-[10px] text-red-600 hover:bg-red-50 font-medium"
                              >
                                {deletingNoteId === note.id ? '...' : 'Confirm'}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-1 rounded text-[10px] text-[#999] hover:bg-[#f0f0f0] font-medium"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(note.id)}
                              className="px-2 py-1 rounded text-[10px] text-red-400 hover:text-red-600 hover:bg-red-50 font-medium"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Content */}
                      <p className="text-[13px] text-[#37352f] leading-relaxed whitespace-pre-wrap">
                        {note.content}
                      </p>

                      {/* Meta */}
                      {(note.crewCount != null || note.weather) && (
                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          {note.crewCount != null && (
                            <span className="text-[11px] text-[#999]">
                              Crew: {note.crewCount}
                            </span>
                          )}
                          {note.weather && (
                            <span className="text-[11px] text-[#999]">{note.weather}</span>
                          )}
                        </div>
                      )}

                      {/* Production data */}
                      {note.productionData && (
                        <div className="mt-2 pt-2 border-t border-[#f0f0f0]">
                          <div className="flex items-center gap-3 flex-wrap">
                            {note.productionData.hours != null && (
                              <span className="text-[11px] text-[#666] bg-[#f7f7f5] px-2 py-0.5 rounded-md">
                                {note.productionData.hours}h
                              </span>
                            )}
                            {note.productionData.area && (
                              <span className="text-[11px] text-[#666] bg-[#f7f7f5] px-2 py-0.5 rounded-md">
                                {note.productionData.area}
                              </span>
                            )}
                            {note.productionData.pipeInstalled != null && (
                              <span className="text-[11px] text-[#666] bg-[#f7f7f5] px-2 py-0.5 rounded-md">
                                {note.productionData.pipeInstalled} ft pipe
                              </span>
                            )}
                            {note.productionData.fixturesInstalled != null && (
                              <span className="text-[11px] text-[#666] bg-[#f7f7f5] px-2 py-0.5 rounded-md">
                                {note.productionData.fixturesInstalled} fixtures
                              </span>
                            )}
                            {note.productionData.unitsCompleted != null && (
                              <span className="text-[11px] text-[#666] bg-[#f7f7f5] px-2 py-0.5 rounded-md">
                                {note.productionData.unitsCompleted} units
                              </span>
                            )}
                            {note.productionData.customItems?.map((item, i) => (
                              <span key={i} className="text-[11px] text-[#666] bg-[#f7f7f5] px-2 py-0.5 rounded-md">
                                {item.value} {item.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* No project selected */}
        {!selectedProjectId && projects.length > 1 && (
          <div className="text-center py-16 text-[14px] text-[#999]">
            Select a project above to view and add daily notes.
          </div>
        )}
      </main>
    </div>
  );
}
