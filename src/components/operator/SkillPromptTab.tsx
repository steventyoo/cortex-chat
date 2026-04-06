'use client';

interface Props {
  systemPrompt: string;
  setSystemPrompt: (v: string) => void;
  extractionInstructions: string;
  setExtractionInstructions: (v: string) => void;
  markDirty: () => void;
}

export default function SkillPromptTab({
  systemPrompt, setSystemPrompt,
  extractionInstructions, setExtractionInstructions,
  markDirty,
}: Props) {
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
    </div>
  );
}
