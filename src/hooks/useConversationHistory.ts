'use client';

import { useState, useCallback, useEffect, createContext, useContext, ReactNode, createElement } from 'react';
import { ChatMessage, ConversationSummary } from '@/lib/types';
import { nanoid } from 'nanoid';

const STORAGE_KEY_PREFIX = 'cortex-conversations';
const MAX_CONVERSATIONS = 20;

interface StoredConversation {
  id: string;
  projectId: string | null;
  projectName: string | null;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface PendingLoad {
  messages: ChatMessage[];
  projectId: string | null;
}

function storageKey(orgId: string | null): string {
  return orgId ? `${STORAGE_KEY_PREFIX}:${orgId}` : STORAGE_KEY_PREFIX;
}

function loadConversationsFromStorage(orgId: string | null): StoredConversation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(orgId));
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveConversationsToStorage(conversations: StoredConversation[], orgId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = conversations
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CONVERSATIONS);
    localStorage.setItem(storageKey(orgId), JSON.stringify(trimmed));
  } catch {
    // localStorage full or unavailable
  }
}

interface ConversationHistoryState {
  currentConversationId: string | null;
  pendingLoad: PendingLoad | null;
  saveConversation: (messages: ChatMessage[], projectId: string | null, projectName: string | null) => void;
  loadConversation: (conversationId: string) => void;
  consumePendingLoad: () => void;
  startNewConversation: () => void;
  deleteConversation: (conversationId: string) => void;
  getSummaries: () => ConversationSummary[];
}

const ConversationHistoryContext = createContext<ConversationHistoryState>({
  currentConversationId: null,
  pendingLoad: null,
  saveConversation: () => {},
  loadConversation: () => {},
  consumePendingLoad: () => {},
  startNewConversation: () => {},
  deleteConversation: () => {},
  getSummaries: () => [],
});

export function useConversationHistory() {
  return useContext(ConversationHistoryContext);
}

export function ConversationHistoryProvider({ orgId, children }: { orgId: string | null; children: ReactNode }) {
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [pendingLoad, setPendingLoad] = useState<PendingLoad | null>(null);

  useEffect(() => {
    setConversations(loadConversationsFromStorage(orgId));
    setCurrentConversationId(null);
    setPendingLoad(null);
  }, [orgId]);

  const saveConversation = useCallback(
    (messages: ChatMessage[], projectId: string | null, projectName: string | null) => {
      if (messages.length === 0) return;

      setConversations((prev) => {
        let updated: StoredConversation[];

        if (currentConversationId) {
          const exists = prev.find((c) => c.id === currentConversationId);
          if (exists) {
            updated = prev.map((c) =>
              c.id === currentConversationId
                ? { ...c, messages, projectId, projectName, updatedAt: Date.now() }
                : c
            );
          } else {
            const newConv: StoredConversation = {
              id: currentConversationId,
              projectId,
              projectName,
              messages,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            updated = [newConv, ...prev];
          }
        } else {
          const newId = nanoid();
          setCurrentConversationId(newId);
          const newConv: StoredConversation = {
            id: newId,
            projectId,
            projectName,
            messages,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          updated = [newConv, ...prev];
        }

        saveConversationsToStorage(updated, orgId);
        return updated;
      });
    },
    [currentConversationId, orgId]
  );

  const loadConversation = useCallback(
    (conversationId: string) => {
      const conv = conversations.find((c) => c.id === conversationId);
      if (conv) {
        setCurrentConversationId(conversationId);
        setPendingLoad({ messages: conv.messages, projectId: conv.projectId });
      }
    },
    [conversations]
  );

  const consumePendingLoad = useCallback(() => {
    setPendingLoad(null);
  }, []);

  const startNewConversation = useCallback(() => {
    setCurrentConversationId(null);
  }, []);

  const deleteConversation = useCallback((conversationId: string) => {
    setConversations((prev) => {
      const updated = prev.filter((c) => c.id !== conversationId);
      saveConversationsToStorage(updated, orgId);
      return updated;
    });
  }, [orgId]);

  const getSummaries = useCallback((): ConversationSummary[] => {
    return conversations
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => {
        const firstUserMessage = c.messages.find((m) => m.role === 'user');
        return {
          id: c.id,
          projectId: c.projectId,
          projectName: c.projectName,
          firstMessage: firstUserMessage?.content || 'New conversation',
          messageCount: c.messages.length,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        };
      });
  }, [conversations]);

  const value: ConversationHistoryState = {
    currentConversationId,
    pendingLoad,
    saveConversation,
    loadConversation,
    consumePendingLoad,
    startNewConversation,
    deleteConversation,
    getSummaries,
  };

  return createElement(ConversationHistoryContext.Provider, { value }, children);
}
