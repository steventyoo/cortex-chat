'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface FieldDef {
  name: string;
  type: string;
  tier: number;
  required: boolean;
  description: string;
  options?: string[];
  disambiguationRules?: string;
  importance?: string;
}

const IMPORTANCE_COLORS: Record<string, string> = {
  P: 'bg-[#fecaca] text-[#991b1b]',
  S: 'bg-[#dbeafe] text-[#1e40af]',
  E: 'bg-[#f0f0f0] text-[#666]',
  A: 'bg-[#f5f5f5] text-[#999]',
};

interface Props {
  skillId: string;
  systemPrompt: string;
  extractionInstructions: string;
  sampleExtractions: Array<{ inputSnippet: string; expectedOutput: Record<string, unknown> }>;
  referenceDocIds: string[];
}

interface TestResult {
  extraction: {
    documentType: string;
    documentTypeConfidence: number;
    fields: Record<string, { value: string | number | null; confidence: number }>;
  };
  overallConfidence: number;
  flags: Array<{ field: string; issue: string; severity: string }>;
  sourceText: string;
  truncated: boolean;
  timing: { parse: number; extract: number; total: number };
  tokenUsage?: { inputTokens?: number; outputTokens?: number };
}

export default function SkillTestTab({
  skillId, systemPrompt, extractionInstructions, sampleExtractions, referenceDocIds,
}: Props) {
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'original' | 'text'>('original');
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchCatalogFields = useCallback(async () => {
    try {
      const res = await fetch(`/api/skills/${skillId}/fields`);
      const data = await res.json();
      const rows = data.fields || [];
      setFields(rows.map((sf: Record<string, unknown>) => {
        const catalog = sf.field_catalog as Record<string, unknown> | null;
        const optionsRaw = sf.options as string[] | null;
        const catalogOptions = catalog?.enum_options as string[] | null;
        return {
          name: (sf.display_override as string) || (catalog?.display_name as string) || '',
          type: (catalog?.field_type as string) || 'string',
          tier: (sf.tier as number) ?? 1,
          required: (sf.required as boolean) ?? false,
          description: (sf.description as string) || (catalog?.description as string) || '',
          options: optionsRaw && optionsRaw.length > 0 ? optionsRaw : catalogOptions && catalogOptions.length > 0 ? catalogOptions : undefined,
          disambiguationRules: (sf.extraction_hint as string) || (sf.disambiguation_rules as string) || undefined,
          importance: sf.importance as string | undefined,
        };
      }));
    } catch { /* ignore */ }
  }, [skillId]);

  useEffect(() => { fetchCatalogFields(); }, [fetchCatalogFields]);

  const runTest = async (file: File) => {
    setRunning(true);
    setError('');
    setResult(null);
    setFileName(file.name);
    setUploadedFile(file);

    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    setFilePreviewUrl(URL.createObjectURL(file));

    const formData = new FormData();
    formData.append('file', file);
    formData.append('overrides', JSON.stringify({
      fieldDefinitions: fields,
      systemPrompt,
      extractionInstructions,
      sampleExtractions,
      referenceDocIds,
    }));

    try {
      const res = await fetch(`/api/skills/${skillId}/test`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Test failed');
        if (data.sourceText) setResult({ ...data, extraction: null } as unknown as TestResult);
      } else {
        setResult(data);
      }
    } catch {
      setError('Network error');
    }
    setRunning(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) runTest(file);
    e.target.value = '';
  };

  const getFieldImportance = (fieldName: string): string | undefined => {
    return fields.find(f => f.name === fieldName)?.importance;
  };

  const isFilePreviewable = (file: File | null): 'pdf' | 'image' | 'none' => {
    if (!file) return 'none';
    if (file.type === 'application/pdf') return 'pdf';
    if (file.type.startsWith('image/')) return 'image';
    return 'none';
  };

  const schemaFields = result?.extraction?.fields
    ? Object.entries(result.extraction.fields).filter(([name]) => fields.some(f => f.name === name))
    : [];
  const extraFields = result?.extraction?.fields
    ? Object.entries(result.extraction.fields).filter(([name]) => !fields.some(f => f.name === name))
    : [];

  const previewType = isFilePreviewable(uploadedFile);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[16px] font-semibold text-[#1a1a1a]">Test Extraction</h2>
          <p className="text-[13px] text-[#999] mt-0.5">
            Upload a document to test extraction with the current (unsaved) skill configuration.
          </p>
        </div>
        <label className={`px-4 py-2 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors cursor-pointer ${running ? 'opacity-50 pointer-events-none' : ''}`}>
          {running ? 'Running...' : 'Upload & Test'}
          <input ref={fileRef} type="file" className="hidden" onChange={handleFileSelect} accept=".pdf,.docx,.doc,.xlsx,.txt,.csv,.png,.jpg,.jpeg" />
        </label>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-[#fef2f2] border border-[#fecaca] text-[#dc2626] text-[13px]">
          {error}
        </div>
      )}

      {running && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <svg className="animate-spin w-6 h-6 text-[#999] mx-auto mb-3" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <p className="text-[14px] text-[#999]">Running extraction on {fileName}...</p>
            <p className="text-[12px] text-[#ccc] mt-1">This typically takes 5-15 seconds</p>
          </div>
        </div>
      )}

      {result && result.extraction && (
        <div className="grid grid-cols-2 gap-6">
          {/* Left: File viewer / Source text */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {previewType !== 'none' && (
                  <div className="flex bg-[#f0f0f0] rounded-lg p-0.5">
                    <button
                      onClick={() => setViewMode('original')}
                      className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors ${
                        viewMode === 'original' ? 'bg-white text-[#1a1a1a] shadow-sm' : 'text-[#999]'
                      }`}
                    >
                      Original
                    </button>
                    <button
                      onClick={() => setViewMode('text')}
                      className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors ${
                        viewMode === 'text' ? 'bg-white text-[#1a1a1a] shadow-sm' : 'text-[#999]'
                      }`}
                    >
                      Extracted Text
                    </button>
                  </div>
                )}
                {previewType === 'none' && (
                  <h3 className="text-[13px] font-semibold text-[#1a1a1a] uppercase tracking-wide">Source Text</h3>
                )}
              </div>
              {result.truncated && (
                <span className="text-[11px] text-[#f59e0b] font-medium">Truncated</span>
              )}
            </div>

            {viewMode === 'original' && previewType === 'pdf' && filePreviewUrl && (
              <div className="border border-[#e8e8e8] rounded-lg overflow-hidden" style={{ height: 600 }}>
                <iframe src={filePreviewUrl} className="w-full h-full" title="Document preview" />
              </div>
            )}

            {viewMode === 'original' && previewType === 'image' && filePreviewUrl && (
              <div className="border border-[#e8e8e8] rounded-lg p-4 bg-[#fafafa] overflow-auto max-h-[600px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={filePreviewUrl} alt="Uploaded document" className="max-w-full h-auto" />
              </div>
            )}

            {(viewMode === 'text' || previewType === 'none') && (
              <div className="border border-[#e8e8e8] rounded-lg p-4 bg-[#fafafa] overflow-auto max-h-[600px]">
                <pre className="text-[12px] text-[#555] whitespace-pre-wrap font-mono leading-relaxed">
                  {result.sourceText}
                </pre>
              </div>
            )}
          </div>

          {/* Right: Extraction results */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-semibold text-[#1a1a1a] uppercase tracking-wide">Extraction Result</h3>
              <div className="flex items-center gap-3 text-[12px]">
                <span className={`font-medium ${result.overallConfidence >= 0.8 ? 'text-[#16a34a]' : result.overallConfidence >= 0.6 ? 'text-[#f59e0b]' : 'text-[#dc2626]'}`}>
                  {(result.overallConfidence * 100).toFixed(0)}% confidence
                </span>
                {result.timing && (
                  <span className="text-[#ccc]">{(result.timing.total / 1000).toFixed(1)}s</span>
                )}
              </div>
            </div>

            {/* Meta */}
            <div className="border border-[#e8e8e8] rounded-lg p-4 mb-3 bg-[#fafafa]">
              <div className="flex items-center gap-4 text-[13px]">
                <span className="text-[#999]">Type:</span>
                <span className="font-medium text-[#1a1a1a]">{result.extraction.documentType}</span>
                <span className="text-[#ccc]">|</span>
                <span className="text-[#999]">Type confidence:</span>
                <span className="font-medium">{(result.extraction.documentTypeConfidence * 100).toFixed(0)}%</span>
              </div>
              {result.tokenUsage && (
                <div className="flex items-center gap-4 text-[11px] text-[#b4b4b4] mt-2">
                  <span>Input: {result.tokenUsage.inputTokens?.toLocaleString()} tokens</span>
                  <span>Output: {result.tokenUsage.outputTokens?.toLocaleString()} tokens</span>
                </div>
              )}
            </div>

            {/* Flags */}
            {result.flags.length > 0 && (
              <div className="mb-3 space-y-1">
                {result.flags.map((flag, i) => (
                  <div key={i} className={`px-3 py-2 rounded-lg text-[12px] ${
                    flag.severity === 'warning' ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#eff6ff] text-[#1e40af]'
                  }`}>
                    <span className="font-medium">{flag.field}:</span> {flag.issue}
                  </div>
                ))}
              </div>
            )}

            {/* Schema fields */}
            {schemaFields.length > 0 && (
              <div className="mb-4">
                <p className="text-[11px] font-medium text-[#999] uppercase tracking-wide mb-2">Schema Fields</p>
                <div className="border border-[#e8e8e8] rounded-lg overflow-hidden">
                  {schemaFields.map(([name, data], i) => {
                    const imp = getFieldImportance(name);
                    return (
                      <div key={name} className={`flex items-center px-4 py-2.5 text-[13px] ${i > 0 ? 'border-t border-[#f0f0f0]' : ''}`}>
                        <span className="w-[200px] flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-[#999] font-medium truncate">{name}</span>
                          {imp && (
                            <span className={`text-[9px] px-1 py-0.5 rounded font-medium flex-shrink-0 ${IMPORTANCE_COLORS[imp]}`}>
                              {imp}
                            </span>
                          )}
                        </span>
                        <span className="flex-1 text-[#1a1a1a] font-mono truncate">
                          {data.value === null ? <span className="text-[#ccc] italic">null</span> : String(data.value)}
                        </span>
                        <span className={`text-[11px] font-medium ml-2 flex-shrink-0 ${
                          data.confidence >= 0.9 ? 'text-[#16a34a]' : data.confidence >= 0.7 ? 'text-[#f59e0b]' : 'text-[#dc2626]'
                        }`}>
                          {(data.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Extra fields */}
            {extraFields.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-[#999] uppercase tracking-wide mb-2">Extra Fields</p>
                <div className="border border-[#e8e8e8] rounded-lg overflow-hidden bg-[#fafafa]">
                  {extraFields.map(([name, data], i) => (
                    <div key={name} className={`flex items-center px-4 py-2.5 text-[13px] ${i > 0 ? 'border-t border-[#f0f0f0]' : ''}`}>
                      <span className="w-[200px] text-[#b4b4b4] font-medium truncate flex-shrink-0">{name}</span>
                      <span className="flex-1 text-[#666] font-mono truncate">
                        {data.value === null ? <span className="text-[#ccc] italic">null</span> : String(data.value)}
                      </span>
                      <span className={`text-[11px] font-medium ml-2 flex-shrink-0 ${
                        data.confidence >= 0.9 ? 'text-[#16a34a]' : data.confidence >= 0.7 ? 'text-[#f59e0b]' : 'text-[#dc2626]'
                      }`}>
                        {(data.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!result && !running && (
        <div
          className="border-2 border-dashed border-[#e0e0e0] rounded-xl py-20 text-center cursor-pointer hover:border-[#ccc] transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" className="mx-auto mb-3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M12 18v-6" />
            <path d="M9 15l3-3 3 3" />
          </svg>
          <p className="text-[14px] text-[#999]">Drop a document here or click to upload</p>
          <p className="text-[12px] text-[#ccc] mt-1">PDF, Word, Excel, images, or text files</p>
        </div>
      )}
    </div>
  );
}
