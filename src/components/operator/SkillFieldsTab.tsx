'use client';

import { useState } from 'react';
import type { FieldDef } from '@/app/operator/skills/[skillId]/page';

interface Props {
  fields: FieldDef[];
  setFields: (f: FieldDef[]) => void;
  markDirty: () => void;
}

const FIELD_TYPES = ['string', 'number', 'date', 'enum', 'boolean', 'array'] as const;
const TIERS = [0, 1, 2, 3] as const;
const TIER_LABELS: Record<number, string> = { 0: 'Auto', 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3' };
const IMPORTANCE_OPTIONS = ['P', 'S', 'E', 'A'] as const;
const IMPORTANCE_LABELS: Record<string, string> = { P: 'Primary', S: 'Supporting', E: 'Enabling', A: 'Admin' };
const IMPORTANCE_TOOLTIPS: Record<string, string> = {
  P: 'Primary — critical for analysis and decision-making',
  S: 'Supporting — provides useful context',
  E: 'Enabling — needed for cross-referencing between documents',
  A: 'Admin — identifier or metadata field',
};
const IMPORTANCE_COLORS: Record<string, string> = {
  P: 'bg-[#fecaca] text-[#991b1b]',
  S: 'bg-[#dbeafe] text-[#1e40af]',
  E: 'bg-[#f0f0f0] text-[#666]',
  A: 'bg-[#f5f5f5] text-[#999]',
};

const emptyField: FieldDef = {
  name: '', type: 'string', tier: 1, required: false, description: '', options: [], disambiguationRules: '', importance: 'E',
};

export default function SkillFieldsTab({ fields, setFields, markDirty }: Props) {
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<FieldDef>(emptyField);

  const startAdd = () => {
    setDraft({ ...emptyField });
    setEditIdx(-1);
  };

  const startEdit = (i: number) => {
    setDraft({ ...fields[i] });
    setEditIdx(i);
  };

  const save = () => {
    if (!draft.name.trim()) return;
    const updated = [...fields];
    if (editIdx === -1) {
      updated.push({ ...draft, name: draft.name.trim() });
    } else if (editIdx !== null) {
      updated[editIdx] = { ...draft, name: draft.name.trim() };
    }
    setFields(updated);
    markDirty();
    setEditIdx(null);
  };

  const remove = (i: number) => {
    setFields(fields.filter((_, idx) => idx !== i));
    markDirty();
    if (editIdx === i) setEditIdx(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[16px] font-semibold text-[#1a1a1a]">Field Definitions</h2>
          <p className="text-[13px] text-[#999] mt-0.5">
            Define the data fields Claude should extract for this document type.
          </p>
          <div className="flex items-center gap-3 mt-2">
            {IMPORTANCE_OPTIONS.map(imp => (
              <span key={imp} className="flex items-center gap-1">
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${IMPORTANCE_COLORS[imp]}`}>
                  {IMPORTANCE_LABELS[imp]}
                </span>
                <span className="text-[11px] text-[#bbb]">{IMPORTANCE_TOOLTIPS[imp].split(' — ')[1]}</span>
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={startAdd}
          className="px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors"
        >
          + Add Field
        </button>
      </div>

      {/* Compact table */}
      <div className="border border-[#e8e8e8] rounded-lg overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-[#fafafa] border-b border-[#e8e8e8]">
              <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Data Point</th>
              <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[70px]">Type</th>
              <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[52px]">Tier</th>
              <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[80px]">Imp.</th>
              <th className="text-center px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide w-[36px]">Req</th>
              <th className="text-left px-2 py-2 text-[10px] font-semibold text-[#999] uppercase tracking-wide">Description</th>
              <th className="w-[80px]" />
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              editIdx === i ? (
                <tr key={i}>
                  <td colSpan={7} className="p-3 bg-[#f8faff] border-b border-[#e0e0e0]">
                    <FieldForm draft={draft} setDraft={setDraft} onSave={save} onCancel={() => setEditIdx(null)} />
                  </td>
                </tr>
              ) : (
                <tr
                  key={i}
                  className="border-b border-[#f0f0f0] last:border-b-0 hover:bg-[#fafafa] transition-colors group"
                >
                  <td className="px-3 py-1.5 font-medium text-[#1a1a1a] whitespace-nowrap">{f.name}</td>
                  <td className="px-2 py-1.5 font-mono text-[#888]">{f.type}</td>
                  <td className="px-2 py-1.5 text-[#aaa]">{f.tier === 0 ? 'Auto' : `T${f.tier}`}</td>
                  <td className="px-2 py-1.5">
                    {f.importance && (
                      <span
                        title={IMPORTANCE_TOOLTIPS[f.importance]}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium cursor-help ${IMPORTANCE_COLORS[f.importance]}`}
                      >
                        {IMPORTANCE_LABELS[f.importance]}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {f.required && <span className="text-[#dc2626]">*</span>}
                  </td>
                  <td className="px-2 py-1.5 text-[#999] truncate max-w-[300px]">{f.description}</td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    <button onClick={() => startEdit(i)} className="text-[11px] text-[#007aff] hover:underline mr-2">Edit</button>
                    <button onClick={() => remove(i)} className="text-[11px] text-[#dc2626] hover:underline">Del</button>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>

      {/* Add form */}
      {editIdx === -1 && (
        <div className="border border-[#007aff] rounded-lg p-4 mt-2 bg-[#f8faff]">
          <FieldForm draft={draft} setDraft={setDraft} onSave={save} onCancel={() => setEditIdx(null)} />
        </div>
      )}

      {fields.length === 0 && editIdx === null && (
        <div className="text-center py-12 text-[14px] text-[#999]">
          No fields defined yet. Click &ldquo;Add Field&rdquo; to get started.
        </div>
      )}
    </div>
  );
}

function FieldForm({
  draft, setDraft, onSave, onCancel,
}: {
  draft: FieldDef;
  setDraft: (d: FieldDef) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-3">
        <div>
          <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Name</label>
          <input
            value={draft.name}
            onChange={e => setDraft({ ...draft, name: e.target.value })}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
            placeholder="e.g. contract_value"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Type</label>
          <select
            value={draft.type}
            onChange={e => setDraft({ ...draft, type: e.target.value as FieldDef['type'] })}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff] bg-white"
          >
            {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Tier</label>
          <select
            value={draft.tier}
            onChange={e => setDraft({ ...draft, tier: Number(e.target.value) as 0 | 1 | 2 | 3 })}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff] bg-white"
          >
            {TIERS.map(t => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Importance</label>
          <select
            value={draft.importance || 'E'}
            onChange={e => setDraft({ ...draft, importance: e.target.value as 'P' | 'S' | 'E' | 'A' })}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff] bg-white"
          >
            {IMPORTANCE_OPTIONS.map(imp => <option key={imp} value={imp}>{IMPORTANCE_LABELS[imp]} ({imp})</option>)}
          </select>
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.required}
              onChange={e => setDraft({ ...draft, required: e.target.checked })}
              className="rounded"
            />
            <span className="text-[13px] text-[#666]">Required</span>
          </label>
        </div>
      </div>
      <div>
        <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Description</label>
        <input
          value={draft.description}
          onChange={e => setDraft({ ...draft, description: e.target.value })}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
          placeholder="Help the AI understand what this field contains"
        />
      </div>
      {draft.type === 'enum' && (
        <div>
          <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Options (comma-separated)</label>
          <input
            value={(draft.options || []).join(', ')}
            onChange={e => setDraft({ ...draft, options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
            placeholder="option1, option2, option3"
          />
        </div>
      )}
      <div>
        <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Disambiguation Rules (optional)</label>
        <input
          value={draft.disambiguationRules || ''}
          onChange={e => setDraft({ ...draft, disambiguationRules: e.target.value })}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
          placeholder="Rules for resolving ambiguity when multiple values appear"
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onSave} disabled={!draft.name.trim()} className="px-4 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors disabled:opacity-40">
          Save Field
        </button>
        <button onClick={onCancel} className="px-4 py-1.5 rounded-lg text-[13px] text-[#666] hover:bg-[#f0f0f0] transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}
