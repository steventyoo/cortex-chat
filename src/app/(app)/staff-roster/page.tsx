'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from '@/hooks/useSession';

/* ── Types ────────────────────────────────────────────── */
interface RosterEntry {
  id: string;
  workerName: string;
  role: string;
  email: string;
  mobile: string;
}

const ROLES = ['Foreman', 'Journeyman', 'Apprentice', 'Laborer', 'Helper'];

/* ── Role styling: color + icon ─────────────────────── */
const ROLE_STYLES: Record<string, { color: string; bg: string; avatarBg: string; avatarText: string; icon: React.ReactNode }> = {
  Foreman: {
    color: '#9333ea', bg: '#f3e8ff', avatarBg: '#7c3aed', avatarText: '#fff',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z" /></svg>,
  },
  Journeyman: {
    color: '#2563eb', bg: '#dbeafe', avatarBg: '#3b82f6', avatarText: '#fff',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" /></svg>,
  },
  Apprentice: {
    color: '#0891b2', bg: '#cffafe', avatarBg: '#06b6d4', avatarText: '#fff',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></svg>,
  },
  Laborer: {
    color: '#d97706', bg: '#fef3c7', avatarBg: '#f59e0b', avatarText: '#fff',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22V8M5 12H2a10 10 0 0020 0h-3" /><circle cx="12" cy="5" r="3" /></svg>,
  },
  Helper: {
    color: '#059669', bg: '#d1fae5', avatarBg: '#10b981', avatarText: '#fff',
    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>,
  },
};

const DEFAULT_ROLE_STYLE = { color: '#6b7280', bg: '#f3f4f6', avatarBg: '#9ca3af', avatarText: '#fff', icon: null };

function getRoleStyle(role: string) {
  return ROLE_STYLES[role] || DEFAULT_ROLE_STYLE;
}

/* ── Page ─────────────────────────────────────────────── */
export default function StaffRosterPage() {
  const { user, isAdmin, isLoading: authLoading } = useSession();
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);

  /* Add form */
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('Journeyman');
  const [newEmail, setNewEmail] = useState('');
  const [newMobile, setNewMobile] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  /* Edit */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editMobile, setEditMobile] = useState('');

  /* Delete */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  /* CSV import */
  const [csvDragging, setCsvDragging] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── Fetch roster ───────────────────────────────────── */
  useEffect(() => {
    if (!user || !isAdmin) return;
    fetchRoster();
  }, [user, isAdmin]);

  async function fetchRoster() {
    setLoading(true);
    try {
      const res = await fetch('/api/staffing/roster?scope=org');
      const data = await res.json();
      setRoster(data.roster || []);
    } catch {
      setRoster([]);
    } finally {
      setLoading(false);
    }
  }

  /* ── Add crew member ────────────────────────────────── */
  async function handleAdd() {
    if (!newName.trim()) { setAddError('Name is required'); return; }
    setAddError(null);
    try {
      const res = await fetch('/api/staffing/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerName: newName.trim(), role: newRole, email: newEmail.trim(), mobile: newMobile.trim() }),
      });
      if (res.ok) {
        setNewName(''); setNewRole('Journeyman'); setNewEmail(''); setNewMobile('');
        setShowAdd(false);
        fetchRoster();
      } else {
        const data = await res.json().catch(() => null);
        setAddError(data?.error || `Failed to add (${res.status})`);
      }
    } catch {
      setAddError('Failed to add — check your connection');
    }
  }

  /* ── Edit crew member ───────────────────────────────── */
  function startEdit(entry: RosterEntry) {
    setEditingId(entry.id);
    setEditName(entry.workerName);
    setEditRole(entry.role);
    setEditEmail(entry.email);
    setEditMobile(entry.mobile);
  }

  async function handleSaveEdit() {
    if (!editingId || !editName.trim()) return;
    try {
      await fetch('/api/staffing/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterId: editingId, workerName: editName.trim(), role: editRole, email: editEmail.trim(), mobile: editMobile.trim() }),
      });
      setEditingId(null);
      fetchRoster();
    } catch { /* ignore */ }
  }

  /* ── CSV Import ────────────────────────────────────── */
  async function handleCsvImport(file: File) {
    setCsvImporting(true);
    setCsvResult(null);
    try {
      const text = await file.text();
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        setCsvResult('CSV must have a header row and at least one data row.');
        setCsvImporting(false);
        return;
      }

      const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));
      const nameIdx = header.findIndex((h) => ['name', 'worker', 'employee', 'worker_name', 'workername', 'full name'].includes(h));
      const roleIdx = header.findIndex((h) => ['role', 'position', 'title', 'job title'].includes(h));
      const emailIdx = header.findIndex((h) => ['email', 'e-mail', 'email address'].includes(h));
      const mobileIdx = header.findIndex((h) => ['mobile', 'phone', 'cell', 'phone number', 'mobile number'].includes(h));

      if (nameIdx === -1) {
        setCsvResult('Could not find a "Name" column. Expected: Name, Role, Email, Mobile');
        setCsvImporting(false);
        return;
      }

      let added = 0;
      let skipped = 0;
      const existingNames = new Set(roster.map((r) => r.workerName.toLowerCase()));

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].match(/("([^"]*)"|[^,]*)/g)?.map((c) => c.trim().replace(/^"|"$/g, '')) || [];
        const name = cols[nameIdx]?.trim();
        const role = roleIdx >= 0 ? cols[roleIdx]?.trim() : 'Laborer';
        const email = emailIdx >= 0 ? cols[emailIdx]?.trim() : '';
        const mobile = mobileIdx >= 0 ? cols[mobileIdx]?.trim() : '';

        if (!name) continue;
        if (existingNames.has(name.toLowerCase())) { skipped++; continue; }

        const matchedRole = ROLES.find((r) => r.toLowerCase() === role?.toLowerCase()) || role || 'Laborer';

        const res = await fetch('/api/staffing/roster', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workerName: name, role: matchedRole, email, mobile }),
        });
        if (res.ok) {
          added++;
          existingNames.add(name.toLowerCase());
        }
      }

      setCsvResult(`Imported ${added} crew member${added !== 1 ? 's' : ''}${skipped > 0 ? `, ${skipped} skipped (already exist)` : ''}.`);
      fetchRoster();
    } catch {
      setCsvResult('Failed to parse CSV file.');
    } finally {
      setCsvImporting(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setCsvDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
      handleCsvImport(file);
    } else {
      setCsvResult('Please drop a .csv file.');
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleCsvImport(file);
    e.target.value = '';
  }

  /* ── Remove crew member ─────────────────────────────── */
  async function handleRemove(rosterId: string) {
    try {
      await fetch('/api/staffing/roster', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterId }),
      });
      setConfirmDeleteId(null);
      fetchRoster();
    } catch { /* ignore */ }
  }

  /* ── Loading / Auth ─────────────────────────────────── */
  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[13px] text-[#999]">Loading...</p>
      </div>
    );
  }

  if (!user || !isAdmin) return null;

  /* ── Group roster by role ───────────────────────────── */
  const grouped: Record<string, RosterEntry[]> = {};
  for (const entry of roster) {
    const r = entry.role || 'Other';
    if (!grouped[r]) grouped[r] = [];
    grouped[r].push(entry);
  }
  const roleOrder = [...ROLES, ...Object.keys(grouped).filter((r) => !ROLES.includes(r))];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#f7f7f5]">
      {/* ── Top Bar ──────────────────────────────────── */}
      <div className="bg-white border-b border-[#e8e8e8] px-6 py-4 flex-shrink-0">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-[18px] font-bold text-[#1a1a1a] tracking-[-0.01em]">Staff Roster</h1>
            <p className="text-[12px] text-[#999]">{roster.length} crew member{roster.length !== 1 ? 's' : ''}</p>
          </div>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors flex items-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5V19M5 12H19" />
            </svg>
            Add Member
          </motion.button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* ── Add Form ──────────────────────────────── */}
        <AnimatePresence>
          {showAdd && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mb-6 rounded-xl ring-1 ring-[#e0e0e0] bg-white p-5"
            >
              <h3 className="text-[14px] font-semibold text-[#1a1a1a] mb-3">New Crew Member</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text" placeholder="Full name *" value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  className="px-3 py-2 rounded-lg ring-1 ring-[#e0e0e0] bg-white text-[13px] focus:ring-[#1a1a1a] focus:outline-none"
                  autoFocus
                />
                <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
                  className="px-3 py-2 rounded-lg ring-1 ring-[#e0e0e0] bg-white text-[13px] focus:ring-[#1a1a1a] focus:outline-none">
                  {ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
                </select>
                <input type="email" placeholder="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                  className="px-3 py-2 rounded-lg ring-1 ring-[#e0e0e0] bg-white text-[13px] focus:ring-[#1a1a1a] focus:outline-none" />
                <input type="tel" placeholder="Mobile" value={newMobile} onChange={(e) => setNewMobile(e.target.value)}
                  className="px-3 py-2 rounded-lg ring-1 ring-[#e0e0e0] bg-white text-[13px] focus:ring-[#1a1a1a] focus:outline-none" />
              </div>
              {addError && <p className="text-[12px] text-red-500 mt-2">{addError}</p>}
              <div className="flex gap-2 mt-3">
                <motion.button whileTap={{ scale: 0.97 }} onClick={handleAdd}
                  className="px-4 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333]">Add</motion.button>
                <button onClick={() => { setShowAdd(false); setAddError(null); }}
                  className="px-4 py-1.5 rounded-lg text-[13px] text-[#999] hover:text-[#1a1a1a] hover:bg-[#f0f0f0]">Cancel</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── CSV Import Zone ───────────────────────── */}
        <div
          onDragOver={(e) => { e.preventDefault(); setCsvDragging(true); }}
          onDragLeave={() => setCsvDragging(false)}
          onDrop={handleDrop}
          className={`mb-6 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${csvDragging ? 'border-[#1a1a1a] bg-[#f0f0ef]' : 'border-[#e0e0e0] bg-white'}`}
        >
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileSelect} className="hidden" />
          <svg className="mx-auto mb-2 text-[#ccc]" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {csvImporting ? (
            <p className="text-[13px] text-[#999]">Importing...</p>
          ) : (
            <>
              <p className="text-[13px] text-[#6b6b6b]">
                Drag & drop a CSV file, or{' '}
                <button onClick={() => fileInputRef.current?.click()} className="text-[#1a1a1a] font-medium underline hover:no-underline">browse</button>
              </p>
              <p className="text-[11px] text-[#999] mt-1">CSV columns: Name, Role, Email, Mobile</p>
            </>
          )}
          {csvResult && (
            <p className={`text-[12px] mt-2 ${csvResult.startsWith('Imported') ? 'text-emerald-600' : 'text-red-500'}`}>{csvResult}</p>
          )}
        </div>

        {/* ── Roster Table ──────────────────────────── */}
        {loading ? (
          <p className="text-[13px] text-[#999] text-center py-12">Loading roster...</p>
        ) : roster.length === 0 ? (
          <div className="text-center py-16">
            <svg className="mx-auto mb-3 text-[#ccc]" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
            </svg>
            <h3 className="text-[16px] font-semibold text-[#1a1a1a] mb-1">No crew members</h3>
            <p className="text-[13px] text-[#999]">Click &quot;Add Member&quot; or drop a CSV to build your roster.</p>
          </div>
        ) : (
          <div className="rounded-xl ring-1 ring-[#e0e0e0] overflow-hidden bg-white">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-[#f7f7f5] border-b border-[#e0e0e0]">
                  <th className="text-left px-5 py-2.5 font-semibold text-[#1a1a1a]">Name</th>
                  <th className="text-left px-5 py-2.5 font-semibold text-[#1a1a1a]">Position</th>
                  <th className="text-left px-5 py-2.5 font-semibold text-[#1a1a1a]">Email</th>
                  <th className="text-left px-5 py-2.5 font-semibold text-[#1a1a1a]">Mobile</th>
                  <th className="text-right px-5 py-2.5 font-semibold text-[#1a1a1a] w-[120px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {roleOrder.map((role) => {
                  const members = grouped[role];
                  if (!members || members.length === 0) return null;
                  return members.map((entry, idx) => (
                    <tr key={entry.id} className={`border-b border-[#f0f0f0] ${idx % 2 === 1 ? 'bg-[#fafafa]' : 'bg-white'} hover:bg-[#f5f5f3] transition-colors`}>
                      {editingId === entry.id ? (
                        <>
                          <td className="px-4 py-1.5">
                            <input value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                              className="w-full px-2 py-1 rounded-md ring-1 ring-[#e0e0e0] text-[13px] focus:ring-[#1a1a1a] focus:outline-none" autoFocus />
                          </td>
                          <td className="px-4 py-1.5">
                            <select value={editRole} onChange={(e) => setEditRole(e.target.value)}
                              className="px-2 py-1 rounded-md ring-1 ring-[#e0e0e0] text-[13px] focus:ring-[#1a1a1a] focus:outline-none">
                              {ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
                            </select>
                          </td>
                          <td className="px-4 py-1.5">
                            <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)}
                              className="w-full px-2 py-1 rounded-md ring-1 ring-[#e0e0e0] text-[13px] focus:ring-[#1a1a1a] focus:outline-none" placeholder="Email" />
                          </td>
                          <td className="px-4 py-1.5">
                            <input value={editMobile} onChange={(e) => setEditMobile(e.target.value)}
                              className="w-full px-2 py-1 rounded-md ring-1 ring-[#e0e0e0] text-[13px] focus:ring-[#1a1a1a] focus:outline-none" placeholder="Mobile" />
                          </td>
                          <td className="px-5 py-1.5 text-right">
                            <button onClick={handleSaveEdit} className="text-[12px] text-emerald-600 font-medium mr-2 hover:underline">Save</button>
                            <button onClick={() => setEditingId(null)} className="text-[12px] text-[#999] hover:underline">Cancel</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                                style={{ backgroundColor: getRoleStyle(entry.role).avatarBg, color: getRoleStyle(entry.role).avatarText }}>
                                {entry.workerName.charAt(0).toUpperCase()}
                              </div>
                              <span className="font-medium text-[#1a1a1a]">{entry.workerName}</span>
                            </div>
                          </td>
                          <td className="px-5 py-2.5">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium"
                              style={{ backgroundColor: getRoleStyle(entry.role).bg, color: getRoleStyle(entry.role).color }}>
                              {getRoleStyle(entry.role).icon}
                              {entry.role}
                            </span>
                          </td>
                          <td className="px-5 py-2.5 text-[#6b6b6b]">{entry.email || '—'}</td>
                          <td className="px-5 py-2.5 text-[#6b6b6b]">{entry.mobile || '—'}</td>
                          <td className="px-5 py-2.5 text-right">
                            <button onClick={() => startEdit(entry)} className="text-[12px] text-[#999] hover:text-[#1a1a1a] mr-3 transition-colors">Edit</button>
                            {confirmDeleteId === entry.id ? (
                              <>
                                <button onClick={() => handleRemove(entry.id)} className="text-[12px] text-red-600 font-medium mr-1 hover:underline">Remove</button>
                                <button onClick={() => setConfirmDeleteId(null)} className="text-[12px] text-[#999] hover:underline">No</button>
                              </>
                            ) : (
                              <button onClick={() => setConfirmDeleteId(entry.id)} className="text-[12px] text-[#999] hover:text-red-600 transition-colors">Remove</button>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  ));
                })}
              </tbody>
            </table>
            <div className="px-5 py-2.5 bg-[#f7f7f5] border-t border-[#e0e0e0] text-[12px] text-[#999]">
              {roster.length} crew member{roster.length !== 1 ? 's' : ''}
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
