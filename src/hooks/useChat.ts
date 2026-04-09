'use client';

import { useState, useCallback, useRef } from 'react';
import { ChatMessage, SourceRef, ToolCallEntry } from '@/lib/types';
import { nanoid } from 'nanoid';

function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i;
  }
  return -1;
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [sourcesMap, setSourcesMap] = useState<Record<string, SourceRef[]>>({});
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (content: string) => {
      if (isStreaming) return;
      setError(null);

      const userMessage: ChatMessage = {
        id: nanoid(),
        role: 'user',
        content,
        timestamp: Date.now(),
      };

      const assistantMessage: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };

      const assistantId = assistantMessage.id;

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsStreaming(true);

      const history = messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      }));

      try {
        abortRef.current = new AbortController();

        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: content,
            projectId: currentProjectId,
            history,
            includePending: localStorage.getItem('cortex-include-pending') !== 'false',
          }),
          signal: abortRef.current.signal,
        });

        if (response.status === 401) {
          window.location.href = '/login';
          return;
        }

        if (!response.ok) {
          throw new Error('Failed to get response');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const decoder = new TextDecoder();
        let accumulated = '';
        let toolCalls: ToolCallEntry[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            try {
              const data = JSON.parse(line.slice(6));

              if (data.projectId) {
                setCurrentProjectId(data.projectId);
              }

              if (data.sources) {
                setSourcesMap((prev) => ({
                  ...prev,
                  [assistantId]: data.sources as SourceRef[],
                }));
              }

              if (data.type === 'tool_call') {
                toolCalls = [...toolCalls, {
                  name: data.name,
                  displayName: data.displayName,
                  input: data.input || {},
                  status: 'calling',
                }];
              }

              if (data.type === 'tool_result') {
                let resultCount = 0;
                const res = data.result;
                if (Array.isArray(res)) {
                  resultCount = res.length;
                } else if (res && typeof res === 'object' && Array.isArray((res as Record<string, unknown>).records)) {
                  resultCount = ((res as Record<string, unknown>).records as unknown[]).length;
                } else if (res && typeof res === 'object' && Array.isArray((res as Record<string, unknown>).rows)) {
                  resultCount = ((res as Record<string, unknown>).rows as unknown[]).length;
                }
                const idx = findLastIndex(
                  toolCalls,
                  (tc) => tc.name === data.name && tc.status === 'calling'
                );
                if (idx !== -1) {
                  toolCalls = [...toolCalls];
                  toolCalls[idx] = {
                    ...toolCalls[idx],
                    result: data.result,
                    resultCount,
                    htmlArtifact: data.htmlArtifact || undefined,
                    status: data.result?.error ? 'error' : 'done',
                  };
                }
              }

              if (data.text) {
                accumulated += data.text;
              }

              if (data.error) {
                setError(data.error);
              }

              if (data.done) {
                // Streaming complete
              }
            } catch {
              // Ignore parse errors for partial chunks
            }
          }

          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              updated[updated.length - 1] = {
                ...last,
                content: accumulated,
                toolCalls: toolCalls.length > 0 ? toolCalls : last.toolCalls,
              };
            }
            return updated;
          });
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          // User cancelled
        } else {
          setError('Failed to get a response. Please try again.');
          console.error('Chat error:', err);
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming, messages, currentProjectId]
  );

  const clearConversation = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setSourcesMap({});
    setError(null);
    setIsStreaming(false);
  }, []);

  const setProject = useCallback(
    (projectId: string) => {
      setCurrentProjectId(projectId);
    },
    []
  );

  const clearProject = useCallback(() => {
    setCurrentProjectId(null);
  }, []);

  return {
    messages,
    isStreaming,
    error,
    currentProjectId,
    sourcesMap,
    sendMessage,
    clearConversation,
    setProject,
    clearProject,
    setMessages,
  };
}
