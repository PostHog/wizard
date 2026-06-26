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
import { getLlmGatewayUrl } from '@utils/urls';
import { runtimeEnv } from '@env';
import { logToFile } from '@utils/debug';
import { buildAgentEnv } from '@lib/agent/agent-interface';

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

// One MCP url for every region: the server resolves the user's region from
// the bearer token, so the EU subdomain (a Claude Code OAuth workaround) is
// not needed here.
function resolveMcpUrl(): string {
  return runtimeEnv('MCP_URL') || 'https://mcp.posthog.com/mcp';
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const sessionId = (message as { session_id?: string }).session_id;
    chunks.push({ kind: 'done', sessionId });
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

  return [
    `You are responding inside a CLI window that is exactly ${cols} columns wide and ${rows} rows tall. The user CAN'T SCROLL — your entire reply must fit on screen.`,
    ``,
    `LAYOUT PRINCIPLE: tall content is the enemy, wide content is your friend. You have ${cols} columns of horizontal space; use them. Spread data across columns instead of stacking it down rows.`,
    ``,
    `Tables:`,
    `- Max 5 body rows. The prompts the user picks already constrain results to 5 or fewer — honor that and do not pad with extra rows.`,
    `- If a tool result returns more than 5 items, show the top 5 and mention the rest count inline (e.g. "...and 12 more").`,
    `- Prefer transposing wide-but-short data (items across columns, metrics down rows) when labels are short.`,
    `- A two-column table with many rows is the tall layout to AVOID.`,
    ``,
    `Other limits:`,
    `- Aim for 3-5 lines of prose. Maximum ${messageBudget} lines total.`,
    `- DO NOT announce what you are about to do. Skip preamble like "I'll query…", "Let me check…", "Now I'll…", "I'm going to…". Go straight to running tools and then the answer.`,
    `- Lists: if there are 6+ short items, format them inline (comma-separated), not as a vertical bullet list.`,
    `- For tool results, summarize the 1-3 numbers that matter. Do NOT echo raw JSON or the full payload.`,
    `- Code blocks: no language tag, no leading blank lines.`,
    `- No closing pleasantries ("let me know if…", "feel free to…"). Stop when the answer is delivered.`,
    `- No section headers unless the response actually has multiple sections.`,
    ``,
    `Naming saved artifacts:`,
    `- Every dashboard, insight, notebook, or annotation you create MUST include "(wizard MCP tutorial)" at the end of its title or name field. Examples: "Weekly signups (wizard MCP tutorial)", "Top errors this week (wizard MCP tutorial)", "Onboarding analysis (wizard MCP tutorial)".`,
    `- This applies on both create AND rename calls. If the user asks you to rename a saved artifact, preserve the "(wizard MCP tutorial)" suffix unless they explicitly ask you to drop it.`,
    `- Reason: lets the user find / clean up everything this tutorial created from one search in PostHog. Don't skip it — it's the only signal they'll have that an artifact came from the wizard.`,
    ``,
    `Tone & framing:`,
    `- This is a tutorial demoing PostHog (the product the user just installed). You are showing it off, not auditing it. Stay constructive and neutral about PostHog throughout.`,
    `- Don't editorialize about PostHog's reliability, performance, or cost. Describe what the data shows; treat anomalies as the user's data, not a platform issue.`,
    `- If a tool call fails or returns nothing, say "the query didn't return data — try a different angle" or similar. Do NOT speculate about outages, gateway issues, MCP problems, or service health.`,
    `- Avoid value-laden phrases like "worth investigating", "concerning", "red flag", "problematic", "suspicious", "alarming" when describing the user's metrics. Stick to what the numbers show; the user draws conclusions.`,
  ].join('\n');
}

export async function* runMcpPromptViaSdk(args: {
  prompt: string;
  credentials: Credentials;
  signal: AbortSignal;
  /** When set, the SDK loads the named session's prior turns as
   *  context so the follow-up prompt can reference what the agent
   *  already showed. */
  resumeSessionId?: string;
}): AsyncIterable<AgentChunk> {
  const { prompt, credentials, signal, resumeSessionId } = args;

  // Route the SDK's LLM calls through the PostHog LLM gateway, authed
  // with the user's OAuth access token. Set BEFORE loading the SDK in
  // case any in-process code reads env at module init (cached base
  // URLs, OAuth setup, etc.) — same reason `initializeAgent` does this
  // before its query() call. Without these the SDK tries to
  // authenticate directly against Anthropic and 401s with "Invalid
  // authentication credentials".
  process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = 'true';

  // Route through the PostHog LLM gateway, authed with the user's OAuth token.
  const gatewayUrl = getLlmGatewayUrl(credentials.host);
  process.env.ANTHROPIC_BASE_URL = gatewayUrl;
  process.env.ANTHROPIC_AUTH_TOKEN = credentials.accessToken;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = credentials.accessToken;

  logToFile(
    `[runMcpPromptViaSdk] gatewayUrl=${gatewayUrl} tokenPrefix=${
      credentials.accessToken
        ? credentials.accessToken.slice(0, 4) + '***'
        : '(missing)'
    }`,
  );

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { query } = await loadSdk();

  // Bridge external AbortSignal → SDK AbortController.
  const abortController = new AbortController();
  if (signal.aborted) abortController.abort();
  else
    signal.addEventListener('abort', () => abortController.abort(), {
      once: true,
    });

  const mcpUrl = resolveMcpUrl();
  logToFile(
    `[runMcpPromptViaSdk] mcpUrl=${mcpUrl} model=${MODEL} resume=${
      resumeSessionId ?? '(none)'
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
        // Match agent-interface.ts — the 1M context beta is what keeps
        // resumed follow-up sessions from truncating after a few turns.
        betas: ['context-1m-2025-08-07'],
        // Only load project-level skills/settings. Without this the SDK
        // defaults to ['user', 'project'] and a user's
        // `~/.claude/settings.json` (apiKeyHelper / env block) can
        // override the OAuth routing we set above.
        settingSources: ['project'],
        // When set, the SDK replays the named session's turns into the
        // new query so the follow-up prompt has full conversation
        // context. Omit on the first prompt for a fresh session.
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
        // Without `canUseTool` the SDK falls back to "ask the user" on
        // every MCP tool call — `permissionMode: 'acceptEdits'` only
        // relaxes Edit/Write, not MCP. Our Ink TUI has no surface to
        // answer that prompt, so the agent would stall mid-stream
        // saying things like "needs your approval to create dashboard".
        // The tutorial's whole point is demoing the MCP tools against
        // the user's project, so we auto-allow everything that matches
        // the prefix and deny anything else (defense in depth — the
        // `allowedTools` filter above already enforces this).
        canUseTool: (toolName: string, input: unknown) => {
          if (toolName.startsWith('mcp__posthog-wizard__')) {
            return Promise.resolve({
              behavior: 'allow' as const,
              updatedInput: (input ?? {}) as Record<string, unknown>,
            });
          }
          logToFile(`[runMcpPromptViaSdk] denying non-MCP tool: ${toolName}`);
          return Promise.resolve({
            behavior: 'deny' as const,
            message: `${toolName} is not available in the MCP tutorial — only PostHog MCP tools are permitted.`,
          });
        },
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
        env: {
          ...process.env,
          // Drop any shell ANTHROPIC_API_KEY so it can't silently bypass the
          // PostHog LLM gateway and defeat quota tracking and the OAuth flow.
          ANTHROPIC_API_KEY: undefined,
          // Defer MCP tool schemas to avoid bloating the system prompt.
          // posthog-wizard exposes many query tools with large schemas;
          // without deferral these consume ~113k tokens upfront, which
          // matters especially when follow-ups resume sessions.
          ENABLE_TOOL_SEARCH: 'auto:0',
          // SDK 0.3.142+ connects MCP servers in the background by
          // default; without this the agent may try to call tools
          // before posthog-wizard is connected on turn 1.
          MCP_CONNECTION_NONBLOCKING: '0',
          // Same Bedrock-fallback + telemetry-friendly headers as the
          // main runner. No wizard metadata or flags for the tutorial
          // — runs are distinguished downstream via posthog.capture
          // calls (program_id + event names), not SDK headers.
          ANTHROPIC_CUSTOM_HEADERS: buildAgentEnv({}, {}),
        },
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
