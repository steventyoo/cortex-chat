'use client';

import { useState } from 'react';

interface FewShotExample {
  inputSnippet: string;
  expectedOutput: Record<string, unknown>;
}

interface Props {
  systemPrompt: string;
  setSystemPrompt: (v: string) => void;
  extractionInstructions: string;
  setExtractionInstructions: (v: string) => void;
  sampleExtractions: FewShotExample[];
  setSampleExtractions: (v: FewShotExample[]) => void;
  markDirty: () => void;
}

export default function SkillPromptTab({
  systemPrompt, setSystemPrompt,
  extractionInstructions, setExtractionInstructions,
  sampleExtractions, setSampleExtractions,
  markDirty,
}: Props) {
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

  const saveExample = () => {
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

  const removeExample = (i: number) => {
    setSampleExtractions(sampleExtractions.filter((_, idx) => idx !== i));
    markDirty();
    if (editIdx === i) setEditIdx(null);
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h2 className="text-[16px] font-semibold text-[#1a1a1a] mb-1">System Prompt</h2>
        <p className="text-[13px] text-[#999] mb-3">
          The base system prompt sent to Claude for extraction. This defines the AI&apos;s persona and response format.
        </p>
        <textarea
          value={systemPrompt}
          onChange={e => { setSystemPrompt(e.target.value); markDirty(); }}
          rows={16}
          className="w-full px-4 py-3 rounded-lg border border-[#e0e0e0] text-[13px] font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff] resize-y"
          placeholder="You are a construction document data extraction AI..."
        />
        <p className="text-[11px] text-[#ccc] mt-1">{systemPrompt.length} characters</p>
      </div>

      <div>
        <h2 className="text-[16px] font-semibold text-[#1a1a1a] mb-1">Extraction Instructions</h2>
        <p className="text-[13px] text-[#999] mb-3">
          Additional instructions appended to the extraction prompt. Use this for domain-specific rules,
          edge cases, or disambiguation guidance that applies to this document type.
        </p>
        <textarea
          value={extractionInstructions}
          onChange={e => { setExtractionInstructions(e.target.value); markDirty(); }}
          rows={10}
          className="w-full px-4 py-3 rounded-lg border border-[#e0e0e0] text-[13px] font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff] resize-y"
          placeholder="- For subcontract agreements, the contract value is found in Article 4...&#10;- If multiple dates appear, prefer the execution date over the effective date..."
        />
      </div>

      {/* Extraction Examples (merged from Few-shot tab) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-[16px] font-semibold text-[#1a1a1a] mb-0.5">Extraction Examples</h2>
            <p className="text-[13px] text-[#999]">
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
                  onSave={saveExample} onCancel={() => setEditIdx(null)}
                />
              ) : (
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-[#999] uppercase tracking-wide mb-1">Input Snippet</p>
                      <pre className="text-[12px] text-[#555] bg-[#f8f8f8] rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-24">
                        {ex.inputSnippet.length > 200 ? ex.inputSnippet.slice(0, 200) + '...' : ex.inputSnippet}
                      </pre>
                      <p className="text-[12px] font-medium text-[#999] uppercase tracking-wide mb-1 mt-3">Expected Output</p>
                      <div className="border border-[#e8e8e8] rounded-md overflow-hidden">
                        {Object.entries(ex.expectedOutput).map(([key, val], j) => (
                          <div key={key} className={`flex items-center px-3 py-1.5 text-[12px] ${j > 0 ? 'border-t border-[#f0f0f0]' : ''}`}>
                            <span className="w-[160px] text-[#999] font-medium truncate flex-shrink-0">{key}</span>
                            <span className="flex-1 text-[#1a1a1a] font-mono truncate">
                              {val === null ? <span className="text-[#ccc] italic">null</span> : String(typeof val === 'object' ? JSON.stringify(val) : val)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => startEdit(i)} className="text-[12px] text-[#007aff] hover:underline">Edit</button>
                      <button onClick={() => removeExample(i)} className="text-[12px] text-[#dc2626] hover:underline">Remove</button>
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
              onSave={saveExample} onCancel={() => setEditIdx(null)}
            />
          </div>
        )}

        {sampleExtractions.length === 0 && editIdx === null && (
          <div className="text-center py-8 text-[13px] text-[#999] border border-dashed border-[#e0e0e0] rounded-lg">
            No examples yet. Adding extraction examples significantly improves accuracy.
          </div>
        )}
      </div>
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
