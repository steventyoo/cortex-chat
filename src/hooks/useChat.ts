'use client';

import { useState, useCallback, useRef } from 'react';
import { ChatMessage, SourceRef, ToolCallEntry, MessagePart } from '@/lib/types';
import { nanoid } from 'nanoid';

function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i;
  }
  return -1;
}

function processSSELine(
  data: Record<string, unknown>,
  state: {
    accumulated: string;
    toolCalls: ToolCallEntry[];
    parts: MessagePart[];
  }
) {
  if (data.type === 'tool_call') {
    const tc: ToolCallEntry = {
      name: data.name as string,
      displayName: (data.displayName as string) || undefined,
      input: (data.input as Record<string, unknown>) || {},
      status: 'calling',
    };
    state.toolCalls = [...state.toolCalls, tc];
    state.parts = [...state.parts, { type: 'tool_call', toolCall: tc }];
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
      state.toolCalls,
      (tc) => tc.name === data.name && tc.status === 'calling'
    );
    if (idx !== -1) {
      const resultObj = data.result as Record<string, unknown> | undefined;
      const updated: ToolCallEntry = {
        ...state.toolCalls[idx],
        result: data.result,
        resultCount,
        htmlArtifact: (data.htmlArtifact as string) || undefined,
        status: resultObj?.error ? 'error' : 'done',
      };
      state.toolCalls = [...state.toolCalls];
      state.toolCalls[idx] = updated;

      const partIdx = findLastIndex(
        state.parts,
        (p) => p.type === 'tool_call' && p.toolCall.name === data.name && p.toolCall.status === 'calling'
      );
      if (partIdx !== -1) {
        state.parts = [...state.parts];
        state.parts[partIdx] = { type: 'tool_call', toolCall: updated };
      }
    }
  }

  if (data.text) {
    state.accumulated += data.text as string;
    const lastPart = state.parts[state.parts.length - 1];
    if (lastPart && lastPart.type === 'text') {
      state.parts = [...state.parts];
      state.parts[state.parts.length - 1] = { type: 'text', content: lastPart.content + (data.text as string) };
    } else {
      state.parts = [...state.parts, { type: 'text', content: data.text as string }];
    }
  }
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
        const state = {
          accumulated: '',
          toolCalls: [] as ToolCallEntry[],
          parts: [] as MessagePart[],
        };
        let lineBuffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          lineBuffer += chunk;

          const rawLines = lineBuffer.split('\n');
          lineBuffer = rawLines.pop() || '';

          for (const line of rawLines) {
            if (!line.startsWith('data: ')) continue;

            let data: Record<string, unknown>;
            try {
              data = JSON.parse(line.slice(6));
            } catch {
              continue;
            }

            if (data.projectId) {
              setCurrentProjectId(data.projectId as string);
            }

            if (data.sources) {
              setSourcesMap((prev) => ({
                ...prev,
                [assistantId]: data.sources as SourceRef[],
              }));
            }

            processSSELine(data, state);

            if (data.error) {
              setError(data.error as string);
            }
          }

          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              updated[updated.length - 1] = {
                ...last,
                content: state.accumulated,
                toolCalls: state.toolCalls.length > 0 ? state.toolCalls : last.toolCalls,
                parts: state.parts.length > 0 ? state.parts : last.parts,
              };
            }
            return updated;
          });
        }

        if (lineBuffer.startsWith('data: ')) {
          try {
            const data = JSON.parse(lineBuffer.slice(6));
            processSSELine(data, state);
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === 'assistant') {
                updated[updated.length - 1] = {
                  ...last,
                  content: state.accumulated,
                  toolCalls: state.toolCalls.length > 0 ? state.toolCalls : last.toolCalls,
                  parts: state.parts.length > 0 ? state.parts : last.parts,
                };
              }
              return updated;
            });
          } catch {
            // Final partial line — safe to ignore
          }
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
