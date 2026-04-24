'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface EvalItem {
  id: string;
  org_id: string;
  category: string;
  question: string;
  project_id: string;
  expected_answer: string;
  key_values: Record<string, unknown>;
  expected_tool: string;
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

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
            {tabs.map(t => (
              <Link
                key={t.href}
                href={t.href}
                className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                  pathname === t.href ? 'bg-[#1a1a1a] text-white' : 'text-[#666] hover:bg-[#eee]'
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}

const CATEGORIES = [
  'Total Fixtures', 'Total Vendors', 'Payroll', 'Budget vs Actual',
  'Costs by Job Code', 'Benchmark KPIs', 'Material',
];

export default function EvalsPage() {
  const [items, setItems] = useState<EvalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<EvalItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EvalItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/eval-items');
      const data = await res.json();
      setItems(data.items || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleDelete = async (item: EvalItem) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/eval-items/${item.id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchItems();
        setDeleteTarget(null);
      }
    } catch { /* ignore */ }
    setDeleting(false);
  };

  const handleToggleActive = async (item: EvalItem) => {
    try {
      await fetch(`/api/eval-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !item.is_active }),
      });
      fetchItems();
    } catch { /* ignore */ }
  };

  const filtered = items.filter(it => {
    if (filter !== 'all' && it.category !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return it.id.toLowerCase().includes(q) || it.question.toLowerCase().includes(q) || it.expected_answer.toLowerCase().includes(q);
    }
    return true;
  });

  const categories = [...new Set(items.map(it => it.category))].sort();

  const grouped = new Map<string, EvalItem[]>();
  for (const it of filtered) {
    const existing = grouped.get(it.category) || [];
    existing.push(it);
    grouped.set(it.category, existing);
  }

  return (
    <div className="min-h-screen bg-white">
      <OperatorNav />

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Sub-nav for Evals section */}
        <div className="flex items-center gap-1 p-0.5 bg-[#f5f5f5] rounded-lg w-fit mb-6">
          <Link
            href="/operator/evals"
            className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors bg-white shadow-sm text-[#1a1a1a]"
          >
            Dataset
          </Link>
          <Link
            href="/operator/evals/results"
            className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors text-[#666] hover:text-[#333]"
          >
            Results
          </Link>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[20px] font-bold text-[#1a1a1a]">Eval Dataset</h1>
            <p className="text-[13px] text-[#999] mt-1">
              {items.length} eval items across {categories.length} categories
            </p>
          </div>
          <button
            onClick={() => { setEditItem(null); setShowAdd(true); }}
            className="px-4 py-2 bg-[#1a1a1a] text-white text-[13px] font-medium rounded-lg hover:bg-[#333] transition-colors"
          >
            + Add Eval Item
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-1 p-0.5 bg-[#f5f5f5] rounded-lg">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                filter === 'all' ? 'bg-white shadow-sm text-[#1a1a1a]' : 'text-[#666] hover:text-[#333]'
              }`}
            >
              All ({items.length})
            </button>
            {categories.map(cat => {
              const count = items.filter(it => it.category === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => setFilter(cat)}
                  className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors whitespace-nowrap ${
                    filter === cat ? 'bg-white shadow-sm text-[#1a1a1a]' : 'text-[#666] hover:text-[#333]'
                  }`}
                >
                  {cat} ({count})
                </button>
              );
            })}
          </div>
          <input
            type="text"
            placeholder="Search questions..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-1.5 border border-[#e8e8e8] rounded-lg text-[13px] w-64 focus:outline-none focus:border-[#999] transition-colors"
          />
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-16 text-[#999] text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[#999] text-sm">No eval items found.</p>
            <p className="text-[#bbb] text-xs mt-1">Click &quot;Add Eval Item&quot; to create one.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {[...grouped.entries()].map(([category, catItems]) => (
              <div key={category}>
                <h3 className="text-[12px] font-semibold text-[#999] uppercase tracking-wider mb-2">{category}</h3>
                <div className="border border-[#e8e8e8] rounded-lg overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="bg-[#fafafa] text-[11px] font-semibold text-[#999] uppercase tracking-wider">
                        <th className="text-left px-4 py-2.5">ID</th>
                        <th className="text-left px-4 py-2.5">Question</th>
                        <th className="text-left px-4 py-2.5">Expected Answer</th>
                        <th className="text-left px-4 py-2.5 w-32">Tool</th>
                        <th className="text-center px-4 py-2.5 w-16">Active</th>
                        <th className="text-center px-4 py-2.5 w-24">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {catItems.map(item => (
                        <tr key={item.id} className="border-t border-[#f0f0f0] hover:bg-[#fafafa]">
                          <td className="px-4 py-2.5 font-mono text-[12px] text-[#666]">{item.id}</td>
                          <td className="px-4 py-2.5 text-[#1a1a1a] max-w-xs truncate" title={item.question}>{item.question}</td>
                          <td className="px-4 py-2.5 text-[#444] max-w-xs truncate" title={item.expected_answer}>{item.expected_answer || <span className="text-[#ccc]">—</span>}</td>
                          <td className="px-4 py-2.5">
                            <span className="px-2 py-0.5 bg-[#f0f0f0] text-[#666] rounded text-[11px] font-medium">
                              {item.expected_tool || '—'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <button
                              onClick={() => handleToggleActive(item)}
                              className={`w-8 h-4.5 rounded-full relative transition-colors ${item.is_active ? 'bg-green-500' : 'bg-[#ddd]'}`}
                            >
                              <span className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${item.is_active ? 'left-[18px]' : 'left-0.5'}`} />
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => { setEditItem(item); setShowAdd(true); }}
                                className="text-[12px] text-[#0066cc] hover:text-[#004499] font-medium"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => setDeleteTarget(item)}
                                className="text-[12px] text-red-500 hover:text-red-700 font-medium"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showAdd && (
        <EvalItemModal
          item={editItem}
          categories={CATEGORIES}
          onClose={() => { setShowAdd(false); setEditItem(null); }}
          onSaved={() => { setShowAdd(false); setEditItem(null); fetchItems(); }}
        />
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-[400px] p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold text-[#1a1a1a] mb-2">Delete eval item?</h3>
            <p className="text-[13px] text-[#666] mb-4">
              This will permanently delete <span className="font-mono font-medium">{deleteTarget.id}</span>. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-[13px] text-[#666] hover:text-[#333] font-medium">Cancel</button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white text-[13px] font-medium rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EvalItemModal({ item, categories, onClose, onSaved }: {
  item: EvalItem | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!item;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [id, setId] = useState(item?.id || '');
  const [category, setCategory] = useState(item?.category || categories[0] || '');
  const [question, setQuestion] = useState(item?.question || '');
  const [projectId, setProjectId] = useState(item?.project_id || '2012-EXXEL-8THAVE');
  const [expectedAnswer, setExpectedAnswer] = useState(item?.expected_answer || '');
  const [keyValuesStr, setKeyValuesStr] = useState(item ? JSON.stringify(item.key_values, null, 2) : '{}');
  const [expectedTool, setExpectedTool] = useState(item?.expected_tool || '');

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    let keyValues: Record<string, unknown> = {};
    try {
      keyValues = JSON.parse(keyValuesStr);
    } catch {
      setError('key_values must be valid JSON');
      setSaving(false);
      return;
    }

    try {
      if (isEdit) {
        const res = await fetch(`/api/eval-items/${item!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category, question, projectId, expectedAnswer, keyValues, expectedTool }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to update');
        }
      } else {
        const res = await fetch('/api/eval-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, category, question, projectId, expectedAnswer, keyValues, expectedTool }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to create');
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[560px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[#e8e8e8]">
          <h3 className="text-[15px] font-semibold text-[#1a1a1a]">{isEdit ? 'Edit Eval Item' : 'Add Eval Item'}</h3>
        </div>

        <div className="px-6 py-4 space-y-4">
          {error && <div className="px-3 py-2 bg-red-50 text-red-600 text-[12px] rounded-lg">{error}</div>}

          {!isEdit && (
            <div>
              <label className="block text-[12px] font-medium text-[#666] mb-1">ID (slug)</label>
              <input
                value={id}
                onChange={e => setId(e.target.value)}
                placeholder="e.g., fixtures-total"
                className="w-full px-3 py-2 border border-[#e8e8e8] rounded-lg text-[13px] focus:outline-none focus:border-[#999]"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-medium text-[#666] mb-1">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2 border border-[#e8e8e8] rounded-lg text-[13px] focus:outline-none focus:border-[#999] bg-white"
              >
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="_custom">Custom...</option>
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#666] mb-1">Project ID</label>
              <input
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                className="w-full px-3 py-2 border border-[#e8e8e8] rounded-lg text-[13px] focus:outline-none focus:border-[#999]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Question</label>
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-[#e8e8e8] rounded-lg text-[13px] focus:outline-none focus:border-[#999] resize-none"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Expected Answer</label>
            <textarea
              value={expectedAnswer}
              onChange={e => setExpectedAnswer(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-[#e8e8e8] rounded-lg text-[13px] focus:outline-none focus:border-[#999] resize-none"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Expected Tool</label>
            <input
              value={expectedTool}
              onChange={e => setExpectedTool(e.target.value)}
              placeholder="e.g., project_overview, jcr_analysis"
              className="w-full px-3 py-2 border border-[#e8e8e8] rounded-lg text-[13px] focus:outline-none focus:border-[#999]"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#666] mb-1">Key Values (JSON)</label>
            <textarea
              value={keyValuesStr}
              onChange={e => setKeyValuesStr(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-[#e8e8e8] rounded-lg text-[12px] font-mono focus:outline-none focus:border-[#999] resize-none"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[#e8e8e8] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-[13px] text-[#666] hover:text-[#333] font-medium">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || (!isEdit && !id) || !question}
            className="px-4 py-2 bg-[#1a1a1a] text-white text-[13px] font-medium rounded-lg hover:bg-[#333] disabled:opacity-50"
          >
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
