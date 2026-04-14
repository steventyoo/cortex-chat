'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface CatalogField {
  id: string;
  canonical_name: string;
  display_name: string;
  field_type: string;
  category: string;
  description: string;
  enum_options: string[] | null;
  usage_count?: number;
  used_by_skills?: { skill_id: string; skill_name: string }[];
}

const CATEGORIES = ['identity', 'financial', 'schedule', 'technical', 'quality', 'admin', 'general'] as const;
const FIELD_TYPES = ['string', 'number', 'date', 'enum', 'boolean', 'array'] as const;

const CATEGORY_COLORS: Record<string, string> = {
  identity: 'bg-[#dbeafe] text-[#1e40af]',
  financial: 'bg-[#dcfce7] text-[#166534]',
  schedule: 'bg-[#fef3c7] text-[#92400e]',
  technical: 'bg-[#f3e8ff] text-[#6b21a8]',
  quality: 'bg-[#fecaca] text-[#991b1b]',
  admin: 'bg-[#f0f0f0] text-[#666]',
  general: 'bg-[#f5f5f5] text-[#999]',
};

export default function FieldCatalogPage() {
  const [fields, setFields] = useState<CatalogField[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CatalogField | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [usagePopover, setUsagePopover] = useState<string | null>(null);

  const fetchFields = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/field-catalog?withUsage=true&withDetails=true');
      const data = await res.json();
      setFields(data.fields || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchFields(); }, [fetchFields]);

  const handleDelete = async (field: CatalogField) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/field-catalog?id=${field.id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchFields();
        setDeleteTarget(null);
      }
    } catch { /* ignore */ }
    setDeleting(false);
  };

  const filtered = fields.filter(f => {
    if (filter !== 'all' && f.category !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return f.canonical_name.includes(q) || f.display_name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q);
    }
    return true;
  });

  const grouped = new Map<string, CatalogField[]>();
  for (const f of filtered) {
    const cat = f.category;
    const existing = grouped.get(cat) || [];
    existing.push(f);
    grouped.set(cat, existing);
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="border-b border-[#e8e8e8] bg-[#fafafa]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center h-12 gap-4">
            <Link href="/operator/skills" className="text-[13px] text-[#999] hover:text-[#666] transition-colors">
              Skills
            </Link>
            <span className="text-[#ddd]">/</span>
            <span className="text-[14px] font-semibold text-[#1a1a1a]">Field Catalog</span>
            <span className="text-[12px] text-[#999]">{fields.length} fields</span>
            <div className="flex-1" />
            <button
              onClick={() => { setShowAdd(true); setEditId(null); }}
              className="px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors"
            >
              + New Field
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] w-64 focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
            placeholder="Search fields..."
          />
          <div className="flex gap-1 p-0.5 bg-[#f5f5f5] rounded-lg">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                filter === 'all' ? 'bg-white shadow-sm text-[#1a1a1a]' : 'text-[#999] hover:text-[#666]'
              }`}
            >
              All
            </button>
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors capitalize ${
                  filter === cat ? 'bg-white shadow-sm text-[#1a1a1a]' : 'text-[#999] hover:text-[#666]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex items-center gap-3 text-[14px] text-[#999]">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Loading field catalog...
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {[...grouped.entries()].map(([cat, catFields]) => (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wide ${CATEGORY_COLORS[cat]}`}>
                    {cat}
                  </span>
                  <span className="text-[12px] text-[#bbb]">{catFields.length} fields</span>
                </div>
                <div className="border border-[#e8e8e8] rounded-lg overflow-hidden">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="bg-[#fafafa] border-b border-[#e8e8e8]">
                        <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[200px]">Canonical Name</th>
                        <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[200px]">Display Name</th>
                        <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[70px]">Type</th>
                        <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Description</th>
                        <th className="text-center px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[70px]">Used By</th>
                        <th className="w-[100px]" />
                      </tr>
                    </thead>
                    <tbody>
                      {catFields.map(f => (
                        <tr key={f.id} className="border-b border-[#f0f0f0] last:border-b-0 hover:bg-[#fafafa] transition-colors">
                          <td className="px-3 py-1.5 font-mono text-[#1a1a1a] font-medium">{f.canonical_name}</td>
                          <td className="px-2 py-1.5 text-[#555]">{f.display_name}</td>
                          <td className="px-2 py-1.5 font-mono text-[#888]">{f.field_type}</td>
                          <td className="px-2 py-1.5 text-[#999] truncate max-w-[300px]">{f.description}</td>
                          <td className="px-2 py-1.5 text-center relative">
                            {f.usage_count ? (
                              <button
                                onClick={() => setUsagePopover(usagePopover === f.id ? null : f.id)}
                                className="text-[11px] font-medium text-[#007aff] hover:underline cursor-pointer"
                              >
                                {f.usage_count} skill{f.usage_count > 1 ? 's' : ''}
                              </button>
                            ) : (
                              <span className="text-[11px] text-[#ccc]">&mdash;</span>
                            )}
                            {usagePopover === f.id && f.used_by_skills && f.used_by_skills.length > 0 && (
                              <div className="absolute z-30 right-0 top-full mt-1 bg-white border border-[#e0e0e0] rounded-lg shadow-lg py-1.5 px-1 min-w-[180px] text-left">
                                <div className="px-2 py-1 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Used by</div>
                                {f.used_by_skills.map(s => (
                                  <Link
                                    key={s.skill_id}
                                    href={`/operator/skills/${s.skill_id}`}
                                    className="block px-2 py-1 text-[12px] text-[#333] hover:bg-[#f5f5f5] rounded transition-colors truncate"
                                  >
                                    {s.skill_name}
                                  </Link>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right flex items-center justify-end gap-2">
                            <button
                              onClick={() => { setEditId(f.id); setShowAdd(true); }}
                              className="text-[11px] text-[#007aff] hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setDeleteTarget(f)}
                              className="text-[11px] text-[#dc2626] hover:underline"
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

            {filtered.length === 0 && (
              <div className="text-center py-12 text-[14px] text-[#999]">
                No fields match your search.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Click-outside handler for usage popover */}
      {usagePopover && (
        <div className="fixed inset-0 z-20" onClick={() => setUsagePopover(null)} />
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-[420px]" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[#e8e8e8]">
              <h3 className="text-[15px] font-semibold text-[#1a1a1a]">Delete Field</h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-[13px] text-[#555]">
                Are you sure you want to delete <span className="font-mono font-medium text-[#1a1a1a]">{deleteTarget.canonical_name}</span>?
              </p>
              {deleteTarget.usage_count ? (
                <div className="mt-3 px-3 py-2 rounded-lg bg-[#fef3c7] text-[#92400e] text-[12px]">
                  This field is currently used by <strong>{deleteTarget.usage_count} skill{deleteTarget.usage_count > 1 ? 's' : ''}</strong>.
                  Deleting it will remove it from all skills.
                  {deleteTarget.used_by_skills && deleteTarget.used_by_skills.length > 0 && (
                    <ul className="mt-1.5 ml-3 list-disc">
                      {deleteTarget.used_by_skills.map(s => (
                        <li key={s.skill_id}>{s.skill_name}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-[12px] text-[#999]">This field is not used by any skills.</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-[#e8e8e8] flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-[13px] text-[#666] hover:bg-[#f0f0f0] transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg bg-[#dc2626] text-white text-[13px] font-medium hover:bg-[#b91c1c] transition-colors disabled:opacity-40"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAdd && (
        <FieldModal
          field={editId ? fields.find(f => f.id === editId) || null : null}
          onClose={() => { setShowAdd(false); setEditId(null); }}
          onSaved={fetchFields}
        />
      )}
    </div>
  );
}

function FieldModal({
  field,
  onClose,
  onSaved,
}: {
  field: CatalogField | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!field;
  const [canonicalName, setCanonicalName] = useState(field?.canonical_name || '');
  const [displayName, setDisplayName] = useState(field?.display_name || '');
  const [fieldType, setFieldType] = useState(field?.field_type || 'string');
  const [category, setCategory] = useState(field?.category || 'general');
  const [description, setDescription] = useState(field?.description || '');
  const [enumOptions, setEnumOptions] = useState((field?.enum_options || []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const url = '/api/field-catalog';
      const method = isEdit ? 'PATCH' : 'POST';
      const body = isEdit
        ? { id: field!.id, displayName, fieldType, category, description, enumOptions: fieldType === 'enum' ? enumOptions.split(',').map(s => s.trim()).filter(Boolean) : null }
        : { canonicalName, displayName, fieldType, category, description, enumOptions: fieldType === 'enum' ? enumOptions.split(',').map(s => s.trim()).filter(Boolean) : undefined };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to save');
        setSaving(false);
        return;
      }

      onSaved();
      onClose();
    } catch {
      setError('Network error');
    }
    setSaving(false);
  };

  // Auto-generate canonical_name from display_name for new fields
  const handleDisplayNameChange = (val: string) => {
    setDisplayName(val);
    if (!isEdit) {
      setCanonicalName(
        val.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, '_')
          .trim()
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[520px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[#e8e8e8]">
          <h3 className="text-[15px] font-semibold text-[#1a1a1a]">{isEdit ? 'Edit Field' : 'New Catalog Field'}</h3>
          <p className="text-[12px] text-[#999] mt-0.5">
            {isEdit ? 'Update this field definition.' : 'Define a new field that can be used across all skills.'}
          </p>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Display Name</label>
            <input
              value={displayName}
              onChange={e => handleDisplayNameChange(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
              placeholder="e.g. Cost Code"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Canonical Name</label>
            <input
              value={canonicalName}
              onChange={e => !isEdit && setCanonicalName(e.target.value)}
              readOnly={isEdit}
              className={`mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff] ${isEdit ? 'bg-[#f5f5f5] text-[#999]' : ''}`}
              placeholder="e.g. cost_code"
            />
            <p className="text-[11px] text-[#bbb] mt-1">Used internally for linking. Cannot be changed after creation.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Type</label>
              <select
                value={fieldType}
                onChange={e => setFieldType(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff] bg-white"
              >
                {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff] bg-white"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Description</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
              placeholder="What this field represents"
            />
          </div>

          {fieldType === 'enum' && (
            <div>
              <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Enum Options (comma-separated)</label>
              <input
                value={enumOptions}
                onChange={e => setEnumOptions(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
                placeholder="Option 1, Option 2, Option 3"
              />
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded-lg bg-[#fef2f2] text-[#dc2626] text-[12px]">{error}</div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#e8e8e8] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] text-[#666] hover:bg-[#f0f0f0] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !displayName.trim() || !canonicalName.trim()}
            className="px-4 py-2 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors disabled:opacity-40"
          >
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
