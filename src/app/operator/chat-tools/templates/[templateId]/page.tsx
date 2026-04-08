'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useParams } from 'next/navigation';

function OperatorNav() {
  const pathname = usePathname();
  const tabs = [
    { label: 'Skills', href: '/operator/skills' },
    { label: 'Doc Links', href: '/operator/doc-links' },
    { label: 'Chat Tools', href: '/operator/chat-tools' },
  ];
  return (
    <nav className="border-b border-[#e8e8e8] bg-[#fafafa]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center h-12 gap-8">
          <Link href="/operator/skills" className="text-[15px] font-semibold text-[#1a1a1a] tracking-tight">Operator Workbench</Link>
          <div className="flex items-center gap-1">
            {tabs.map(tab => (
              <Link key={tab.href} href={tab.href} className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${pathname.startsWith(tab.href) ? 'bg-[#1a1a1a] text-white' : 'text-[#6b6b6b] hover:text-[#1a1a1a] hover:bg-[#f0f0f0]'}`}>
                {tab.label}
              </Link>
            ))}
          </div>
          <div className="flex-1" />
          <Link href="/" className="text-[12px] text-[#999] hover:text-[#666]">Back to App</Link>
        </div>
      </div>
    </nav>
  );
}

export default function TemplateEditorPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [triggerDescription, setTriggerDescription] = useState('');
  const [triggerKeywords, setTriggerKeywords] = useState<string[]>([]);
  const [systemInstructions, setSystemInstructions] = useState('');
  const [responseFormat, setResponseFormat] = useState('');
  const [samplePrompts, setSamplePrompts] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [newKeyword, setNewKeyword] = useState('');
  const [newPrompt, setNewPrompt] = useState('');

  const fetchTemplate = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/chat-tools/templates/${templateId}`);
      if (!res.ok) { router.push('/operator/chat-tools'); return; }
      const { template } = await res.json();
      setTemplateName(template.template_name);
      setTriggerDescription(template.trigger_description);
      setTriggerKeywords(template.trigger_keywords || []);
      setSystemInstructions(template.system_instructions);
      setResponseFormat(template.response_format || '');
      setSamplePrompts(template.sample_prompts || []);
      setIsActive(template.is_active);
    } catch { router.push('/operator/chat-tools'); }
    setLoading(false);
  }, [templateId, router]);

  useEffect(() => { fetchTemplate(); }, [fetchTemplate]);

  const save = async () => {
    setSaving(true);
    await fetch(`/api/chat-tools/templates/${templateId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateName,
        triggerDescription,
        triggerKeywords,
        systemInstructions,
        responseFormat: responseFormat || null,
        samplePrompts,
        isActive,
      }),
    });
    setSaving(false);
  };

  const deleteTemplate = async () => {
    if (!confirm('Delete this template?')) return;
    await fetch(`/api/chat-tools/templates/${templateId}`, { method: 'DELETE' });
    router.push('/operator/chat-tools');
  };

  const addKeyword = () => {
    const kw = newKeyword.trim().toLowerCase();
    if (!kw || triggerKeywords.includes(kw)) return;
    setTriggerKeywords([...triggerKeywords, kw]);
    setNewKeyword('');
  };

  const addPrompt = () => {
    if (!newPrompt.trim()) return;
    setSamplePrompts([...samplePrompts, newPrompt.trim()]);
    setNewPrompt('');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <OperatorNav />
        <div className="flex items-center justify-center py-20 text-[14px] text-[#999]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <OperatorNav />

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/operator/chat-tools" className="text-[13px] text-[#999] hover:text-[#666]">&larr; Back</Link>
          <div className="flex-1" />
          <button onClick={() => setIsActive(!isActive)} className={`px-3 py-1.5 rounded-lg text-[12px] font-medium ${isActive ? 'bg-[#dcfce7] text-[#166534]' : 'bg-[#f0f0f0] text-[#999]'}`}>
            {isActive ? 'Active' : 'Inactive'}
          </button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded-lg text-[12px] font-medium bg-[#007aff] text-white hover:bg-[#0066dd] disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={deleteTemplate} className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#dc2626] hover:bg-[#fef2f2]">
            Delete
          </button>
        </div>

        <div className="space-y-6">
          {/* Basic info */}
          <div className="border border-[#e8e8e8] rounded-lg p-4 space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">Template Name</label>
              <input value={templateName} onChange={e => setTemplateName(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg border border-[#e0e0e0] text-[14px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">Trigger Description</label>
              <textarea value={triggerDescription} onChange={e => setTriggerDescription(e.target.value)} rows={2} className="w-full mt-1 px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 resize-none" />
            </div>
          </div>

          {/* Trigger keywords */}
          <div className="border border-[#e8e8e8] rounded-lg p-4 space-y-3">
            <h3 className="text-[13px] font-semibold text-[#1a1a1a]">Trigger Keywords</h3>
            <p className="text-[11px] text-[#999]">When any of these keywords appear in the user message, this template&apos;s instructions will be appended to the system prompt.</p>
            <div className="flex flex-wrap gap-1">
              {triggerKeywords.map((kw) => (
                <span key={kw} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-[#f0f0f0] text-[#666] font-mono">
                  {kw}
                  <button onClick={() => setTriggerKeywords(triggerKeywords.filter(k => k !== kw))} className="text-[#999] hover:text-[#dc2626]">x</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newKeyword} onChange={e => setNewKeyword(e.target.value)} onKeyDown={e => e.key === 'Enter' && addKeyword()} placeholder="Add keyword..." className="flex-1 px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-[12px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20" />
              <button onClick={addKeyword} className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#f0f0f0] hover:bg-[#e0e0e0]">Add</button>
            </div>
          </div>

          {/* System instructions */}
          <div className="border border-[#e8e8e8] rounded-lg p-4 space-y-3">
            <h3 className="text-[13px] font-semibold text-[#1a1a1a]">System Instructions</h3>
            <p className="text-[11px] text-[#999]">These instructions are appended to the system prompt when the template matches. Use this to define domain-specific behavior, response formatting, or terminology.</p>
            <textarea value={systemInstructions} onChange={e => setSystemInstructions(e.target.value)} rows={8} className="w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 resize-y" />
          </div>

          {/* Response format */}
          <div className="border border-[#e8e8e8] rounded-lg p-4 space-y-3">
            <h3 className="text-[13px] font-semibold text-[#1a1a1a]">Response Format (Optional)</h3>
            <p className="text-[11px] text-[#999]">Define the expected output structure or formatting guidelines.</p>
            <textarea value={responseFormat} onChange={e => setResponseFormat(e.target.value)} rows={4} className="w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 resize-y" placeholder="e.g. Return the answer in a markdown table with columns: ..." />
          </div>

          {/* Sample Prompts */}
          <div className="border border-[#e8e8e8] rounded-lg p-4 space-y-3">
            <h3 className="text-[13px] font-semibold text-[#1a1a1a]">Sample Prompts</h3>
            <p className="text-[11px] text-[#999]">Example user messages that should trigger this template. Used for testing and reference.</p>
            <div className="space-y-1">
              {samplePrompts.map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px]">
                  <span className="flex-1 px-2 py-1 rounded bg-[#fafafa] text-[#666]">&ldquo;{p}&rdquo;</span>
                  <button onClick={() => setSamplePrompts(samplePrompts.filter((_, j) => j !== i))} className="text-[#dc2626] text-[11px] hover:bg-[#fef2f2] px-1.5 py-1 rounded">x</button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newPrompt} onChange={e => setNewPrompt(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPrompt()} placeholder="Type a sample prompt..." className="flex-1 px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-[12px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20" />
              <button onClick={addPrompt} className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#f0f0f0] hover:bg-[#e0e0e0]">Add</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
