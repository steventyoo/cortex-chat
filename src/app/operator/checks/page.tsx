'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ConsistencyCheck } from '@/lib/schemas/consistency-checks.schema';

function OperatorNav() {
  const pathname = usePathname();
  const tabs = [
    { label: 'Skills', href: '/operator/skills' },
    { label: 'Field Catalog', href: '/operator/fields' },
    { label: 'Doc Links', href: '/operator/doc-links' },
    { label: 'Chat Tools', href: '/operator/chat-tools' },
    { label: 'Context Cards', href: '/operator/context-cards' },
    { label: 'Evals', href: '/operator/evals' },
    { label: 'Derived Fields', href: '/operator/derived-fields' },
    { label: 'Checks', href: '/operator/checks' },
    { label: 'Parsers', href: '/operator/parsers' },
  ];
  return (
    <nav className="border-b border-[#e8e8e8] bg-[#fafafa]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center h-12 gap-8">
          <Link href="/operator/skills" className="text-[15px] font-semibold text-[#1a1a1a] tracking-tight">Operator Workbench</Link>
          <div className="flex items-center gap-1">
            {tabs.map(tab => (
              <Link key={tab.href} href={tab.href} className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${pathname.startsWith(tab.href) ? 'bg-[#1a1a1a] text-white' : 'text-[#6b6b6b] hover:text-[#1a1a1a] hover:bg-[#f0f0f0]'}`}>{tab.label}</Link>
            ))}
          </div>
          <div className="flex-1" />
          <Link href="/" className="text-[12px] text-[#999] hover:text-[#666] transition-colors">← Back to App</Link>
        </div>
      </div>
    </nav>
  );
}

const TIER_COLORS: Record<number, string> = {
  1: 'bg-red-50 text-red-700 border-red-200',
  2: 'bg-orange-50 text-orange-700 border-orange-200',
  3: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  4: 'bg-blue-50 text-blue-700 border-blue-200',
};

const CLASS_COLORS: Record<string, string> = {
  extraction_error: 'bg-purple-50 text-purple-700 border-purple-200',
  document_anomaly: 'bg-amber-50 text-amber-700 border-amber-200',
};

export default function ChecksPage() {
  const [checks, setChecks] = useState<ConsistencyCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterSkill, setFilterSkill] = useState('all');
  const [filterTier, setFilterTier] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingCheck, setEditingCheck] = useState<ConsistencyCheck | null>(null);
  const [showModal, setShowModal] = useState(false);

  const fetchChecks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/consistency-checks');
      const data = await res.json();
      setChecks(data.checks || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchChecks(); }, [fetchChecks]);

  const skills = [...new Set(checks.map(c => c.skill_id))].sort();
  const tiers = [...new Set(checks.map(c => c.tier))].sort();

  const filtered = checks.filter(c => {
    if (filterSkill !== 'all' && c.skill_id !== filterSkill) return false;
    if (filterTier !== 'all' && c.tier !== Number(filterTier)) return false;
    if (search) {
      const q = search.toLowerCase();
      return c.display_name.toLowerCase().includes(q) || c.check_name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q);
    }
    return true;
  });

  const grouped = new Map<number, ConsistencyCheck[]>();
  for (const c of filtered) {
    if (!grouped.has(c.tier)) grouped.set(c.tier, []);
    grouped.get(c.tier)!.push(c);
  }

  async function toggleActive(check: ConsistencyCheck) {
    await fetch('/api/consistency-checks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: check.id, is_active: !check.is_active }),
    });
    fetchChecks();
  }

  async function deleteCheck(check: ConsistencyCheck) {
    if (!confirm(`Delete "${check.display_name}"?`)) return;
    await fetch('/api/consistency-checks', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: check.id }),
    });
    fetchChecks();
  }

  const activeCount = checks.filter(c => c.is_active).length;
  const extractionCount = checks.filter(c => c.classification === 'extraction_error').length;
  const anomalyCount = checks.filter(c => c.classification === 'document_anomaly').length;

  return (
    <div className="min-h-screen bg-white">
      <OperatorNav />
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-bold text-[#1a1a1a]">Consistency Checks</h1>
            <p className="text-[13px] text-[#999] mt-1">
              {checks.length} checks ({activeCount} active) &middot; {extractionCount} extraction errors, {anomalyCount} document anomalies
            </p>
          </div>
          <button
            onClick={() => { setEditingCheck(null); setShowModal(true); }}
            className="px-4 py-2 text-[13px] font-medium bg-[#1a1a1a] text-white rounded-lg hover:bg-[#333] transition-colors"
          >
            + Add Check
          </button>
        </div>

        <div className="flex items-center gap-4 mb-5">
          <input
            type="text" placeholder="Search checks..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg w-64 focus:outline-none focus:border-[#999]"
          />
          <select value={filterSkill} onChange={e => setFilterSkill(e.target.value)} className="px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]">
            <option value="all">All Skills</option>
            {skills.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterTier} onChange={e => setFilterTier(e.target.value)} className="px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]">
            <option value="all">All Tiers</option>
            {tiers.map(t => <option key={t} value={t}>Tier {t}</option>)}
          </select>
          <span className="text-[12px] text-[#999]">{filtered.length} shown</span>
        </div>

        {loading ? (
          <div className="text-[13px] text-[#999] py-12 text-center">Loading...</div>
        ) : (
          <div className="space-y-6">
            {[...grouped.entries()].sort(([a], [b]) => a - b).map(([tier, items]) => (
              <div key={tier}>
                <div className="text-[12px] font-semibold text-[#999] uppercase tracking-wider mb-2">
                  Tier {tier} &middot; {items.length} check{items.length !== 1 ? 's' : ''}
                </div>
                <div className="border border-[#e8e8e8] rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-[#fafafa] border-b border-[#e8e8e8]">
                        <th className="text-left px-4 py-2 text-[11px] font-semibold text-[#999] uppercase w-8"></th>
                        <th className="text-left px-4 py-2 text-[11px] font-semibold text-[#999] uppercase">Check</th>
                        <th className="text-left px-4 py-2 text-[11px] font-semibold text-[#999] uppercase">Classification</th>
                        <th className="text-left px-4 py-2 text-[11px] font-semibold text-[#999] uppercase">Scope</th>
                        <th className="text-left px-4 py-2 text-[11px] font-semibold text-[#999] uppercase">Affected Fields</th>
                        <th className="text-left px-4 py-2 text-[11px] font-semibold text-[#999] uppercase">Active</th>
                        <th className="text-right px-4 py-2 text-[11px] font-semibold text-[#999] uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(c => (
                        <>
                          <tr key={c.id} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa] cursor-pointer" onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}>
                            <td className="px-4 py-2.5 text-[11px] text-[#999]">{expandedId === c.id ? '▼' : '▶'}</td>
                            <td className="px-4 py-2.5">
                              <div className="text-[13px] font-medium text-[#1a1a1a]">{c.display_name}</div>
                              <div className="text-[11px] text-[#999] font-mono">{c.check_name}</div>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${CLASS_COLORS[c.classification] || ''}`}>
                                {c.classification === 'extraction_error' ? 'Extraction Error' : 'Doc Anomaly'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-[12px] text-[#666]">{c.scope}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {c.affected_fields.slice(0, 3).map(f => (
                                  <span key={f} className="text-[10px] font-mono bg-[#f5f5f5] text-[#666] px-1.5 py-0.5 rounded">{f}</span>
                                ))}
                                {c.affected_fields.length > 3 && (
                                  <span className="text-[10px] text-[#999]">+{c.affected_fields.length - 3}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                              <button onClick={() => toggleActive(c)} className={`w-8 h-4.5 rounded-full relative transition-colors ${c.is_active ? 'bg-green-500' : 'bg-gray-300'}`}>
                                <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${c.is_active ? 'left-4' : 'left-0.5'}`} />
                              </button>
                            </td>
                            <td className="px-4 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                              <button onClick={() => { setEditingCheck(c); setShowModal(true); }} className="text-[12px] text-[#4f8ff7] hover:text-[#2d6fd4] mr-3">Edit</button>
                              <button onClick={() => deleteCheck(c)} className="text-[12px] text-[#e55] hover:text-[#c33]">Delete</button>
                            </td>
                          </tr>
                          {expandedId === c.id && (
                            <tr key={`${c.id}-detail`} className="bg-[#fafafa]">
                              <td colSpan={7} className="px-8 py-4">
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <div className="text-[11px] font-semibold text-[#999] uppercase mb-1">Description</div>
                                    <div className="text-[12px] text-[#444]">{c.description || '—'}</div>
                                  </div>
                                  <div>
                                    <div className="text-[11px] font-semibold text-[#999] uppercase mb-1">Hint Template</div>
                                    <div className="text-[12px] text-[#444] font-mono">{c.hint_template || '—'}</div>
                                  </div>
                                  <div className="col-span-2">
                                    <div className="text-[11px] font-semibold text-[#999] uppercase mb-1">Expression</div>
                                    <pre className="text-[11px] text-[#444] font-mono bg-[#f0f0f0] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{c.expression}</pre>
                                  </div>
                                  <div>
                                    <div className="text-[11px] font-semibold text-[#999] uppercase mb-1">Tolerance</div>
                                    <div className="text-[12px] text-[#444]">{c.tolerance_abs}</div>
                                  </div>
                                  <div>
                                    <div className="text-[11px] font-semibold text-[#999] uppercase mb-1">All Affected Fields</div>
                                    <div className="flex flex-wrap gap-1">
                                      {c.affected_fields.map(f => (
                                        <span key={f} className="text-[10px] font-mono bg-[#f0f0f0] text-[#444] px-1.5 py-0.5 rounded">{f}</span>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {grouped.size === 0 && (
              <div className="text-[13px] text-[#999] py-12 text-center">No consistency checks found.</div>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <CheckModal
          check={editingCheck}
          skills={skills}
          onClose={() => { setShowModal(false); setEditingCheck(null); }}
          onSaved={() => { setShowModal(false); setEditingCheck(null); fetchChecks(); }}
        />
      )}
    </div>
  );
}

function CheckModal({ check, skills, onClose, onSaved }: { check: ConsistencyCheck | null; skills: string[]; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!check;
  const [form, setForm] = useState({
    skill_id: check?.skill_id || (skills[0] || ''),
    check_name: check?.check_name || '',
    display_name: check?.display_name || '',
    description: check?.description || '',
    tier: check?.tier || 1,
    classification: check?.classification || 'extraction_error',
    scope: check?.scope || 'doc',
    expression: check?.expression || '',
    tolerance_abs: check?.tolerance_abs ?? 0.01,
    affected_fields: check?.affected_fields?.join(', ') || '',
    hint_template: check?.hint_template || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const payload = {
      ...form,
      affected_fields: form.affected_fields ? form.affected_fields.split(',').map(s => s.trim()).filter(Boolean) : [],
      hint_template: form.hint_template || null,
      description: form.description || null,
      ...(isEdit ? { id: check!.id } : {}),
    };
    try {
      const res = await fetch('/api/consistency-checks', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <form onClick={e => e.stopPropagation()} onSubmit={handleSubmit} className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-[18px] font-bold text-[#1a1a1a] mb-4">{isEdit ? 'Edit' : 'Add'} Consistency Check</h2>
        {error && <div className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Check Name</label>
            <input className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]" value={form.check_name} onChange={e => setForm(f => ({ ...f, check_name: e.target.value }))} placeholder="e.g. budget_minus_cost_equals_variance" required />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Display Name</label>
            <input className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]" value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} placeholder="e.g. Budget - Cost = Variance" required />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Skill</label>
            <input className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]" value={form.skill_id} onChange={e => setForm(f => ({ ...f, skill_id: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Tier</label>
            <select className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]" value={form.tier} onChange={e => setForm(f => ({ ...f, tier: Number(e.target.value) }))}>
              <option value={1}>Tier 1 — Self-consistency</option>
              <option value={2}>Tier 2 — Cross-check</option>
              <option value={3}>Tier 3 — Structural</option>
              <option value={4}>Tier 4 — Reasonableness</option>
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Classification</label>
            <select className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]" value={form.classification} onChange={e => setForm(f => ({ ...f, classification: e.target.value as 'extraction_error' | 'document_anomaly' }))}>
              <option value="extraction_error">Extraction Error</option>
              <option value="document_anomaly">Document Anomaly</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Scope</label>
            <select className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]" value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))}>
              <option value="doc">doc (once per document)</option>
              <option value="cost_code">cost_code (per row)</option>
              <option value="worker">worker (per row)</option>
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Tolerance (abs)</label>
            <input type="number" step="0.01" className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]" value={form.tolerance_abs} onChange={e => setForm(f => ({ ...f, tolerance_abs: Number(e.target.value) }))} />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-[12px] font-medium text-[#666] mb-1">Description</label>
          <input className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What does this check verify?" />
        </div>

        <div className="mb-4">
          <label className="block text-[12px] font-medium text-[#666] mb-1">Expression (JavaScript)</label>
          <textarea className="w-full px-3 py-2 text-[12px] font-mono border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999] h-28" value={form.expression} onChange={e => setForm(f => ({ ...f, expression: e.target.value }))} required />
          <p className="text-[11px] text-[#999] mt-1">
            Must return <code className="bg-[#f5f5f5] px-1 rounded">{'{ pass: boolean, expected?, actual?, delta?, message? }'}</code>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Affected Fields (comma-separated)</label>
            <input className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]" value={form.affected_fields} onChange={e => setForm(f => ({ ...f, affected_fields: e.target.value }))} placeholder="e.g. total_revised_budget, total_jtd_cost" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Hint Template</label>
            <input className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]" value={form.hint_template} onChange={e => setForm(f => ({ ...f, hint_template: e.target.value }))} placeholder="e.g. Expected {{expected}}" />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-[13px] text-[#666] hover:text-[#333]">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-[13px] font-medium bg-[#1a1a1a] text-white rounded-lg hover:bg-[#333] disabled:opacity-50">
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
