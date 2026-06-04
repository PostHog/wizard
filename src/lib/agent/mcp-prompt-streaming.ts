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
import { getLlmGatewayUrlFromHost } from '@utils/urls';
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
const MAX_TURNS = 30;

function resolveMcpUrl(host: string): string {
  const override = runtimeEnv('MCP_URL');
  if (override) return override;
  // Parse the actual hostname rather than substring-matching the raw
  // input. `host.includes('eu.posthog.com')` would let arbitrary URLs
  // like `https://evil.eu.posthog.com.attacker.com` or
  // `https://useu.posthog.commerce` route to the EU MCP endpoint
  // (CodeQL: incomplete-url-substring-sanitization). Parsing into a
  // hostname and checking exact match / trusted subdomain blocks both.
  const hostname = parseHostname(host);
  const isEu =
    hostname === 'eu.posthog.com' || hostname.endsWith('.eu.posthog.com');
  return isEu
    ? 'https://mcp-eu.posthog.com/mcp'
    : 'https://mcp.posthog.com/mcp';
}

/**
 * Normalize a host string into a hostname suitable for trust checks.
 * Accepts either a full URL (`https://us.posthog.com`) or a bare host
 * (`us.posthog.com`). Returns the hostname lowercased, or the trimmed
 * input lowercased if parsing fails (defensive fallback so a malformed
 * value still resolves to the safer-default US endpoint).
 */
function parseHostname(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  try {
    const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return trimmed;
  }
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

/**
 * Build a system-prompt append that nudges the agent to fit its response
 * inside the current terminal window. We can't actually constrain Claude
 * — this is a soft cap that the model usually honors. The screen also
 * applies a hard truncation cap as a fallback for non-compliant runs.
 *
 * Core principle nudged at the model: TALL CONTENT IS BAD, WIDE CONTENT
 * IS GOOD. Default terminal is 120 columns × 24 rows — that's a lot of
 * horizontal space, not much vertical. Spread data across columns, never
 * stack it down rows when a horizontal layout would work.
 */
function buildTerminalFitPrompt(): string {
  const cols = process.stdout.columns ?? 120;
  const rows = process.stdout.rows ?? 24;
  // Reserve rows for wizard chrome (title, status, hint, margins).
  const messageBudget = Math.max(8, rows - 10);
  const tableRowBudget = Math.min(8, Math.max(3, rows - 14));

  return [
    `You are responding inside a CLI window that is exactly ${cols} columns wide and ${rows} rows tall. The user CAN'T SCROLL — your entire reply must fit on screen.`,
    ``,
    `LAYOUT PRINCIPLE: tall content is the enemy, wide content is your friend. You have ${cols} columns of horizontal space; use them. Spread data across columns instead of stacking it down rows.`,
    ``,
    `Hard limits:`,
    `- Aim for 3-6 lines of prose. Maximum ${messageBudget} lines total.`,
    `- Tables: max ${tableRowBudget} rows. Prefer MULTI-COLUMN tables (5-8 columns) over narrow tables with many rows. A two-column table with a long list of rows is exactly what to AVOID — that's the tall layout. If you have many key/value pairs, transpose them: keys as column headers across the top, values as a single wide row underneath.`,
    `- Lists: if there are 6+ short items, format them inline (comma-separated) or in 2-3 columns, not as a vertical bullet list.`,
    `- For tool results, summarize the 1-3 numbers that matter. Do NOT echo raw JSON or the full payload.`,
    `- Code blocks: no language tag, no leading blank lines.`,
    `- No closing pleasantries ("let me know if…", "feel free to…"). Stop when the answer is delivered.`,
    `- No section headers unless the response actually has multiple sections.`,
    `- The last paragraph should always be one line that says "Now go use our MCP to build something!"`,
  ].join('\n');
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

  // Route the SDK's LLM calls through the PostHog LLM gateway, authed
  // with the user's OAuth access token. Without these env vars the SDK
  // tries to authenticate directly against Anthropic and 401s with
  // "Invalid authentication credentials". Mirrors what `initializeAgent`
  // does in agent-interface.ts for the main runAgent flow.
  const gatewayUrl = getLlmGatewayUrlFromHost(credentials.host);
  process.env.ANTHROPIC_BASE_URL = gatewayUrl;
  process.env.ANTHROPIC_AUTH_TOKEN = credentials.accessToken;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = credentials.accessToken;
  process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = 'true';
  logToFile(
    `[runMcpPromptViaSdk] gatewayUrl=${gatewayUrl} tokenPrefix=${
      credentials.accessToken
        ? credentials.accessToken.slice(0, 4) + '***'
        : '(missing)'
    }`,
  );

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
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: buildTerminalFitPrompt(),
        },
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
