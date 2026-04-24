'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { DerivedField } from '@/lib/schemas/derived-fields.schema';

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
  ];

  return (
    <nav className="border-b border-[#e8e8e8] bg-[#fafafa]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center h-12 gap-8">
          <Link href="/operator/skills" className="text-[15px] font-semibold text-[#1a1a1a] tracking-tight">
            Operator Workbench
          </Link>
          <div className="flex items-center gap-1">
            {tabs.map(tab => (
              <Link
                key={tab.href}
                href={tab.href}
                className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                  pathname.startsWith(tab.href)
                    ? 'bg-[#1a1a1a] text-white'
                    : 'text-[#6b6b6b] hover:text-[#1a1a1a] hover:bg-[#f0f0f0]'
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </div>
          <div className="flex-1" />
          <Link href="/" className="text-[12px] text-[#999] hover:text-[#666] transition-colors">
            ← Back to App
          </Link>
        </div>
      </div>
    </nav>
  );
}

const SCOPE_COLORS: Record<string, string> = {
  doc: 'bg-blue-50 text-blue-700 border-blue-200',
  cost_code: 'bg-purple-50 text-purple-700 border-purple-200',
  worker: 'bg-amber-50 text-amber-700 border-amber-200',
};

const DATA_TYPE_COLORS: Record<string, string> = {
  currency: 'bg-green-50 text-green-700 border-green-200',
  number: 'bg-sky-50 text-sky-700 border-sky-200',
  percent: 'bg-orange-50 text-orange-700 border-orange-200',
  integer: 'bg-sky-50 text-sky-700 border-sky-200',
  ratio: 'bg-pink-50 text-pink-700 border-pink-200',
  string: 'bg-gray-50 text-gray-700 border-gray-200',
  date: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

export default function DerivedFieldsPage() {
  const [fields, setFields] = useState<DerivedField[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterSkill, setFilterSkill] = useState<string>('all');
  const [filterScope, setFilterScope] = useState<string>('all');
  const [editingField, setEditingField] = useState<DerivedField | null>(null);
  const [showModal, setShowModal] = useState(false);

  const fetchFields = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/derived-fields');
      const data = await res.json();
      setFields(data.fields || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchFields(); }, [fetchFields]);

  const skills = [...new Set(fields.map(f => f.primary_skill_id))].sort();
  const scopes = [...new Set(fields.map(f => f.scope))].sort();

  const filtered = fields.filter(f => {
    if (filterSkill !== 'all' && f.primary_skill_id !== filterSkill) return false;
    if (filterScope !== 'all' && f.scope !== filterScope) return false;
    if (search) {
      const q = search.toLowerCase();
      return f.display_name.toLowerCase().includes(q) ||
        f.canonical_name.toLowerCase().includes(q) ||
        f.formula.toLowerCase().includes(q);
    }
    return true;
  });

  const grouped = new Map<string, DerivedField[]>();
  for (const f of filtered) {
    const key = `${f.tab} / ${f.section}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(f);
  }

  async function toggleActive(field: DerivedField) {
    await fetch('/api/derived-fields', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: field.id, is_active: !field.is_active }),
    });
    fetchFields();
  }

  async function deleteField(field: DerivedField) {
    if (!confirm(`Delete "${field.display_name}"?`)) return;
    await fetch('/api/derived-fields', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: field.id }),
    });
    fetchFields();
  }

  return (
    <div className="min-h-screen bg-white">
      <OperatorNav />
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-bold text-[#1a1a1a]">Derived Fields</h1>
            <p className="text-[13px] text-[#999] mt-1">
              Computed fields evaluated at runtime from extracted data. {fields.length} total, {fields.filter(f => f.is_active).length} active.
            </p>
          </div>
          <button
            onClick={() => { setEditingField(null); setShowModal(true); }}
            className="px-4 py-2 text-[13px] font-medium bg-[#1a1a1a] text-white rounded-lg hover:bg-[#333] transition-colors"
          >
            + Add Derived Field
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 mb-5">
          <input
            type="text"
            placeholder="Search fields..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg w-64 focus:outline-none focus:border-[#999]"
          />
          <select
            value={filterSkill}
            onChange={e => setFilterSkill(e.target.value)}
            className="px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]"
          >
            <option value="all">All Skills</option>
            {skills.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={filterScope}
            onChange={e => setFilterScope(e.target.value)}
            className="px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]"
          >
            <option value="all">All Scopes</option>
            {scopes.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="text-[12px] text-[#999]">{filtered.length} shown</span>
        </div>

        {loading ? (
          <div className="text-[13px] text-[#999] py-12 text-center">Loading...</div>
        ) : (
          <div className="space-y-6">
            {[...grouped.entries()].map(([group, items]) => (
              <div key={group}>
                <div className="text-[12px] font-semibold text-[#999] uppercase tracking-wider mb-2">{group}</div>
                <div className="border border-[#e8e8e8] rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-[#fafafa] border-b border-[#e8e8e8]">
                        <th className="text-left px-4 py-2 text-[11px] font-semibold text-[#999] uppercase">Name</th>
                        <th className="text-left px-4 py-2 text-[11px] font-semibold text-[#999] uppercase">Type</th>
                        <th className="text-left px-4 py-2 text-[11px] font-semibold text-[#999] uppercase">Scope</th>
                        <th className="text-left px-4 py-2 text-[11px] font-semibold text-[#999] uppercase">Formula</th>
                        <th className="text-left px-4 py-2 text-[11px] font-semibold text-[#999] uppercase">Active</th>
                        <th className="text-right px-4 py-2 text-[11px] font-semibold text-[#999] uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(f => (
                        <tr key={f.id} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                          <td className="px-4 py-2.5">
                            <div className="text-[13px] font-medium text-[#1a1a1a]">{f.display_name}</div>
                            <div className="text-[11px] text-[#999] font-mono">{f.canonical_name}</div>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${DATA_TYPE_COLORS[f.data_type] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                              {f.data_type}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${SCOPE_COLORS[f.scope] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                              {f.scope}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="text-[12px] text-[#666] max-w-xs truncate" title={f.formula}>
                              {f.formula}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <button
                              onClick={() => toggleActive(f)}
                              className={`w-8 h-4.5 rounded-full relative transition-colors ${f.is_active ? 'bg-green-500' : 'bg-gray-300'}`}
                            >
                              <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${f.is_active ? 'left-4' : 'left-0.5'}`} />
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              onClick={() => { setEditingField(f); setShowModal(true); }}
                              className="text-[12px] text-[#4f8ff7] hover:text-[#2d6fd4] mr-3"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => deleteField(f)}
                              className="text-[12px] text-[#e55] hover:text-[#c33]"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {grouped.size === 0 && (
              <div className="text-[13px] text-[#999] py-12 text-center">No derived fields found.</div>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <DerivedFieldModal
          field={editingField}
          skills={skills}
          onClose={() => { setShowModal(false); setEditingField(null); }}
          onSaved={() => { setShowModal(false); setEditingField(null); fetchFields(); }}
        />
      )}
    </div>
  );
}

function DerivedFieldModal({
  field,
  skills,
  onClose,
  onSaved,
}: {
  field: DerivedField | null;
  skills: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!field;
  const [form, setForm] = useState({
    canonical_name: field?.canonical_name || '',
    display_name: field?.display_name || '',
    primary_skill_id: field?.primary_skill_id || (skills[0] || ''),
    source_skill_ids: field?.source_skill_ids || [skills[0] || ''],
    tab: field?.tab || '',
    section: field?.section || '',
    data_type: field?.data_type || 'currency',
    status: field?.status || 'Derived',
    scope: field?.scope || 'doc',
    formula: field?.formula || '',
    expression: field?.expression || '',
    depends_on: field?.depends_on?.join(', ') || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const payload = {
      ...form,
      source_skill_ids: Array.isArray(form.source_skill_ids)
        ? form.source_skill_ids
        : [form.primary_skill_id],
      depends_on: form.depends_on ? form.depends_on.split(',').map(s => s.trim()).filter(Boolean) : [],
      ...(isEdit ? { id: field!.id } : {}),
    };

    try {
      const res = await fetch('/api/derived-fields', {
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
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
      >
        <h2 className="text-[18px] font-bold text-[#1a1a1a] mb-4">{isEdit ? 'Edit' : 'Add'} Derived Field</h2>
        {error && <div className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Canonical Name</label>
            <input
              className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]"
              value={form.canonical_name}
              onChange={e => setForm(f => ({ ...f, canonical_name: e.target.value }))}
              placeholder="e.g. labor_cost_per_hour"
              required
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Display Name</label>
            <input
              className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]"
              value={form.display_name}
              onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
              placeholder="e.g. Labor Cost per Hour"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Skill</label>
            <input
              className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]"
              value={form.primary_skill_id}
              onChange={e => setForm(f => ({ ...f, primary_skill_id: e.target.value, source_skill_ids: [e.target.value] }))}
              placeholder="job_cost_report"
              required
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Tab</label>
            <input
              className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]"
              value={form.tab}
              onChange={e => setForm(f => ({ ...f, tab: e.target.value }))}
              placeholder="e.g. Labor"
              required
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Section</label>
            <input
              className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]"
              value={form.section}
              onChange={e => setForm(f => ({ ...f, section: e.target.value }))}
              placeholder="e.g. Summary"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Data Type</label>
            <select
              className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]"
              value={form.data_type}
              onChange={e => setForm(f => ({ ...f, data_type: e.target.value as DerivedField['data_type'] }))}
            >
              {['currency', 'number', 'percent', 'integer', 'ratio', 'string', 'date'].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Scope</label>
            <select
              className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]"
              value={form.scope}
              onChange={e => setForm(f => ({ ...f, scope: e.target.value }))}
            >
              {['doc', 'cost_code', 'worker'].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Status</label>
            <select
              className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]"
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value as DerivedField['status'] }))}
            >
              <option value="Derived">Derived</option>
              <option value="Cross-Ref">Cross-Ref</option>
            </select>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-[12px] font-medium text-[#666] mb-1">Formula (human-readable description)</label>
          <input
            className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]"
            value={form.formula}
            onChange={e => setForm(f => ({ ...f, formula: e.target.value }))}
            placeholder="e.g. Total labor cost divided by total labor hours"
            required
          />
        </div>

        <div className="mb-4">
          <label className="block text-[12px] font-medium text-[#666] mb-1">Expression (JavaScript)</label>
          <textarea
            className="w-full px-3 py-2 text-[12px] font-mono border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999] h-24"
            value={form.expression}
            onChange={e => setForm(f => ({ ...f, expression: e.target.value }))}
            placeholder="e.g. ctx.fields.total_jtd_cost / ctx.fields.total_labor_hours"
            required
          />
          <p className="text-[11px] text-[#999] mt-1">
            Available: <code className="bg-[#f5f5f5] px-1 rounded">ctx.fields.&lt;name&gt;</code>, <code className="bg-[#f5f5f5] px-1 rounded">ctx.collections.&lt;name&gt;</code>, <code className="bg-[#f5f5f5] px-1 rounded">ctx.current</code> (for scoped), <code className="bg-[#f5f5f5] px-1 rounded">rd(n, decimals)</code>
          </p>
        </div>

        <div className="mb-6">
          <label className="block text-[12px] font-medium text-[#666] mb-1">Dependencies (comma-separated canonical names)</label>
          <input
            className="w-full px-3 py-1.5 text-[13px] border border-[#ddd] rounded-lg focus:outline-none focus:border-[#999]"
            value={form.depends_on}
            onChange={e => setForm(f => ({ ...f, depends_on: e.target.value }))}
            placeholder="e.g. total_jtd_cost, total_labor_hours"
          />
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-[13px] text-[#666] hover:text-[#333]">Cancel</button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-[13px] font-medium bg-[#1a1a1a] text-white rounded-lg hover:bg-[#333] disabled:opacity-50"
          >
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
