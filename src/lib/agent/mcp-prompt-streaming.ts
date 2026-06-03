/**
 * Streaming prompt runner for the McpSuggestedPromptsScreen.
 *
 * Calls the Claude Agent SDK's `query()` directly with just the PostHog
 * MCP server configured — no skills, no sandbox, no settings sources,
 * no wizard-tools. This is the lightweight cousin of `runAgent` in
 * `agent-interface.ts`: same SDK, much narrower surface, suitable for
 * "user asked a question, show the answer" interactions.
 *
 * The function is an async generator that yields `AgentChunk`s extracted
 * from the SDK's message stream. Callers (the screen) consume them via
 * `for await (...)` and render as they arrive.
 */

import type { AgentChunk } from '@ui/tui/services/mcp-suggested-prompts-services';
import type { Credentials } from '@lib/wizard-session';
import { WIZARD_USER_AGENT } from '@lib/constants';
import { runtimeEnv } from '@env';
import { logToFile } from '@utils/debug';

// Cached SDK module — first call pays the dynamic-import cost; later
// calls reuse the same module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sdkModule: any | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadSdk(): Promise<any> {
  if (!_sdkModule) {
    _sdkModule = await import('@anthropic-ai/claude-agent-sdk');
  }
  return _sdkModule;
}

const MODEL = 'claude-sonnet-4-6';

// Bounded turn count so a single prompt can't loop forever on the
// user's nickel. 20 gives the agent room for non-trivial multi-step
// chains (multi-tool reads → reason → write → verify → summarize) while
// still capping runaway loops. Worth tuning down once we see real
// telemetry on average turn counts per prompt.
const MAX_TURNS = 20;

function resolveMcpUrl(host: string): string {
  const override = runtimeEnv('MCP_URL');
  if (override) return override;
  return host.includes('eu.posthog.com')
    ? 'https://mcp-eu.posthog.com/mcp'
    : 'https://mcp.posthog.com/mcp';
}

/**
 * Extract a short, single-line summary from an arbitrary value. Used
 * for tool-call args and tool-result bodies so the screen has something
 * compact to render.
 */
function summarize(value: unknown, maxLen = 120): string {
  if (value == null) return '';
  let text: string;
  if (typeof value === 'string') text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > maxLen) text = text.slice(0, maxLen - 1) + '…';
  return text;
}

/**
 * Convert one SDK message into zero or more AgentChunks. Mirrors the
 * subset of message shapes the wizard's main runAgent middleware
 * handles, but narrowed to just the kinds the screen needs to render.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function messageToChunks(message: any): AgentChunk[] {
  const chunks: AgentChunk[] = [];

  if (message?.type === 'assistant') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const content = message.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const type = (block as { type?: string }).type;
        if (type === 'text') {
          const text = (block as { text?: string }).text ?? '';
          if (text) chunks.push({ kind: 'text', text });
        } else if (type === 'tool_use') {
          const name = (block as { name?: string }).name ?? 'tool';
          const input = (block as { input?: unknown }).input;
          chunks.push({
            kind: 'tool-call',
            toolName: name,
            detail: summarize(input),
          });
        }
      }
    }
  }

  if (message?.type === 'user') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const content = message.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const type = (block as { type?: string }).type;
        if (type === 'tool_result') {
          const detail = summarize((block as { content?: unknown }).content);
          chunks.push({ kind: 'tool-result', toolName: 'tool', detail });
        }
      }
    }
  }

  if (message?.type === 'result') {
    chunks.push({ kind: 'done' });
  }

  return chunks;
}

export async function* runMcpPromptViaSdk(args: {
  prompt: string;
  credentials: Credentials;
  signal: AbortSignal;
}): AsyncIterable<AgentChunk> {
  const { prompt, credentials, signal } = args;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { query } = await loadSdk();

  // Bridge external AbortSignal → SDK AbortController.
  const abortController = new AbortController();
  if (signal.aborted) abortController.abort();
  else
    signal.addEventListener('abort', () => abortController.abort(), {
      once: true,
    });

  const mcpUrl = resolveMcpUrl(credentials.host);
  logToFile(`[runMcpPromptViaSdk] mcpUrl=${mcpUrl} model=${MODEL}`);

  // The SDK expects an async generator for the prompt that stays open
  // until the result is received. For a single-turn prompt we yield one
  // user message and then await an abort (which fires when streaming
  // completes or the caller cancels).
  const createPromptStream = async function* () {
    yield {
      type: 'user' as const,
      session_id: '',
      message: { role: 'user' as const, content: prompt },
      parent_tool_use_id: null,
    };
    // Hold the stream open until abort. The SDK closes its end when it
    // sees a `result` message; we close ours via the abortController in
    // the finally block below.
    await new Promise<void>((resolve) => {
      if (abortController.signal.aborted) {
        resolve();
        return;
      }
      abortController.signal.addEventListener('abort', () => resolve(), {
        once: true,
      });
    });
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const response = query({
      prompt: createPromptStream(),
      options: {
        abortController,
        model: MODEL,
        cwd: process.cwd(),
        permissionMode: 'acceptEdits',
        maxTurns: MAX_TURNS,
        mcpServers: {
          'posthog-wizard': {
            type: 'http',
            url: mcpUrl,
            headers: {
              Authorization: `Bearer ${credentials.accessToken}`,
              'User-Agent': WIZARD_USER_AGENT,
            },
          },
        },
        // Only let the agent use MCP tools — no shell, no file I/O,
        // no Read/Edit/Write. This is a chat-with-MCP run, not a
        // wizard skill execution.
        allowedTools: ['mcp__posthog-wizard__*'],
      },
    });

    for await (const message of response as AsyncIterable<unknown>) {
      if (signal.aborted) return;
      for (const chunk of messageToChunks(message)) {
        yield chunk;
        if (chunk.kind === 'done') return;
      }
    }
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    logToFile(`[runMcpPromptViaSdk] error: ${text}`);
    yield { kind: 'error', text };
  } finally {
    // Closes the prompt stream so `query()` shuts down cleanly even if
    // we never saw a 'result' message.
    abortController.abort();
  }
}
