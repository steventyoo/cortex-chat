'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CatalogField, SkillField } from '@/lib/schemas/field-catalog.schema';
import type { FieldImportance } from '@/lib/schemas/enums';

interface Props {
  skillId: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  identity: 'bg-[#dbeafe] text-[#1e40af]',
  financial: 'bg-[#dcfce7] text-[#166534]',
  schedule: 'bg-[#fef3c7] text-[#92400e]',
  technical: 'bg-[#f3e8ff] text-[#6b21a8]',
  quality: 'bg-[#fecaca] text-[#991b1b]',
  admin: 'bg-[#f0f0f0] text-[#666]',
  general: 'bg-[#f5f5f5] text-[#999]',
};

const IMPORTANCE_LABELS: Record<string, string> = { P: 'Primary', S: 'Supporting', E: 'Enabling', A: 'Admin' };
const IMPORTANCE_OPTIONS = [
  { value: 'P', label: 'Primary' },
  { value: 'S', label: 'Supporting' },
  { value: 'E', label: 'Enabling' },
  { value: 'A', label: 'Admin' },
];

export default function SkillCatalogFieldsTab({ skillId }: Props) {
  const [assignedFields, setAssignedFields] = useState<SkillField[]>([]);
  const [catalogFields, setCatalogFields] = useState<CatalogField[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<SkillField>>({});
  const [saving, setSaving] = useState(false);

  const fetchAssigned = useCallback(async () => {
    try {
      const res = await fetch(`/api/skills/${skillId}/fields`);
      const data = await res.json();
      setAssignedFields(data.fields || []);
    } catch { /* ignore */ }
  }, [skillId]);

  const fetchCatalog = useCallback(async () => {
    try {
      const res = await fetch('/api/field-catalog');
      const data = await res.json();
      setCatalogFields(data.fields || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    Promise.all([fetchAssigned(), fetchCatalog()]).then(() => setLoading(false));
  }, [fetchAssigned, fetchCatalog]);

  const assignedIds = new Set(assignedFields.map(f => f.field_id));
  const availableFields = catalogFields.filter(f => !assignedIds.has(f.id));
  const filteredAvailable = pickerSearch
    ? availableFields.filter(f => {
        const q = pickerSearch.toLowerCase();
        return f.canonical_name.includes(q) || f.display_name.toLowerCase().includes(q);
      })
    : availableFields;

  const handleAdd = async (catalogFieldId: string) => {
    setAdding(catalogFieldId);
    try {
      const res = await fetch(`/api/skills/${skillId}/fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldId: catalogFieldId }),
      });
      if (res.ok) {
        await fetchAssigned();
      }
    } catch { /* ignore */ }
    setAdding(null);
  };

  const handleRemove = async (skillFieldId: string) => {
    try {
      const res = await fetch(`/api/skills/${skillId}/fields?id=${skillFieldId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setAssignedFields(prev => prev.filter(f => f.id !== skillFieldId));
        if (editingId === skillFieldId) setEditingId(null);
      }
    } catch { /* ignore */ }
  };

  const startEdit = (sf: SkillField) => {
    setEditingId(sf.id);
    setEditForm({
      display_override: sf.display_override,
      tier: sf.tier,
      required: sf.required,
      importance: sf.importance,
      description: sf.description,
      options: sf.options,
      example: sf.example,
      extraction_hint: sf.extraction_hint,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/skills/${skillId}/fields`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          displayOverride: editForm.display_override,
          tier: editForm.tier,
          required: editForm.required,
          importance: editForm.importance,
          description: editForm.description,
          options: editForm.options,
          example: editForm.example,
          extractionHint: editForm.extraction_hint,
        }),
      });
      if (res.ok) {
        await fetchAssigned();
        setEditingId(null);
        setEditForm({});
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const moveField = async (sf: SkillField, direction: 'up' | 'down') => {
    const idx = assignedFields.findIndex(f => f.id === sf.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= assignedFields.length) return;

    const other = assignedFields[swapIdx];
    await Promise.all([
      fetch(`/api/skills/${skillId}/fields`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sf.id, sortOrder: other.sort_order }),
      }),
      fetch(`/api/skills/${skillId}/fields`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: other.id, sortOrder: sf.sort_order }),
      }),
    ]);
    await fetchAssigned();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3 text-[14px] text-[#999]">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Loading fields...
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[16px] font-semibold text-[#1a1a1a]">Fields</h2>
          <p className="text-[13px] text-[#999] mt-0.5">
            Fields from the master catalog assigned to this skill. These drive extraction prompts, schemas, and document linking.
          </p>
        </div>
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors"
        >
          {showPicker ? 'Done' : '+ Add from Catalog'}
        </button>
      </div>

      {assignedFields.length > 0 ? (
        <div className="border border-[#e8e8e8] rounded-lg overflow-hidden mb-4">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-[#fafafa] border-b border-[#e8e8e8]">
                <th className="w-[32px]" />
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Canonical</th>
                <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Display Name</th>
                <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[80px]">Category</th>
                <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[60px]">Type</th>
                <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[52px]">Tier</th>
                <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[80px]">Imp.</th>
                <th className="text-center px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[36px]">Req</th>
                <th className="w-[100px]" />
              </tr>
            </thead>
            <tbody>
              {assignedFields.map((sf, idx) => (
                <tr key={sf.id} className={`border-b border-[#f0f0f0] last:border-b-0 transition-colors ${editingId === sf.id ? 'bg-[#f8faff]' : 'hover:bg-[#fafafa]'}`}>
                  {editingId === sf.id ? (
                    <td colSpan={9} className="p-4">
                      <div className="grid grid-cols-3 gap-4 mb-4">
                        <div>
                          <label className="block text-[10px] font-semibold text-[#999] uppercase tracking-wide mb-1">Display Override</label>
                          <input
                            value={editForm.display_override || ''}
                            onChange={e => setEditForm(f => ({ ...f, display_override: e.target.value || null }))}
                            className="w-full px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
                            placeholder={sf.field_catalog.display_name}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-[#999] uppercase tracking-wide mb-1">Tier</label>
                          <select
                            value={editForm.tier ?? 1}
                            onChange={e => setEditForm(f => ({ ...f, tier: Number(e.target.value) }))}
                            className="w-full px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20"
                          >
                            <option value={0}>Auto (T0)</option>
                            <option value={1}>Tier 1</option>
                            <option value={2}>Tier 2</option>
                            <option value={3}>Tier 3</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-[#999] uppercase tracking-wide mb-1">Importance</label>
                          <select
                            value={editForm.importance || ''}
                            onChange={e => setEditForm(f => ({ ...f, importance: (e.target.value || null) as FieldImportance | null }))}
                            className="w-full px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20"
                          >
                            <option value="">—</option>
                            {IMPORTANCE_OPTIONS.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="mb-4">
                        <label className="block text-[10px] font-semibold text-[#999] uppercase tracking-wide mb-1">Description</label>
                        <textarea
                          value={editForm.description || ''}
                          onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                          className="w-full px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 resize-none"
                          rows={2}
                          placeholder="Per-skill extraction guidance..."
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-[10px] font-semibold text-[#999] uppercase tracking-wide mb-1">Options (comma-separated)</label>
                          <input
                            value={editForm.options?.join(', ') || ''}
                            onChange={e => {
                              const val = e.target.value;
                              setEditForm(f => ({
                                ...f,
                                options: val ? val.split(',').map(s => s.trim()).filter(Boolean) : null,
                              }));
                            }}
                            className="w-full px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20"
                            placeholder="Option A, Option B, ..."
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-[#999] uppercase tracking-wide mb-1">Example</label>
                          <input
                            value={editForm.example || ''}
                            onChange={e => setEditForm(f => ({ ...f, example: e.target.value }))}
                            className="w-full px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20"
                            placeholder="Example value..."
                          />
                        </div>
                      </div>
                      <div className="mb-4">
                        <label className="block text-[10px] font-semibold text-[#999] uppercase tracking-wide mb-1">Extraction Hint</label>
                        <input
                          value={editForm.extraction_hint || ''}
                          onChange={e => setEditForm(f => ({ ...f, extraction_hint: e.target.value || null }))}
                          className="w-full px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20"
                          placeholder="LLM technique hint for extraction..."
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-[13px] text-[#555]">
                          <input
                            type="checkbox"
                            checked={editForm.required ?? false}
                            onChange={e => setEditForm(f => ({ ...f, required: e.target.checked }))}
                            className="rounded"
                          />
                          Required
                        </label>
                        <div className="flex-1" />
                        <button
                          onClick={cancelEdit}
                          className="px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-[13px] text-[#999] hover:text-[#666] hover:border-[#ccc] transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveEdit}
                          disabled={saving}
                          className="px-4 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors disabled:opacity-40"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </td>
                  ) : (
                    <>
                      <td className="px-1 py-1.5 text-center">
                        <div className="flex flex-col gap-0.5">
                          <button
                            onClick={() => moveField(sf, 'up')}
                            disabled={idx === 0}
                            className="text-[10px] text-[#ccc] hover:text-[#666] disabled:opacity-20"
                            title="Move up"
                          >▲</button>
                          <button
                            onClick={() => moveField(sf, 'down')}
                            disabled={idx === assignedFields.length - 1}
                            className="text-[10px] text-[#ccc] hover:text-[#666] disabled:opacity-20"
                            title="Move down"
                          >▼</button>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[#1a1a1a] font-medium">{sf.field_catalog.canonical_name}</td>
                      <td className="px-2 py-1.5 text-[#555]">{sf.display_override || <span className="text-[#ccc]">{sf.field_catalog.display_name}</span>}</td>
                      <td className="px-2 py-1.5">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[sf.field_catalog.category]}`}>
                          {sf.field_catalog.category}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[#888]">{sf.field_catalog.field_type}</td>
                      <td className="px-2 py-1.5 text-[#aaa]">{sf.tier === 0 ? 'Auto' : `T${sf.tier}`}</td>
                      <td className="px-2 py-1.5 text-[#888]">{sf.importance ? IMPORTANCE_LABELS[sf.importance] : '—'}</td>
                      <td className="px-2 py-1.5 text-center">{sf.required && <span className="text-[#dc2626]">*</span>}</td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <button onClick={() => startEdit(sf)} className="text-[11px] text-[#007aff] hover:underline">Edit</button>
                          <button onClick={() => handleRemove(sf.id)} className="text-[11px] text-[#dc2626] hover:underline">Remove</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="border border-dashed border-[#e0e0e0] rounded-lg px-6 py-8 text-center mb-4">
          <p className="text-[13px] text-[#999]">No fields assigned yet.</p>
          <p className="text-[12px] text-[#bbb] mt-1">Click &ldquo;Add from Catalog&rdquo; to select fields for this skill.</p>
        </div>
      )}

      {showPicker && (
        <div className="border border-[#007aff] rounded-lg p-4 bg-[#f8faff]">
          <div className="flex items-center gap-3 mb-3">
            <input
              value={pickerSearch}
              onChange={e => setPickerSearch(e.target.value)}
              className="px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] w-64 focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
              placeholder="Search catalog fields..."
              autoFocus
            />
            <span className="text-[12px] text-[#999]">{filteredAvailable.length} available</span>
          </div>
          <div className="max-h-[300px] overflow-y-auto space-y-1">
            {filteredAvailable.map(f => (
              <div key={f.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${CATEGORY_COLORS[f.category]}`}>
                    {f.category}
                  </span>
                  <span className="font-mono text-[12px] text-[#1a1a1a] font-medium">{f.canonical_name}</span>
                  <span className="text-[12px] text-[#999] truncate">{f.display_name}</span>
                </div>
                <button
                  onClick={() => handleAdd(f.id)}
                  disabled={adding === f.id}
                  className="text-[11px] text-[#007aff] hover:underline font-medium shrink-0 disabled:opacity-40"
                >
                  {adding === f.id ? 'Adding...' : 'Add'}
                </button>
              </div>
            ))}
            {filteredAvailable.length === 0 && (
              <p className="text-[12px] text-[#999] text-center py-4">
                {pickerSearch ? 'No matching fields.' : 'All catalog fields are already assigned.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
