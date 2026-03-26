import Anthropic from '@anthropic-ai/sdk';
import { ChatMessage } from './types';

export interface StreamUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StreamResult {
  stream: AsyncGenerator<string>;
  finalUsage: Promise<StreamUsage>;
}

export function streamChatResponse(
  systemPrompt: string,
  messages: ChatMessage[],
  projectContext: string,
  sourceLegend?: string
): StreamResult {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const apiMessages = messages.map((msg, i) => {
    if (i === messages.length - 1 && msg.role === 'user') {
      let contextBlock = `[PROJECT DATA]\n${projectContext}`;
      if (sourceLegend) {
        contextBlock += `\n\n[SOURCE LEGEND]\n${sourceLegend}`;
      }
      return {
        role: 'user' as const,
        content: `${contextBlock}\n\n[USER QUESTION]\n${msg.content}`,
      };
    }
    return { role: msg.role as 'user' | 'assistant', content: msg.content };
  });

  let resolveUsage: (usage: StreamUsage) => void;
  const finalUsage = new Promise<StreamUsage>((resolve) => {
    resolveUsage = resolve;
  });

  async function* generate(): AsyncGenerator<string> {
    const anthropicStream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: apiMessages,
    });

    for await (const event of anthropicStream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta &&
        'text' in event.delta
      ) {
        yield event.delta.text;
      }
    }

    const finalMessage = await anthropicStream.finalMessage();
    resolveUsage({
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    });
  }

  return { stream: generate(), finalUsage };
}
