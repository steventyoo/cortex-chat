'use client';

import { useState, useCallback, useEffect } from 'react';
import { ChatMessage, ConversationSummary } from '@/lib/types';
import { nanoid } from 'nanoid';

const STORAGE_KEY = 'cortex-conversations';
const MAX_CONVERSATIONS = 20;

interface StoredConversation {
  id: string;
  projectId: string | null;
  projectName: string | null;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

function loadConversations(): StoredConversation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveConversations(conversations: StoredConversation[]) {
  if (typeof window === 'undefined') return;
  try {
    // Keep only most recent conversations
    const trimmed = conversations
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CONVERSATIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage full or unavailable
  }
}

export function useConversationHistory() {
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    setConversations(loadConversations());
  }, []);

  // Save a conversation (create or update)
  const saveConversation = useCallback(
    (
      messages: ChatMessage[],
      projectId: string | null,
      projectName: string | null
    ) => {
      if (messages.length === 0) return;

      setConversations((prev) => {
        let updated: StoredConversation[];

        if (currentConversationId) {
          // Update existing
          const exists = prev.find((c) => c.id === currentConversationId);
          if (exists) {
            updated = prev.map((c) =>
              c.id === currentConversationId
                ? { ...c, messages, projectId, projectName, updatedAt: Date.now() }
                : c
            );
          } else {
            // Conversation was deleted, create new
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
          // Create new conversation
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

        saveConversations(updated);
        return updated;
      });
    },
    [currentConversationId]
  );

  // Load a previous conversation
  const loadConversation = useCallback(
    (conversationId: string): StoredConversation | null => {
      const conv = conversations.find((c) => c.id === conversationId);
      if (conv) {
        setCurrentConversationId(conversationId);
        return conv;
      }
      return null;
    },
    [conversations]
  );

  // Start a new conversation
  const startNewConversation = useCallback(() => {
    setCurrentConversationId(null);
  }, []);

  // Delete a conversation
  const deleteConversation = useCallback((conversationId: string) => {
    setConversations((prev) => {
      const updated = prev.filter((c) => c.id !== conversationId);
      saveConversations(updated);
      return updated;
    });
  }, []);

  // Get conversation summaries for the sidebar
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

  return {
    currentConversationId,
    saveConversation,
    loadConversation,
    startNewConversation,
    deleteConversation,
    getSummaries,
  };
}
