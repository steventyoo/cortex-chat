'use client';

import { useState, useEffect, useCallback } from 'react';

interface CatalogField {
  id: string;
  canonical_name: string;
  display_name: string;
  field_type: string;
  category: string;
  description: string;
  enum_options: string[] | null;
}

interface SkillField {
  id: string;
  skill_id: string;
  field_id: string;
  display_override: string | null;
  tier: number;
  required: boolean;
  importance: string | null;
  disambiguation_rules: string | null;
  sort_order: number;
  field_catalog: CatalogField;
}

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

export default function SkillCatalogFieldsTab({ skillId }: Props) {
  const [assignedFields, setAssignedFields] = useState<SkillField[]>([]);
  const [catalogFields, setCatalogFields] = useState<CatalogField[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [adding, setAdding] = useState<string | null>(null);

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
      }
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3 text-[14px] text-[#999]">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Loading catalog fields...
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[16px] font-semibold text-[#1a1a1a]">Catalog Fields</h2>
          <p className="text-[13px] text-[#999] mt-0.5">
            Select fields from the master catalog. These are shared across skills and enable consistent document linking.
          </p>
        </div>
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors"
        >
          {showPicker ? 'Done' : '+ Add from Catalog'}
        </button>
      </div>

      {/* Assigned fields */}
      {assignedFields.length > 0 ? (
        <div className="border border-[#e8e8e8] rounded-lg overflow-hidden mb-4">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-[#fafafa] border-b border-[#e8e8e8]">
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Canonical</th>
                <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Display Override</th>
                <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[80px]">Category</th>
                <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[60px]">Type</th>
                <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[52px]">Tier</th>
                <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[80px]">Imp.</th>
                <th className="text-center px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[36px]">Req</th>
                <th className="w-[60px]" />
              </tr>
            </thead>
            <tbody>
              {assignedFields.map(sf => (
                <tr key={sf.id} className="border-b border-[#f0f0f0] last:border-b-0 hover:bg-[#fafafa] transition-colors">
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
                    <button onClick={() => handleRemove(sf.id)} className="text-[11px] text-[#dc2626] hover:underline">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="border border-dashed border-[#e0e0e0] rounded-lg px-6 py-8 text-center mb-4">
          <p className="text-[13px] text-[#999]">No catalog fields assigned yet.</p>
          <p className="text-[12px] text-[#bbb] mt-1">Click &ldquo;Add from Catalog&rdquo; to select shared fields for this skill.</p>
        </div>
      )}

      {/* Picker */}
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
