'use client';

import { useState } from 'react';

interface FewShotExample {
  inputSnippet: string;
  expectedOutput: Record<string, unknown>;
}

interface Props {
  sampleExtractions: FewShotExample[];
  setSampleExtractions: (v: FewShotExample[]) => void;
  markDirty: () => void;
}

export default function SkillFewShotTab({ sampleExtractions, setSampleExtractions, markDirty }: Props) {
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [snippet, setSnippet] = useState('');
  const [outputJson, setOutputJson] = useState('');
  const [jsonError, setJsonError] = useState('');

  const startAdd = () => {
    setSnippet('');
    setOutputJson('{\n  \n}');
    setJsonError('');
    setEditIdx(-1);
  };

  const startEdit = (i: number) => {
    const ex = sampleExtractions[i];
    setSnippet(ex.inputSnippet);
    setOutputJson(JSON.stringify(ex.expectedOutput, null, 2));
    setJsonError('');
    setEditIdx(i);
  };

  const save = () => {
    try {
      const parsed = JSON.parse(outputJson);
      const updated = [...sampleExtractions];
      const example = { inputSnippet: snippet, expectedOutput: parsed };
      if (editIdx === -1) {
        updated.push(example);
      } else if (editIdx !== null) {
        updated[editIdx] = example;
      }
      setSampleExtractions(updated);
      markDirty();
      setEditIdx(null);
      setJsonError('');
    } catch {
      setJsonError('Invalid JSON');
    }
  };

  const remove = (i: number) => {
    setSampleExtractions(sampleExtractions.filter((_, idx) => idx !== i));
    markDirty();
    if (editIdx === i) setEditIdx(null);
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[16px] font-semibold text-[#1a1a1a]">Few-shot Examples</h2>
          <p className="text-[13px] text-[#999] mt-0.5">
            Provide input/output pairs to teach the AI extraction patterns for this document type.
          </p>
        </div>
        <button
          onClick={startAdd}
          className="px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors"
        >
          + Add Example
        </button>
      </div>

      <div className="space-y-3">
        {sampleExtractions.map((ex, i) => (
          <div key={i} className={`border rounded-lg p-4 ${editIdx === i ? 'border-[#007aff] bg-[#f8faff]' : 'border-[#e8e8e8]'}`}>
            {editIdx === i ? (
              <ExampleForm
                snippet={snippet} setSnippet={setSnippet}
                outputJson={outputJson} setOutputJson={setOutputJson}
                jsonError={jsonError}
                onSave={save} onCancel={() => setEditIdx(null)}
              />
            ) : (
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-[#999] uppercase tracking-wide mb-1">Input Snippet</p>
                    <pre className="text-[12px] text-[#555] bg-[#f8f8f8] rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-32">
                      {ex.inputSnippet.length > 300 ? ex.inputSnippet.slice(0, 300) + '...' : ex.inputSnippet}
                    </pre>
                    <p className="text-[12px] font-medium text-[#999] uppercase tracking-wide mb-1 mt-3">Expected Output</p>
                    <pre className="text-[12px] text-[#555] bg-[#f8f8f8] rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-32 font-mono">
                      {JSON.stringify(ex.expectedOutput, null, 2).slice(0, 500)}
                    </pre>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => startEdit(i)} className="text-[12px] text-[#007aff] hover:underline">Edit</button>
                    <button onClick={() => remove(i)} className="text-[12px] text-[#dc2626] hover:underline">Remove</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {editIdx === -1 && (
        <div className="border border-[#007aff] rounded-lg p-4 mt-3 bg-[#f8faff]">
          <ExampleForm
            snippet={snippet} setSnippet={setSnippet}
            outputJson={outputJson} setOutputJson={setOutputJson}
            jsonError={jsonError}
            onSave={save} onCancel={() => setEditIdx(null)}
          />
        </div>
      )}

      {sampleExtractions.length === 0 && editIdx === null && (
        <div className="text-center py-12 text-[14px] text-[#999]">
          No examples yet. Few-shot examples significantly improve extraction accuracy.
        </div>
      )}
    </div>
  );
}

function ExampleForm({
  snippet, setSnippet, outputJson, setOutputJson, jsonError, onSave, onCancel,
}: {
  snippet: string; setSnippet: (v: string) => void;
  outputJson: string; setOutputJson: (v: string) => void;
  jsonError: string;
  onSave: () => void; onCancel: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Input Snippet</label>
        <textarea
          value={snippet}
          onChange={e => setSnippet(e.target.value)}
          rows={5}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff] resize-y"
          placeholder="Paste a representative text snippet from this document type..."
        />
      </div>
      <div>
        <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Expected Output (JSON)</label>
        <textarea
          value={outputJson}
          onChange={e => setOutputJson(e.target.value)}
          rows={8}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff] resize-y"
          placeholder='{ "contract_value": { "value": 125000, "confidence": 0.95 } }'
        />
        {jsonError && <p className="text-[11px] text-[#dc2626] mt-1">{jsonError}</p>}
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} disabled={!snippet.trim()} className="px-4 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors disabled:opacity-40">
          Save Example
        </button>
        <button onClick={onCancel} className="px-4 py-1.5 rounded-lg text-[13px] text-[#666] hover:bg-[#f0f0f0] transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}
