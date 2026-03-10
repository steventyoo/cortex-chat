'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/* ── Types ────────────────────────────────────────────── */
interface RosterEntry {
  id: string;
  workerName: string;
  role: string;
}

interface AvailEntry {
  rosterId: string;
  status: string;
  note: string;
}

interface StaffingRow {
  workerName: string;
  role: string;
  totalHours: number;
  regularHours: number;
  otHours: number;
}

interface StaffingSummary {
  totalRegHours: number;
  totalOtHours: number;
  workDays: number;
  otPercent: number;
}

interface StaffingPanelProps {
  projectId: string;
}

const ROLES = ['Foreman', 'Journeyman', 'Apprentice', 'Laborer', 'Helper'];

/* ── Role styling ────────────────────────────────────── */
const ROLE_STYLES: Record<string, { color: string; bg: string; avatarBg: string; avatarText: string }> = {
  Foreman:    { color: '#9333ea', bg: '#f3e8ff', avatarBg: '#7c3aed', avatarText: '#fff' },
  Journeyman: { color: '#2563eb', bg: '#dbeafe', avatarBg: '#3b82f6', avatarText: '#fff' },
  Apprentice: { color: '#0891b2', bg: '#cffafe', avatarBg: '#06b6d4', avatarText: '#fff' },
  Laborer:    { color: '#d97706', bg: '#fef3c7', avatarBg: '#f59e0b', avatarText: '#fff' },
  Helper:     { color: '#059669', bg: '#d1fae5', avatarBg: '#10b981', avatarText: '#fff' },
};
const DEFAULT_STYLE = { color: '#6b7280', bg: '#f3f4f6', avatarBg: '#9ca3af', avatarText: '#fff' };
function rs(role: string) { return ROLE_STYLES[role] || DEFAULT_STYLE; }

/* ── Availability status styles ────────────────────────── */
const AVAIL_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  sick:    { label: 'Sick', color: '#d97706', bg: '#fef3c7' },
  pto:     { label: 'PTO', color: '#2563eb', bg: '#dbeafe' },
  holiday: { label: 'Holiday', color: '#9333ea', bg: '#f3e8ff' },
  no_show: { label: 'No Show', color: '#dc2626', bg: '#fee2e2' },
  leave:   { label: 'Leave', color: '#6b7280', bg: '#f3f4f6' },
};

/* ── Helpers ──────────────────────────────────────────── */
function todayStr() { return new Date().toISOString().split('T')[0]; }
function splitHours(total: number) { return { reg: Math.min(total, 8), ot: Math.max(total - 8, 0) }; }

/* ── Component ────────────────────────────────────────── */
export default function StaffingPanel({ projectId }: StaffingPanelProps) {
  /* Crew assigned to THIS project */
  const [projectCrew, setProjectCrew] = useState<RosterEntry[]>([]);
  /* Org-wide roster (for "pick from roster" modal) */
  const [orgRoster, setOrgRoster] = useState<RosterEntry[]>([]);

  const [staffingRows, setStaffingRows] = useState<StaffingRow[]>([]);
  const [staffDate, setStaffDate] = useState(todayStr());
  const [summary, setSummary] = useState<StaffingSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  /* Add crew UI */
  const [showAddCrew, setShowAddCrew] = useState(false);
  const [addMode, setAddMode] = useState<'roster' | 'manual'>('roster');
  const [rosterSearch, setRosterSearch] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualRole, setManualRole] = useState('Journeyman');
  const [addError, setAddError] = useState<string | null>(null);

  /* CSV import */
  const [csvDragging, setCsvDragging] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Availability from master calendar */
  const [availability, setAvailability] = useState<Map<string, AvailEntry>>(new Map());

  /* Remove confirm */
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  /* Export */
  const [showExport, setShowExport] = useState(false);
  const [exportStart, setExportStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay());
    return d.toISOString().split('T')[0];
  });
  const [exportEnd, setExportEnd] = useState(todayStr());

  /* ── Fetch project crew + entries for selected date ── */
  const fetchData = useCallback(async () => {
    setLoading(true);
    setSaved(false);
    try {
      const [crewRes, entriesRes, summaryRes, availRes] = await Promise.all([
        fetch(`/api/staffing/roster?projectId=${encodeURIComponent(projectId)}`),
        fetch(`/api/staffing?projectId=${encodeURIComponent(projectId)}&date=${staffDate}`),
        fetch(`/api/staffing?projectId=${encodeURIComponent(projectId)}&summary=true`),
        fetch(`/api/staffing/availability?startDate=${staffDate}&endDate=${staffDate}`).catch(() => null),
      ]);

      const crewData = await crewRes.json();
      const entriesData = await entriesRes.json();
      const summaryData = await summaryRes.json();

      // Parse availability (keyed by rosterId)
      const availData = availRes ? await availRes.json().catch(() => ({ entries: [] })) : { entries: [] };
      const availMap = new Map<string, AvailEntry>();
      for (const e of (availData.entries || [])) {
        if (e.status && e.status !== 'available') {
          availMap.set(e.rosterId, { rosterId: e.rosterId, status: e.status, note: e.note || '' });
        }
      }
      setAvailability(availMap);

      const crewList: RosterEntry[] = crewData.roster || [];
      setProjectCrew(crewList);
      if (summaryData.summary) setSummary(summaryData.summary);

      // Build rows from project crew
      const existingEntries = entriesData.entries || [];
      const entryMap = new Map<string, { totalHours: number }>();
      for (const e of existingEntries) {
        entryMap.set(e.workerName, { totalHours: e.totalHours || 0 });
      }

      const rows: StaffingRow[] = crewList.map((r) => {
        const existing = entryMap.get(r.workerName);
        const total = existing ? existing.totalHours : 0;
        const { reg, ot } = splitHours(total);
        return { workerName: r.workerName, role: r.role, totalHours: total, regularHours: reg, otHours: ot };
      });

      setStaffingRows(rows);
    } catch (err) {
      console.error('StaffingPanel fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, staffDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ── Fetch org roster when "Add Crew" opens ──────── */
  async function loadOrgRoster() {
    try {
      const res = await fetch('/api/staffing/roster?scope=org');
      const data = await res.json();
      setOrgRoster(data.roster || []);
    } catch { setOrgRoster([]); }
  }

  function openAddCrew() {
    setShowAddCrew(true);
    setAddMode('roster');
    setRosterSearch('');
    setManualName('');
    setManualRole('Journeyman');
    setAddError(null);
    setCsvResult(null);
    loadOrgRoster();
  }

  /* ── Add from org roster ─────────────────────────── */
  async function addFromRoster(entry: RosterEntry) {
    // Check if already on project
    if (projectCrew.some((c) => c.workerName.toLowerCase() === entry.workerName.toLowerCase())) {
      setAddError(`${entry.workerName} is already on this project`);
      return;
    }
    setAddError(null);
    try {
      const res = await fetch('/api/staffing/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerName: entry.workerName, role: entry.role, projectId }),
      });
      if (res.ok) {
        await fetchData();
      } else {
        setAddError('Failed to add crew member');
      }
    } catch {
      setAddError('Failed to add — check connection');
    }
  }

  /* ── Add manually ─────────────────────────────────── */
  async function addManual() {
    if (!manualName.trim()) { setAddError('Name is required'); return; }
    if (projectCrew.some((c) => c.workerName.toLowerCase() === manualName.trim().toLowerCase())) {
      setAddError(`${manualName.trim()} is already on this project`);
      return;
    }
    setAddError(null);
    try {
      const res = await fetch('/api/staffing/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerName: manualName.trim(), role: manualRole, projectId }),
      });
      if (res.ok) {
        setManualName('');
        await fetchData();
      } else {
        setAddError('Failed to add');
      }
    } catch {
      setAddError('Failed to add — check connection');
    }
  }

  /* ── CSV Import ──────────────────────────────────── */
  async function handleCsvImport(file: File) {
    setCsvImporting(true);
    setCsvResult(null);
    try {
      const text = await file.text();
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) { setCsvResult('CSV must have a header and at least one row.'); setCsvImporting(false); return; }

      const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));
      const nameIdx = header.findIndex((h) => ['name', 'worker', 'employee', 'worker_name', 'full name'].includes(h));
      const roleIdx = header.findIndex((h) => ['role', 'position', 'title', 'job title'].includes(h));
      if (nameIdx === -1) { setCsvResult('Could not find a "Name" column.'); setCsvImporting(false); return; }

      const existingNames = new Set(projectCrew.map((c) => c.workerName.toLowerCase()));
      let added = 0, skipped = 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].match(/("([^"]*)"|[^,]*)/g)?.map((c) => c.trim().replace(/^"|"$/g, '')) || [];
        const name = cols[nameIdx]?.trim();
        const role = roleIdx >= 0 ? cols[roleIdx]?.trim() : 'Laborer';
        if (!name) continue;
        if (existingNames.has(name.toLowerCase())) { skipped++; continue; }

        const matchedRole = ROLES.find((r) => r.toLowerCase() === role?.toLowerCase()) || role || 'Laborer';
        const res = await fetch('/api/staffing/roster', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workerName: name, role: matchedRole, projectId }),
        });
        if (res.ok) { added++; existingNames.add(name.toLowerCase()); }
      }

      setCsvResult(`Added ${added} crew member${added !== 1 ? 's' : ''}${skipped > 0 ? `, ${skipped} skipped (already on project)` : ''}.`);
      if (added > 0) await fetchData();
    } catch { setCsvResult('Failed to parse CSV.'); }
    finally { setCsvImporting(false); }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setCsvDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) handleCsvImport(file);
    else setCsvResult('Please drop a .csv file.');
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleCsvImport(file);
    e.target.value = '';
  }

  /* ── Remove crew from project ─────────────────────── */
  async function removeCrew(rosterId: string) {
    try {
      await fetch('/api/staffing/roster', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterId }),
      });
      setConfirmRemoveId(null);
      await fetchData();
    } catch { /* ignore */ }
  }

  /* ── Update hours ──────────────────────────────────── */
  function updateHours(index: number, totalHours: number) {
    setStaffingRows((prev) => {
      const next = [...prev];
      const { reg, ot } = splitHours(totalHours);
      next[index] = { ...next[index], totalHours, regularHours: reg, otHours: ot };
      return next;
    });
    setSaved(false);
  }

  /* ── Save hours ────────────────────────────────────── */
  async function handleSave() {
    setSaving(true); setSaved(false);
    try {
      const res = await fetch('/api/staffing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId, date: staffDate,
          entries: staffingRows.map((r) => ({ workerName: r.workerName, role: r.role, totalHours: r.totalHours })),
        }),
      });
      if (res.ok) {
        setSaved(true);
        const summaryRes = await fetch(`/api/staffing?projectId=${encodeURIComponent(projectId)}&summary=true`);
        const summaryData = await summaryRes.json();
        if (summaryData.summary) setSummary(summaryData.summary);
      }
    } catch (err) { console.error('Save error:', err); }
    finally { setSaving(false); }
  }

  /* ── Totals ────────────────────────────────────────── */
  const totalReg = staffingRows.reduce((s, r) => s + r.regularHours, 0);
  const totalOt = staffingRows.reduce((s, r) => s + r.otHours, 0);
  const totalAll = staffingRows.reduce((s, r) => s + r.totalHours, 0);

  /* ── Worker name → roster ID lookup ──────────────── */
  const nameToRosterId = new Map(projectCrew.map((c) => [c.workerName, c.id]));

  /* ── Pre-compute availability style per worker name ── */
  const workerAvailStyle = new Map<string, { label: string; color: string; bg: string; note: string }>();
  for (const [name, rosterId] of nameToRosterId) {
    const avail = availability.get(rosterId);
    if (avail) {
      const s = AVAIL_STYLES[avail.status];
      if (s) workerAvailStyle.set(name, { ...s, note: avail.note || '' });
    }
  }

  /* ── Filtered org roster (exclude already-assigned) ── */
  const assignedNames = new Set(projectCrew.map((c) => c.workerName.toLowerCase()));
  const availableRoster = orgRoster
    .filter((r) => !assignedNames.has(r.workerName.toLowerCase()))
    .filter((r) => !rosterSearch || r.workerName.toLowerCase().includes(rosterSearch.toLowerCase()) || r.role.toLowerCase().includes(rosterSearch.toLowerCase()));

  if (loading) {
    return <div className="flex items-center justify-center py-20"><p className="text-[13px] text-[#999]">Loading staffing...</p></div>;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
      {/* ── Project Crew Header ─────────────────────── */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-[#1a1a1a]">Project Crew</h2>
          <p className="text-[12px] text-[#999]">{projectCrew.length} member{projectCrew.length !== 1 ? 's' : ''} assigned</p>
        </div>
        <motion.button whileTap={{ scale: 0.97 }} onClick={openAddCrew}
          className="px-4 py-2 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5V19M5 12H19" /></svg>
          Add Crew
        </motion.button>
      </div>

      {/* ── Add Crew Panel ──────────────────────────── */}
      <AnimatePresence>
        {showAddCrew && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="mb-6 rounded-xl ring-1 ring-[#e0e0e0] bg-white overflow-hidden">

            {/* Tab bar */}
            <div className="flex border-b border-[#e0e0e0]">
              {([['roster', 'From Roster'], ['manual', 'Add Manually']] as const).map(([key, label]) => (
                <button key={key} onClick={() => { setAddMode(key); setAddError(null); }}
                  className={`flex-1 px-4 py-2.5 text-[13px] font-medium transition-colors ${addMode === key ? 'bg-white text-[#1a1a1a] border-b-2 border-[#1a1a1a]' : 'bg-[#f7f7f5] text-[#999] hover:text-[#666]'}`}>
                  {label}
                </button>
              ))}
              <button onClick={() => setShowAddCrew(false)}
                className="px-3 py-2.5 text-[#999] hover:text-[#1a1a1a] transition-colors bg-[#f7f7f5]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-4">
              {addMode === 'roster' ? (
                <>
                  <input type="text" placeholder="Search org roster..." value={rosterSearch} onChange={(e) => setRosterSearch(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg ring-1 ring-[#e0e0e0] bg-white text-[13px] focus:ring-[#1a1a1a] focus:outline-none mb-3" autoFocus />
                  <div className="max-h-[240px] overflow-y-auto space-y-1">
                    {availableRoster.length === 0 ? (
                      <p className="text-[12px] text-[#999] text-center py-4">
                        {orgRoster.length === 0 ? 'No crew in org roster yet.' : 'All matching crew already assigned.'}
                      </p>
                    ) : availableRoster.map((entry) => (
                      <button key={entry.id} onClick={() => addFromRoster(entry)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#f5f5f3] transition-colors text-left group">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                          style={{ backgroundColor: rs(entry.role).avatarBg, color: rs(entry.role).avatarText }}>
                          {entry.workerName.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-[13px] font-medium text-[#1a1a1a] block truncate">{entry.workerName}</span>
                          <span className="text-[11px] font-medium" style={{ color: rs(entry.role).color }}>{entry.role}</span>
                        </div>
                        <span className="text-[11px] text-[#ccc] group-hover:text-[#1a1a1a] font-medium transition-colors">+ Add</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input type="text" placeholder="Full name *" value={manualName} onChange={(e) => setManualName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addManual()}
                      className="px-3 py-2 rounded-lg ring-1 ring-[#e0e0e0] bg-white text-[13px] focus:ring-[#1a1a1a] focus:outline-none" autoFocus />
                    <select value={manualRole} onChange={(e) => setManualRole(e.target.value)}
                      className="px-3 py-2 rounded-lg ring-1 ring-[#e0e0e0] bg-white text-[13px] focus:ring-[#1a1a1a] focus:outline-none">
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <motion.button whileTap={{ scale: 0.97 }} onClick={addManual}
                    className="px-4 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333]">
                    Add to Project
                  </motion.button>
                </div>
              )}

              {addError && <p className="text-[12px] text-red-500 mt-2">{addError}</p>}

              {/* CSV drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setCsvDragging(true); }}
                onDragLeave={() => setCsvDragging(false)}
                onDrop={handleDrop}
                className={`mt-4 pt-3 border-t border-[#f0f0f0] text-center ${csvDragging ? 'bg-[#f0f0ef]' : ''}`}
              >
                <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileSelect} className="hidden" />
                {csvImporting ? (
                  <p className="text-[12px] text-[#999]">Importing...</p>
                ) : (
                  <p className="text-[12px] text-[#999]">
                    Or drag & drop a CSV, or{' '}
                    <button onClick={() => fileInputRef.current?.click()} className="text-[#1a1a1a] font-medium underline hover:no-underline">browse</button>
                    <span className="text-[11px] ml-1">(columns: Name, Role)</span>
                  </p>
                )}
                {csvResult && <p className={`text-[12px] mt-1 ${csvResult.startsWith('Added') ? 'text-emerald-600' : 'text-red-500'}`}>{csvResult}</p>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Empty state ────────────────────────────── */}
      {projectCrew.length === 0 ? (
        <div className="rounded-2xl ring-1 ring-[#e8e8e8] bg-white p-8 text-center">
          <svg className="mx-auto mb-3 text-[#ccc]" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
          </svg>
          <h3 className="text-[15px] font-semibold text-[#1a1a1a] mb-1">No crew assigned to this project</h3>
          <p className="text-[13px] text-[#999] mb-4">
            Click &quot;Add Crew&quot; to pick from your org roster, add manually, or import a CSV.
          </p>
          <motion.button whileTap={{ scale: 0.97 }} onClick={openAddCrew}
            className="px-5 py-2 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333]">
            Add Crew
          </motion.button>
        </div>
      ) : (
        <>
          {/* ── Date Picker + Hours Header ───────────── */}
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h2 className="text-[16px] font-semibold text-[#1a1a1a]">Daily Hours</h2>
            <input type="date" value={staffDate} onChange={(e) => setStaffDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg ring-1 ring-[#e0e0e0] bg-white text-[13px] text-[#1a1a1a] focus:ring-[#1a1a1a] focus:outline-none" />
          </div>

          {/* ── Hours Table ───────────────────────────── */}
          <div className="rounded-xl ring-1 ring-[#e0e0e0] overflow-hidden mb-4">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-[#f7f7f5] border-b border-[#e0e0e0]">
                  <th className="text-left px-4 py-2.5 font-semibold text-[#1a1a1a] w-[30%]">Name</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-[#1a1a1a] w-[15%]">Position</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-[#1a1a1a] w-[12%]">Status</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-[#1a1a1a] w-[14%]">Total Hrs</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-[#1a1a1a] w-[14%]">Reg</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-[#1a1a1a] w-[14%]">OT</th>
                </tr>
              </thead>
              <tbody>
                {staffingRows.map((row, i) => (
                  <tr key={row.workerName}
                    className={`border-b border-[#f0f0f0] ${i % 2 === 1 ? 'bg-[#fafafa]' : 'bg-white'} hover:bg-[#f5f5f3] transition-colors`}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                          style={{ backgroundColor: rs(row.role).avatarBg, color: rs(row.role).avatarText }}>
                          {row.workerName.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-[#1a1a1a]">{row.workerName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
                        style={{ backgroundColor: rs(row.role).bg, color: rs(row.role).color }}>
                        {row.role}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider"
                        style={{
                          backgroundColor: workerAvailStyle.get(row.workerName)?.bg || '#dcfce7',
                          color: workerAvailStyle.get(row.workerName)?.color || '#16a34a',
                        }}
                        title={workerAvailStyle.get(row.workerName)?.note || ''}>
                        {workerAvailStyle.get(row.workerName)?.label || 'Available'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <input type="number" min="0" max="24" step="0.5" value={row.totalHours || ''} placeholder="0"
                        onChange={(e) => updateHours(i, Number(e.target.value) || 0)}
                        className="w-16 mx-auto text-center px-2 py-1 rounded-md ring-1 ring-[#e0e0e0] bg-white text-[13px] focus:ring-[#1a1a1a] focus:outline-none" />
                    </td>
                    <td className="px-4 py-2 text-center text-[#6b6b6b] tabular-nums">{row.regularHours}</td>
                    <td className={`px-4 py-2 text-center tabular-nums font-medium ${row.otHours > 0 ? 'text-amber-600 bg-amber-50' : 'text-[#6b6b6b]'}`}>
                      {row.otHours}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#f7f7f5] border-t-2 border-[#e0e0e0]">
                  <td className="px-4 py-2.5 font-bold text-[#1a1a1a]" colSpan={3}>Totals ({staffingRows.length} crew)</td>
                  <td className="px-4 py-2.5 text-center font-bold text-[#1a1a1a] tabular-nums">{totalAll}</td>
                  <td className="px-4 py-2.5 text-center font-bold text-[#1a1a1a] tabular-nums">{totalReg}</td>
                  <td className={`px-4 py-2.5 text-center font-bold tabular-nums ${totalOt > 0 ? 'text-amber-600' : 'text-[#1a1a1a]'}`}>{totalOt}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ── Save Button ──────────────────────────── */}
          <div className="flex items-center gap-3 mb-6">
            <motion.button whileTap={{ scale: 0.97 }} onClick={handleSave} disabled={saving}
              className="px-5 py-2 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : 'Save Hours'}
            </motion.button>
            {saved && <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="text-[13px] text-emerald-600 font-medium">Saved</motion.span>}
          </div>

          {/* ── Summary Stats ────────────────────────── */}
          {summary && summary.workDays > 0 && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="rounded-xl ring-1 ring-[#e8e8e8] bg-white p-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[#999] mb-1">Total Reg Hours</p>
                <span className="text-[20px] font-bold text-[#1a1a1a]">{summary.totalRegHours}</span>
              </div>
              <div className="rounded-xl ring-1 ring-[#e8e8e8] bg-white p-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[#999] mb-1">Total OT Hours</p>
                <span className={`text-[20px] font-bold ${summary.totalOtHours > 0 ? 'text-amber-600' : 'text-[#1a1a1a]'}`}>{summary.totalOtHours}</span>
              </div>
              <div className="rounded-xl ring-1 ring-[#e8e8e8] bg-white p-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[#999] mb-1">OT %</p>
                <span className={`text-[20px] font-bold ${summary.otPercent > 15 ? 'text-amber-600' : 'text-[#1a1a1a]'}`}>{summary.otPercent}%</span>
              </div>
              <div className="rounded-xl ring-1 ring-[#e8e8e8] bg-white p-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[#999] mb-1">Work Days</p>
                <span className="text-[20px] font-bold text-[#1a1a1a]">{summary.workDays}</span>
              </div>
            </motion.div>
          )}

          {/* ── CSV Export ────────────────────────────── */}
          <div className="rounded-xl ring-1 ring-[#e8e8e8] bg-white p-4">
            <button onClick={() => setShowExport(!showExport)}
              className="flex items-center gap-2 text-[13px] font-medium text-[#1a1a1a] hover:text-[#6b6b6b] transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export Payroll CSV
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                className={`transition-transform ${showExport ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            {showExport && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 pt-3 border-t border-[#f0f0f0]">
                <div className="flex flex-col sm:flex-row gap-3 items-end">
                  <div>
                    <label className="text-[11px] font-medium text-[#999] uppercase tracking-wider block mb-1">Start Date</label>
                    <input type="date" value={exportStart} onChange={(e) => setExportStart(e.target.value)}
                      className="px-3 py-1.5 rounded-lg ring-1 ring-[#e0e0e0] bg-white text-[13px] focus:ring-[#1a1a1a] focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-[#999] uppercase tracking-wider block mb-1">End Date</label>
                    <input type="date" value={exportEnd} onChange={(e) => setExportEnd(e.target.value)}
                      className="px-3 py-1.5 rounded-lg ring-1 ring-[#e0e0e0] bg-white text-[13px] focus:ring-[#1a1a1a] focus:outline-none" />
                  </div>
                  <a href={`/api/staffing/export?startDate=${exportStart}&endDate=${exportEnd}&projectId=${encodeURIComponent(projectId)}`}
                    className="px-4 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors inline-block text-center" download>
                    Download CSV
                  </a>
                </div>
              </motion.div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
