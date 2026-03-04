import Anthropic from '@anthropic-ai/sdk';
import { ChatMessage } from './types';

export async function* streamChatResponse(
  systemPrompt: string,
  messages: ChatMessage[],
  projectContext: string
): AsyncGenerator<string> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Build messages array — prepend project context to the latest user message
  const apiMessages = messages.map((msg, i) => {
    if (i === messages.length - 1 && msg.role === 'user') {
      return {
        role: 'user' as const,
        content: `[PROJECT DATA]\n${projectContext}\n\n[USER QUESTION]\n${msg.content}`,
      };
    }
    return { role: msg.role as 'user' | 'assistant', content: msg.content };
  });

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: apiMessages,
  });

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta &&
      'text' in event.delta
    ) {
      yield event.delta.text;
    }
  }
}
