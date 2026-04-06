'use client';

import { useState } from 'react';

interface Props {
  classifierHints: { description: string; keywords: string[] };
  setClassifierHints: (v: { description: string; keywords: string[] }) => void;
  markDirty: () => void;
}

export default function SkillClassifierTab({ classifierHints, setClassifierHints, markDirty }: Props) {
  const [newKeyword, setNewKeyword] = useState('');

  const addKeyword = () => {
    const kw = newKeyword.trim();
    if (!kw || classifierHints.keywords.includes(kw)) return;
    setClassifierHints({ ...classifierHints, keywords: [...classifierHints.keywords, kw] });
    setNewKeyword('');
    markDirty();
  };

  const removeKeyword = (idx: number) => {
    setClassifierHints({
      ...classifierHints,
      keywords: classifierHints.keywords.filter((_, i) => i !== idx),
    });
    markDirty();
  };

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h2 className="text-[16px] font-semibold text-[#1a1a1a] mb-1">Classifier Hints</h2>
        <p className="text-[13px] text-[#999] mb-4">
          Help the classification model identify this document type. The description and keywords are 
          included in the Haiku classification prompt.
        </p>
      </div>

      <div>
        <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Description</label>
        <textarea
          value={classifierHints.description}
          onChange={e => { setClassifierHints({ ...classifierHints, description: e.target.value }); markDirty(); }}
          rows={3}
          className="mt-1 w-full px-4 py-3 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff] resize-y"
          placeholder="A legal agreement between a general contractor and subcontractor detailing scope, price, and terms..."
        />
      </div>

      <div>
        <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide mb-2 block">Keywords</label>
        <div className="flex flex-wrap gap-2 mb-3">
          {classifierHints.keywords.map((kw, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#f0f0f0] text-[13px] text-[#555]"
            >
              {kw}
              <button
                onClick={() => removeKeyword(i)}
                className="ml-0.5 text-[#ccc] hover:text-[#999] transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newKeyword}
            onChange={e => setNewKeyword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
            className="flex-1 px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
            placeholder="Add keyword..."
          />
          <button
            onClick={addKeyword}
            disabled={!newKeyword.trim()}
            className="px-4 py-2 rounded-lg bg-[#f0f0f0] text-[13px] font-medium text-[#666] hover:bg-[#e8e8e8] transition-colors disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
