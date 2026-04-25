'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface ContextCard {
  id: string;
  card_name: string;
  display_name: string;
  description: string;
  trigger_concepts: string[];
  skills_involved: string[];
  business_logic: string;
  key_fields: Record<string, string[]>;
  example_questions: string[];
  is_active: boolean;
  embedding: unknown;
  created_at: string;
  updated_at: string;
}

function OperatorNav() {
  const pathname = usePathname();
  const tabs = [
    { label: 'Skills', href: '/operator/skills' },
    { label: 'Field Catalog', href: '/operator/fields' },
    { label: 'Doc Links', href: '/operator/doc-links' },
    { label: 'Chat Tools', href: '/operator/chat-tools' },
    { label: 'Context Cards', href: '/operator/context-cards' },
    { label: 'Evals', href: '/operator/evals' },
    { label: 'Derived Fields', href: '/operator/derived-fields' },
    { label: 'Checks', href: '/operator/checks' },
    { label: 'Parsers', href: '/operator/parsers' },
  ];

  return (
    <nav className="border-b border-[#e8e8e8] bg-[#fafafa]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center h-12 gap-8">
          <Link href="/operator/skills" className="text-[15px] font-semibold text-[#1a1a1a] tracking-tight">
            Operator Workbench
          </Link>
          <div className="flex items-center gap-1">
            {tabs.map(tab => (
              <Link
                key={tab.href}
                href={tab.href}
                className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                  pathname.startsWith(tab.href)
                    ? 'bg-[#1a1a1a] text-white'
                    : 'text-[#6b6b6b] hover:text-[#1a1a1a] hover:bg-[#f0f0f0]'
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </div>
          <div className="flex-1" />
          <Link href="/" className="text-[12px] text-[#999] hover:text-[#666] transition-colors">
            Back to App
          </Link>
        </div>
      </div>
    </nav>
  );
}

function EditCardModal({
  card,
  onClose,
  onSaved,
}: {
  card: ContextCard | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !card;

  const [displayName, setDisplayName] = useState(card?.display_name || '');
  const [cardName, setCardName] = useState(card?.card_name || '');
  const [description, setDescription] = useState(card?.description || '');
  const [triggerConcepts, setTriggerConcepts] = useState(card?.trigger_concepts?.join(', ') || '');
  const [skillsInvolved, setSkillsInvolved] = useState(card?.skills_involved?.join(', ') || '');
  const [businessLogic, setBusinessLogic] = useState(card?.business_logic || '');
  const [exampleQuestions, setExampleQuestions] = useState(card?.example_questions?.join('\n') || '');
  const [availableSkills, setAvailableSkills] = useState<Array<{skill_id: string; display_name: string}>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/skills?status=active')
      .then(r => r.json())
      .then(data => setAvailableSkills((data.skills || []).map((s: Record<string, string>) => ({ skill_id: s.skill_id, display_name: s.display_name }))))
      .catch(() => {});
  }, []);

  const autoCardName = displayName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_');

  const handleSave = async () => {
    const finalCardName = cardName || autoCardName;
    if (!finalCardName || !displayName || !businessLogic) {
      setError('Display name and business logic are required');
      return;
    }

    setSaving(true);
    setError('');

    const payload = {
      id: card?.id,
      card_name: finalCardName,
      display_name: displayName,
      description,
      trigger_concepts: triggerConcepts.split(',').map(s => s.trim()).filter(Boolean),
      skills_involved: skillsInvolved.split(',').map(s => s.trim()).filter(Boolean),
      business_logic: businessLogic,
      example_questions: exampleQuestions.split('\n').map(s => s.trim()).filter(Boolean),
    };

    try {
      const res = await fetch('/api/context-cards', {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to save');
        setSaving(false);
        return;
      }
      onSaved();
    } catch {
      setError('Network error');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[#f0f0f0] flex-shrink-0">
          <h2 className="text-[17px] font-semibold text-[#1a1a1a]">
            {isNew ? 'Create Context Card' : `Edit: ${card.display_name}`}
          </h2>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Display Name</label>
              <input
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
                placeholder="e.g. Unbilled CO Recovery"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Card ID</label>
              <input
                value={cardName || autoCardName}
                onChange={e => setCardName(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
                placeholder="unbilled_co_recovery"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Description (1-line)</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
              placeholder="What this context card helps with"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Trigger Concepts (comma-separated)</label>
            <input
              value={triggerConcepts}
              onChange={e => setTriggerConcepts(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
              placeholder="unbilled, CO recovery, billing gap"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Skills Involved</label>
            <div className="mt-1 flex flex-wrap gap-1.5 min-h-[38px] p-2 rounded-lg border border-[#e0e0e0] focus-within:ring-2 focus-within:ring-[#007aff]/20 focus-within:border-[#007aff]">
              {skillsInvolved.split(',').filter(s => s.trim()).map(sk => {
                const id = sk.trim();
                const skill = availableSkills.find(s => s.skill_id === id);
                return (
                  <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#eff6ff] text-[#1e40af] text-[12px] font-mono">
                    {skill ? skill.display_name : id}
                    <button
                      type="button"
                      onClick={() => setSkillsInvolved(skillsInvolved.split(',').map(s => s.trim()).filter(s => s && s !== id).join(', '))}
                      className="text-[#1e40af]/50 hover:text-[#1e40af] ml-0.5"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              <select
                value=""
                onChange={e => {
                  if (!e.target.value) return;
                  const current = skillsInvolved.split(',').map(s => s.trim()).filter(Boolean);
                  if (!current.includes(e.target.value)) {
                    setSkillsInvolved([...current, e.target.value].join(', '));
                  }
                }}
                className="text-[12px] text-[#999] bg-transparent border-none outline-none cursor-pointer min-w-[120px]"
              >
                <option value="">+ add skill...</option>
                {availableSkills
                  .filter(s => !skillsInvolved.split(',').map(x => x.trim()).includes(s.skill_id))
                  .map(s => (
                    <option key={s.skill_id} value={s.skill_id}>{s.display_name} ({s.skill_id})</option>
                  ))
                }
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">
              Business Logic (instructions for the AI)
            </label>
            <textarea
              value={businessLogic}
              onChange={e => setBusinessLogic(e.target.value)}
              rows={8}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff] leading-relaxed"
              placeholder="Step-by-step instructions for how the AI should analyze this topic..."
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#999] uppercase tracking-wide">Example Questions (one per line)</label>
            <textarea
              value={exampleQuestions}
              onChange={e => setExampleQuestions(e.target.value)}
              rows={3}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-[#e0e0e0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]"
              placeholder="Are there any approved COs we haven't billed?&#10;What is our total unbilled exposure?"
            />
          </div>

          {error && (
            <div className="px-4 py-2 rounded-lg bg-[#fef2f2] text-[#dc2626] text-[13px]">{error}</div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#f0f0f0] flex gap-2 justify-end flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] text-[#666] hover:bg-[#f0f0f0] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!displayName.trim() || !businessLogic.trim() || saving}
            className="px-4 py-2 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors disabled:opacity-40"
          >
            {saving ? 'Saving...' : isNew ? 'Create Card' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OperatorContextCardsPage() {
  const [cards, setCards] = useState<ContextCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [editCard, setEditCard] = useState<ContextCard | null | 'new'>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState('');

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/context-cards');
      if (res.ok) {
        const data = await res.json();
        setCards(data.cards || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchCards(); }, [fetchCards]);

  const handleSeed = async () => {
    setSeeding(true);
    setSeedResult('');
    try {
      const res = await fetch('/api/context-cards/seed', { method: 'POST' });
      const data = await res.json();
      setSeedResult(data.message || 'Done');
      fetchCards();
    } catch {
      setSeedResult('Failed to seed');
    }
    setSeeding(false);
  };

  const handleToggleActive = async (card: ContextCard) => {
    await fetch('/api/context-cards', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: card.id, is_active: !card.is_active }),
    });
    fetchCards();
  };

  const handleDelete = async (card: ContextCard) => {
    if (!confirm(`Delete "${card.display_name}"?`)) return;
    await fetch(`/api/context-cards?id=${card.id}`, { method: 'DELETE' });
    fetchCards();
  };

  const activeCards = cards.filter(c => c.is_active);
  const inactiveCards = cards.filter(c => !c.is_active);

  return (
    <div className="min-h-screen bg-white">
      <OperatorNav />

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-[22px] font-semibold text-[#1a1a1a] tracking-tight">Context Cards</h1>
            <p className="text-[14px] text-[#999] mt-1">
              Business logic and domain knowledge that guides the AI when answering complex questions.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="px-4 py-2 rounded-lg border border-[#e0e0e0] text-[13px] text-[#666] hover:bg-[#f0f0f0] transition-colors disabled:opacity-40"
            >
              {seeding ? 'Seeding...' : cards.length === 0 ? 'Seed Defaults' : 'Sync Defaults'}
            </button>
            <button
              onClick={() => setEditCard('new')}
              className="px-4 py-2 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium hover:bg-[#333] transition-colors"
            >
              + Create Card
            </button>
          </div>
        </div>

        {seedResult && (
          <div className="mb-4 px-4 py-2 rounded-lg bg-[#f0fdf4] border border-[#bbf7d0] text-[13px] text-[#166534]">
            {seedResult}
          </div>
        )}

        {editCard && (
          <EditCardModal
            card={editCard === 'new' ? null : editCard}
            onClose={() => setEditCard(null)}
            onSaved={() => { setEditCard(null); fetchCards(); }}
          />
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex items-center gap-3 text-[14px] text-[#999]">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Loading context cards...
            </div>
          </div>
        ) : cards.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-[14px] text-[#999] mb-4">No context cards yet</p>
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="px-4 py-2 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium"
            >
              Seed Default Cards
            </button>
          </div>
        ) : (
          <>
            {activeCards.length > 0 && (
              <div className="mb-6">
                <h2 className="text-[13px] font-medium text-[#999] uppercase tracking-wide mb-3">
                  Active ({activeCards.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {activeCards.map(card => (
                    <div
                      key={card.id}
                      className="border border-[#e8e8e8] rounded-xl p-5 hover:border-[#ccc] hover:shadow-sm transition-all group"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setEditCard(card)}>
                          <h3 className="text-[15px] font-semibold text-[#1a1a1a] group-hover:text-[#007aff] transition-colors">
                            {card.display_name}
                          </h3>
                          <p className="text-[12px] text-[#b4b4b4] font-mono mt-0.5">{card.card_name}</p>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wide flex-shrink-0 ml-2 ${
                          card.embedding ? 'bg-[#dcfce7] text-[#166534]' : 'bg-[#fef3c7] text-[#92400e]'
                        }`}>
                          {card.embedding ? 'embedded' : 'no embedding'}
                        </span>
                      </div>

                      <p className="text-[13px] text-[#6b6b6b] mb-3 line-clamp-2">
                        {card.description}
                      </p>

                      {card.skills_involved.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {card.skills_involved.map((sk, i) => (
                            <Link key={i} href={`/operator/skills/${sk}`} className="text-[10px] px-1.5 py-0.5 rounded-md bg-[#eff6ff] text-[#1e40af] font-mono hover:bg-[#dbeafe] transition-colors">
                              {sk}
                            </Link>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-2 border-t border-[#f0f0f0]">
                        <button
                          onClick={() => setEditCard(card)}
                          className="text-[12px] text-[#007aff] hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleToggleActive(card)}
                          className="text-[12px] text-[#999] hover:text-[#666]"
                        >
                          Deactivate
                        </button>
                        <button
                          onClick={() => handleDelete(card)}
                          className="text-[12px] text-[#dc2626] hover:underline ml-auto"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {inactiveCards.length > 0 && (
              <div>
                <h2 className="text-[13px] font-medium text-[#999] uppercase tracking-wide mb-3">
                  Inactive ({inactiveCards.length})
                </h2>
                <div className="space-y-2">
                  {inactiveCards.map(card => (
                    <div
                      key={card.id}
                      className="flex items-center justify-between px-4 py-3 border border-[#e8e8e8] rounded-lg bg-[#fafafa]"
                    >
                      <div>
                        <span className="text-[14px] text-[#999]">{card.display_name}</span>
                        <span className="text-[12px] text-[#ccc] ml-2 font-mono">{card.card_name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleToggleActive(card)}
                          className="text-[12px] text-[#007aff] hover:underline"
                        >
                          Activate
                        </button>
                        <button
                          onClick={() => handleDelete(card)}
                          className="text-[12px] text-[#dc2626] hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
