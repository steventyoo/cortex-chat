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

export interface ToolCallEvent {
  type: 'tool_call';
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: 'tool_result';
  name: string;
  result: unknown;
  htmlArtifact?: string;
}

export type ChatEvent = ToolCallEvent | ToolResultEvent;

export interface ToolUseHandler {
  (name: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface StreamResultWithTools {
  stream: AsyncGenerator<string | ChatEvent>;
  finalUsage: Promise<StreamUsage>;
}

const MAX_TOOL_ROUNDS = 12;

export function streamChatResponse(
  systemPrompt: string,
  messages: ChatMessage[],
  projectContext: string,
  sourceLegend?: string
): StreamResultWithTools {
  return streamChatWithTools(systemPrompt, messages, projectContext, sourceLegend);
}

export function streamChatWithTools(
  systemPrompt: string,
  messages: ChatMessage[],
  projectContext: string,
  sourceLegend?: string,
  tools?: Anthropic.Messages.Tool[],
  onToolUse?: ToolUseHandler
): StreamResultWithTools {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const apiMessages: Anthropic.Messages.MessageParam[] = messages.map((msg, i) => {
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

  const hasTools = tools && tools.length > 0 && onToolUse;

  async function* generate(): AsyncGenerator<string | ChatEvent> {
    let currentMessages = [...apiMessages];
    let totalInput = 0;
    let totalOutput = 0;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const streamParams: Anthropic.Messages.MessageStreamParams = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: currentMessages,
      };

      if (hasTools && round < MAX_TOOL_ROUNDS) {
        streamParams.tools = tools;
      }

      const anthropicStream = client.messages.stream(streamParams);

      const contentBlocks: Anthropic.Messages.ContentBlock[] = [];
      let hasToolUse = false;

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
      totalInput += finalMessage.usage.input_tokens;
      totalOutput += finalMessage.usage.output_tokens;

      for (const block of finalMessage.content) {
        contentBlocks.push(block);
        if (block.type === 'tool_use') {
          hasToolUse = true;
        }
      }

      if (!hasToolUse || !hasTools) {
        resolveUsage!({ inputTokens: totalInput, outputTokens: totalOutput });
        return;
      }

      currentMessages.push({ role: 'assistant', content: contentBlocks });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const block of contentBlocks) {
        if (block.type !== 'tool_use') continue;

        yield { type: 'tool_call' as const, name: block.name, input: block.input as Record<string, unknown> };

        try {
          const result = await onToolUse!(block.name, block.input as Record<string, unknown>);
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

          const truncated = resultStr.length > 20000
            ? resultStr.slice(0, 20000) + '\n...[truncated]'
            : resultStr;

          let toolResult = result;
          let htmlArtifact: string | undefined;

          if (result && typeof result === 'object' && '__htmlArtifact' in (result as Record<string, unknown>)) {
            const wrapped = result as Record<string, unknown>;
            htmlArtifact = wrapped.__htmlArtifact as string;
            toolResult = wrapped.__result;
          }

          yield { type: 'tool_result' as const, name: block.name, result: toolResult, htmlArtifact };

          const contentForClaude = htmlArtifact
            ? JSON.stringify(toolResult, null, 2)
            : truncated;

          const truncatedContent = contentForClaude.length > 20000
            ? contentForClaude.slice(0, 20000) + '\n...[truncated]'
            : contentForClaude;

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: truncatedContent,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          yield { type: 'tool_result' as const, name: block.name, result: { error: errMsg } };

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: ${errMsg}`,
            is_error: true,
          });
        }
      }

      currentMessages.push({ role: 'user', content: toolResults });
    }

    resolveUsage!({ inputTokens: totalInput, outputTokens: totalOutput });
  }

  return { stream: generate(), finalUsage };
}
