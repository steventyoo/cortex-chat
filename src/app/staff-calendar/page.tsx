'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';

/* ── Types ────────────────────────────────────────────── */
interface RosterEntry {
  id: string;
  workerName: string;
  role: string;
}

interface AvailEntry {
  id: string;
  rosterId: string;
  date: string;
  status: string;
  note: string;
}

interface UserInfo { name: string; email: string; role: string; }

const ROLES = ['Foreman', 'Journeyman', 'Apprentice', 'Laborer', 'Helper'];

/* ── Role styling ────────────────────────────────────── */
const ROLE_STYLES: Record<string, { color: string; bg: string; avatarBg: string; avatarText: string; icon: React.ReactNode }> = {
  Foreman: {
    color: '#9333ea', bg: '#f3e8ff', avatarBg: '#7c3aed', avatarText: '#fff',
    icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z" /></svg>,
  },
  Journeyman: {
    color: '#2563eb', bg: '#dbeafe', avatarBg: '#3b82f6', avatarText: '#fff',
    icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" /></svg>,
  },
  Apprentice: {
    color: '#0891b2', bg: '#cffafe', avatarBg: '#06b6d4', avatarText: '#fff',
    icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></svg>,
  },
  Laborer: {
    color: '#d97706', bg: '#fef3c7', avatarBg: '#f59e0b', avatarText: '#fff',
    icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22V8M5 12H2a10 10 0 0020 0h-3" /><circle cx="12" cy="5" r="3" /></svg>,
  },
  Helper: {
    color: '#059669', bg: '#d1fae5', avatarBg: '#10b981', avatarText: '#fff',
    icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>,
  },
};

const DEFAULT_ROLE_STYLE = { color: '#6b7280', bg: '#f3f4f6', avatarBg: '#9ca3af', avatarText: '#fff', icon: null };

function getRoleStyle(role: string) {
  return ROLE_STYLES[role] || DEFAULT_ROLE_STYLE;
}

const STATUS_OPTIONS = [
  { value: 'available', label: 'Avail', color: '#16a34a', bg: '#dcfce7' },
  { value: 'pto', label: 'PTO', color: '#2563eb', bg: '#dbeafe' },
  { value: 'holiday', label: 'Holiday', color: '#9333ea', bg: '#f3e8ff' },
  { value: 'sick', label: 'Sick', color: '#d97706', bg: '#fef3c7' },
  { value: 'no_show', label: 'No Show', color: '#dc2626', bg: '#fee2e2' },
  { value: 'leave', label: 'Leave', color: '#6b7280', bg: '#f3f4f6' },
];

type ViewMode = 'week' | 'month';

/* ── Helpers ──────────────────────────────────────────── */
function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function fmt(d: Date): string { return d.toISOString().split('T')[0]; }

function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function getMonthStart(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }

function getDaysInMonth(d: Date): number { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ── Page ─────────────────────────────────────────────── */
export default function StaffCalendarPage() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [availability, setAvailability] = useState<AvailEntry[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  /* Week view state */
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));

  /* Month view state */
  const [monthDate, setMonthDate] = useState<Date>(() => getMonthStart(new Date()));

  /* Filter */
  const [roleFilter, setRoleFilter] = useState<string>('all');

  /* Smart command */
  const [cmdText, setCmdText] = useState('');
  const [cmdLoading, setCmdLoading] = useState(false);
  const [cmdResult, setCmdResult] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

  const todayStr = fmt(new Date());

  /* ── Auth ───────────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) { window.location.href = '/login'; return; }
        const data = await res.json();
        if (data.role !== 'admin') { window.location.href = '/'; return; }
        setUser(data);
      } catch { window.location.href = '/login'; }
      finally { setAuthLoading(false); }
    })();
  }, []);

  /* ── Fetch roster ───────────────────────────────────── */
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await fetch('/api/staffing/roster?scope=org');
        const data = await res.json();
        setRoster(data.roster || []);
      } catch { setRoster([]); }
    })();
  }, [user]);

  /* ── Fetch availability ─────────────────────────────── */
  const fetchAvailability = useCallback(async () => {
    if (!user) return;
    setCalLoading(true);
    let startDate: string, endDate: string;
    if (viewMode === 'week') {
      startDate = fmt(weekStart);
      endDate = fmt(addDays(weekStart, 6));
    } else {
      startDate = fmt(monthDate);
      endDate = fmt(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0));
    }
    try {
      const res = await fetch(`/api/staffing/availability?startDate=${startDate}&endDate=${endDate}`);
      const data = await res.json();
      setAvailability(data.entries || []);
    } catch { setAvailability([]); }
    finally { setCalLoading(false); }
  }, [user, weekStart, monthDate, viewMode]);

  useEffect(() => { fetchAvailability(); }, [fetchAvailability]);

  /* ── Status helpers ─────────────────────────────────── */
  function getStatus(rosterId: string, date: string): string {
    return availability.find((a) => a.rosterId === rosterId && a.date === date)?.status || 'available';
  }
  function getStatusStyle(status: string) {
    return STATUS_OPTIONS.find((s) => s.value === status) || STATUS_OPTIONS[0];
  }

  /* ── Set status directly ─────────────────────────────── */
  async function setStatus(rosterId: string, date: string, status: string) {
    const cellKey = `${rosterId}-${date}`;
    setOpenDropdown(null);
    setSavingCell(cellKey);
    try {
      await fetch('/api/staffing/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: [{ rosterId, date, status }] }),
      });
      await fetchAvailability();
    } catch { /* ignore */ }
    setSavingCell(null);
  }

  /* Close dropdown on outside click */
  useEffect(() => {
    if (!openDropdown) return;
    const handler = () => setOpenDropdown(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openDropdown]);

  /* ── Holiday for all on a date ──────────────────────── */
  async function setHolidayForAll(date: string) {
    const entries = filteredRoster.map((r) => ({ rosterId: r.id, date, status: 'holiday', note: '' }));
    try {
      await fetch('/api/staffing/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      await fetchAvailability();
    } catch { /* ignore */ }
  }

  /* ── PTO for all on a date ──────────────────────────── */
  async function setPTOForAll(date: string) {
    const entries = filteredRoster.map((r) => ({ rosterId: r.id, date, status: 'pto', note: '' }));
    try {
      await fetch('/api/staffing/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      await fetchAvailability();
    } catch { /* ignore */ }
  }

  /* ── Clear all for a date ───────────────────────────── */
  async function clearDate(date: string) {
    const entries = filteredRoster.map((r) => ({ rosterId: r.id, date, status: 'available' }));
    try {
      await fetch('/api/staffing/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      await fetchAvailability();
    } catch { /* ignore */ }
  }

  /* ── Smart command (LLM) ──────────────────────────────── */
  async function handleCommand() {
    if (!cmdText.trim()) return;
    setCmdLoading(true);
    setCmdResult(null);
    try {
      const vDates = viewMode === 'week'
        ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
        : Array.from({ length: getDaysInMonth(monthDate) }, (_, i) => new Date(monthDate.getFullYear(), monthDate.getMonth(), i + 1));
      const dates = vDates.map((d) => fmt(d));
      const res = await fetch('/api/staffing/calendar-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmdText, roster, dates }),
      });
      const data = await res.json();
      if (!res.ok || !data.actions?.length) {
        setCmdResult(data.error || 'No changes to make.');
        setCmdLoading(false);
        return;
      }
      // Apply all actions
      const entries = data.actions.map((a: { rosterId: string; date: string; status: string }) => ({
        rosterId: a.rosterId, date: a.date, status: a.status,
      }));
      await fetch('/api/staffing/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      await fetchAvailability();
      setCmdResult(data.summary);
      setCmdText('');
    } catch {
      setCmdResult('Failed to process command.');
    } finally {
      setCmdLoading(false);
    }
  }

  /* ── Voice input ─────────────────────────────────────── */
  function startVoice() {
    const SR = (window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (!SR) { setCmdResult('Voice not supported in this browser.'); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new (SR as any)();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      setCmdText(transcript);
      setIsListening(false);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    setIsListening(true);
    recognition.start();
  }

  /* ── Loading / Auth ─────────────────────────────────── */
  if (authLoading) {
    return <div className="min-h-screen bg-[#f7f7f5] flex items-center justify-center"><p className="text-[13px] text-[#999]">Loading...</p></div>;
  }
  if (!user) return null;

  /* ── Filter roster ──────────────────────────────────── */
  const filteredRoster = roleFilter === 'all' ? roster : roster.filter((r) => r.role === roleFilter);

  /* ── Group by role ──────────────────────────────────── */
  const grouped: Record<string, RosterEntry[]> = {};
  for (const entry of filteredRoster) {
    const r = entry.role || 'Other';
    if (!grouped[r]) grouped[r] = [];
    grouped[r].push(entry);
  }
  const roleOrder = [...ROLES, ...Object.keys(grouped).filter((r) => !ROLES.includes(r))];

  /* ── Dates for current view ─────────────────────────── */
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const monthDays = Array.from({ length: getDaysInMonth(monthDate) }, (_, i) => new Date(monthDate.getFullYear(), monthDate.getMonth(), i + 1));

  const viewDates = viewMode === 'week' ? weekDates : monthDays;

  /* ── Summary stats ──────────────────────────────────── */
  const todayAvail = filteredRoster.filter((r) => getStatus(r.id, todayStr) === 'available').length;
  const todayOff = filteredRoster.length - todayAvail;
  const weekOffCount = availability.filter((a) => a.status !== 'available').length;

  return (
    <div className="min-h-screen bg-[#f7f7f5]">
      {/* ── Top Bar ──────────────────────────────────── */}
      <div className="bg-white border-b border-[#e8e8e8] px-6 py-4">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="p-1.5 rounded-lg hover:bg-[#f0f0f0] text-[#999] hover:text-[#1a1a1a] transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </a>
            <div>
              <h1 className="text-[18px] font-bold text-[#1a1a1a] tracking-[-0.01em]">Crew Availability</h1>
              <p className="text-[12px] text-[#999]">Manage schedules, PTO, holidays & time off</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex rounded-lg ring-1 ring-[#e0e0e0] overflow-hidden">
              {(['week', 'month'] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    viewMode === mode ? 'bg-[#1a1a1a] text-white' : 'bg-white text-[#666] hover:bg-[#f0f0f0]'
                  }`}
                >
                  {mode === 'week' ? 'Week' : 'Month'}
                </button>
              ))}
            </div>

            {/* Role filter */}
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg ring-1 ring-[#e0e0e0] bg-white text-[12px] focus:ring-[#1a1a1a] focus:outline-none"
            >
              <option value="all">All Roles</option>
              {ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
            </select>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 py-6">
        {/* ── Navigation + Summary ───────────────────── */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => viewMode === 'week' ? setWeekStart(addDays(weekStart, -7)) : setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))}
              className="p-2 rounded-lg hover:bg-white ring-1 ring-[#e0e0e0] text-[#666] hover:text-[#1a1a1a] transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <button
              onClick={() => { setWeekStart(getMonday(new Date())); setMonthDate(getMonthStart(new Date())); }}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium hover:bg-white ring-1 ring-[#e0e0e0] text-[#666] hover:text-[#1a1a1a] transition-colors"
            >
              Today
            </button>
            <button
              onClick={() => viewMode === 'week' ? setWeekStart(addDays(weekStart, 7)) : setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))}
              className="p-2 rounded-lg hover:bg-white ring-1 ring-[#e0e0e0] text-[#666] hover:text-[#1a1a1a] transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
            </button>
            <span className="text-[14px] font-semibold text-[#1a1a1a] ml-2">
              {viewMode === 'week'
                ? `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${addDays(weekStart, 6).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                : monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
              }
            </span>
          </div>

          <div className="flex items-center gap-3 text-[12px]">
            <span className="px-2.5 py-1 rounded-full bg-[#dcfce7] text-[#166534] font-medium">{todayAvail} available today</span>
            <span className="px-2.5 py-1 rounded-full bg-[#fee2e2] text-[#991b1b] font-medium">{todayOff} off today</span>
            <span className="px-2.5 py-1 rounded-full bg-[#f3f4f6] text-[#374151] font-medium">{weekOffCount} entries this {viewMode}</span>
          </div>
        </div>

        {/* ── Smart Command Bar ──────────────────────── */}
        <div className="mb-4 rounded-xl ring-1 ring-[#e0e0e0] bg-white p-3">
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={cmdText}
                onChange={(e) => { setCmdText(e.target.value); setCmdResult(null); }}
                onKeyDown={(e) => e.key === 'Enter' && !cmdLoading && handleCommand()}
                placeholder="Try: &quot;All foremen off this week&quot; or &quot;Mike is sick Tuesday&quot;..."
                className="w-full pl-9 pr-3 py-2 rounded-lg ring-1 ring-[#e0e0e0] bg-[#f7f7f5] text-[13px] focus:ring-[#1a1a1a] focus:bg-white focus:outline-none transition-colors"
                disabled={cmdLoading}
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 2a4 4 0 014 4v4a4 4 0 01-8 0V6a4 4 0 014-4z" /><path d="M19 10v1a7 7 0 01-14 0v-1" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <button onClick={startVoice} disabled={cmdLoading}
              className={`p-2 rounded-lg ring-1 transition-colors flex-shrink-0 ${isListening ? 'ring-red-400 bg-red-50 text-red-600 animate-pulse' : 'ring-[#e0e0e0] text-[#999] hover:text-[#1a1a1a] hover:bg-[#f0f0f0]'}`}
              title="Voice input">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 2a4 4 0 014 4v4a4 4 0 01-8 0V6a4 4 0 014-4z" /><path d="M19 10v1a7 7 0 01-14 0v-1" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
            <button onClick={handleCommand} disabled={cmdLoading || !cmdText.trim()}
              className="px-4 py-2 rounded-lg bg-[#1a1a1a] text-white text-[12px] font-medium hover:bg-[#333] disabled:opacity-40 transition-colors flex-shrink-0">
              {cmdLoading ? 'Processing...' : 'Apply'}
            </button>
          </div>
          {cmdResult && (
            <p className={`text-[12px] mt-2 px-1 ${cmdResult.startsWith('Failed') || cmdResult.startsWith('No ') || cmdResult.startsWith('Voice') || cmdResult.startsWith('Could') ? 'text-red-500' : 'text-emerald-600'}`}>
              {cmdResult}
            </p>
          )}
        </div>

        {/* ── Legend ──────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <span className="text-[11px] text-[#999] font-medium">Status legend:</span>
          {STATUS_OPTIONS.map((s) => (
            <div key={s.value} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.bg, border: `1px solid ${s.color}` }} />
              <span className="text-[11px] text-[#666]">{s.label}</span>
            </div>
          ))}
        </div>

        {/* ── Calendar Grid ──────────────────────────── */}
        {filteredRoster.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[14px] text-[#999]">
              {roster.length === 0
                ? <>No crew members yet. <a href="/staff-roster" className="text-[#1a1a1a] underline hover:no-underline">Add them in the Staff Roster</a>.</>
                : 'No crew members match the selected filter.'}
            </p>
          </div>
        ) : (
          <div className="rounded-xl ring-1 ring-[#e0e0e0] overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="bg-[#f7f7f5] border-b border-[#e0e0e0]">
                    <th className="text-left px-4 py-2 font-semibold text-[#1a1a1a] sticky left-0 bg-[#f7f7f5] z-10 min-w-[160px]">
                      Crew Member
                    </th>
                    {viewDates.map((d) => {
                      const dateStr = fmt(d);
                      const isToday = dateStr === todayStr;
                      const dayIdx = (d.getDay() + 6) % 7; // Mon=0
                      const isWeekend = dayIdx >= 5;
                      return (
                        <th
                          key={dateStr}
                          className={`text-center px-1 py-2 font-medium min-w-[70px] ${isWeekend ? 'bg-[#f0f0ee]' : ''} ${isToday ? 'text-[#1a1a1a]' : 'text-[#666]'}`}
                        >
                          <div className={`text-[10px] ${isToday ? 'font-bold text-[#1a1a1a]' : 'text-[#999]'}`}>
                            {DAY_LABELS[dayIdx]}
                          </div>
                          <div className={`text-[12px] ${isToday ? 'bg-[#1a1a1a] text-white rounded-full w-6 h-6 flex items-center justify-center mx-auto' : ''}`}>
                            {d.getDate()}
                          </div>
                          {/* Quick actions */}
                          <div className="flex justify-center gap-0.5 mt-0.5">
                            <button onClick={() => setHolidayForAll(dateStr)} className="text-[8px] text-purple-400 hover:text-purple-600" title="Holiday all">H</button>
                            <button onClick={() => setPTOForAll(dateStr)} className="text-[8px] text-blue-400 hover:text-blue-600" title="PTO all">P</button>
                            <button onClick={() => clearDate(dateStr)} className="text-[8px] text-gray-400 hover:text-gray-600" title="Clear all">C</button>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {roleOrder.map((role) => {
                    const members = grouped[role];
                    if (!members || members.length === 0) return null;
                    return (
                      <React.Fragment key={role}>
                        <tr style={{ backgroundColor: getRoleStyle(role).bg }}>
                          <td colSpan={viewDates.length + 1} className="px-4 py-1 text-[10px] font-bold uppercase tracking-wider sticky left-0" style={{ backgroundColor: getRoleStyle(role).bg, color: getRoleStyle(role).color }}>
                            <span className="inline-flex items-center gap-1.5">
                              {getRoleStyle(role).icon}
                              {role} ({members.length})
                            </span>
                          </td>
                        </tr>
                        {members.map((entry) => (
                          <tr key={entry.id} className="border-b border-[#f0f0f0] hover:bg-[#fafaf8]">
                            <td className="px-4 py-1.5 sticky left-0 bg-white z-10 border-r border-[#f0f0f0]">
                              <div className="flex items-center gap-2">
                                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                                  style={{ backgroundColor: getRoleStyle(entry.role).avatarBg, color: getRoleStyle(entry.role).avatarText }}>
                                  {entry.workerName.charAt(0).toUpperCase()}
                                </div>
                                <span className="font-medium text-[#1a1a1a] text-[11px] truncate max-w-[110px]">{entry.workerName}</span>
                              </div>
                            </td>
                            {viewDates.map((d) => {
                              const dateStr = fmt(d);
                              const status = getStatus(entry.id, dateStr);
                              const style = getStatusStyle(status);
                              const cellKey = `${entry.id}-${dateStr}`;
                              const isSaving = savingCell === cellKey;
                              const isOpen = openDropdown === cellKey;
                              const dayIdx = (d.getDay() + 6) % 7;
                              const isWeekend = dayIdx >= 5;
                              return (
                                <td key={dateStr} className={`text-center px-0.5 py-1 ${isWeekend ? 'bg-[#fafaf8]' : ''} relative`}>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setOpenDropdown(isOpen ? null : cellKey); }}
                                    disabled={isSaving}
                                    className="w-full px-1 py-1.5 rounded text-[10px] font-medium transition-all hover:ring-1 hover:ring-[#bbb] disabled:opacity-50 flex items-center justify-center gap-0.5"
                                    style={{ backgroundColor: style.bg, color: style.color }}
                                  >
                                    {isSaving ? '...' : style.label}
                                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-40 flex-shrink-0"><path d="M6 9l6 6 6-6" /></svg>
                                  </button>
                                  {isOpen && (
                                    <div
                                      className="absolute z-50 mt-1 left-1/2 -translate-x-1/2 bg-white rounded-lg shadow-lg ring-1 ring-[#e0e0e0] py-1 min-w-[110px]"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {STATUS_OPTIONS.map((opt) => (
                                        <button
                                          key={opt.value}
                                          onClick={() => setStatus(entry.id, dateStr, opt.value)}
                                          className={`w-full text-left px-3 py-1.5 text-[11px] font-medium hover:bg-[#f5f5f5] flex items-center gap-2 transition-colors ${status === opt.value ? 'bg-[#f0f0f0]' : ''}`}
                                        >
                                          <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: opt.bg, border: `1.5px solid ${opt.color}` }} />
                                          <span style={{ color: opt.color }}>{opt.label}</span>
                                          {status === opt.value && <span className="ml-auto text-[9px] text-[#999]">current</span>}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="px-4 py-2 bg-[#f7f7f5] border-t border-[#e0e0e0] flex items-center justify-between text-[11px] text-[#999]">
              <span>{filteredRoster.length} crew members shown</span>
              <div className="flex items-center gap-3">
                <span>H = Holiday all | P = PTO all | C = Clear all</span>
                <a href="/staff-roster" className="text-[#1a1a1a] font-medium hover:underline">Manage Roster →</a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
