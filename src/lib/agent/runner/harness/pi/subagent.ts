/**
 * Controlled subagent dispatch for pi (#526). pi has no native subagent
 * mechanism, so a subagent is a nested `createAgentSession` we construct — which
 * means WE decide its powers, closing the leak the claude-agent-sdk path warns
 * about (it can't propagate the parent's disallowedTools into subagents).
 *
 * Controls on every child:
 *  - the SAME security extension (canUseTool + YARA, fail-closed) — shared state,
 *    so the child shares the parent's tool-call cap and violation latch;
 *  - a read-only built-in toolset (read/grep/find/ls + allowlisted bash) — no
 *    write/edit, so a subagent can research but never mutate the project;
 *  - no custom tools — no .env writes, and crucially no `dispatch_agent`, so a
 *    child cannot recurse (depth is hard-capped at 1).
 */

import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { logToFile } from '@utils/debug';
import { extractText } from './shared';

/**
 * Read-only built-ins a subagent may use. bash is supplied separately as the
 * parent's env-scrubbed tool (below), not the built-in, so a subagent's
 * subprocesses are locked down too.
 */
const SUBAGENT_TOOLS = ['read', 'grep', 'find', 'ls'];

const SUBAGENT_SYSTEM_PROMPT = [
  'You are a read-only research subagent for the PostHog wizard.',
  'You can read and search files and run safe build/inspect shell commands.',
  'You cannot edit files, modify .env, or dispatch further subagents.',
  'Investigate the task you are given and report concise findings as your final message.',
].join('\n');

function text(s: string): {
  content: [{ type: 'text'; text: string }];
  details: unknown;
} {
  return { content: [{ type: 'text', text: s }], details: {} };
}

export interface SubagentContext {
  /** Resolved gateway model (same as the parent). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: import('@earendil-works/pi-ai').Model<any>;
  /** Registry holding the gateway provider. */
  modelRegistry: import('@earendil-works/pi-coding-agent').ModelRegistry;
  cwd: string;
  agentDir: string;
  /** The parent's security extension factory — reused so the fence is inherited. */
  securityFactory: (pi: unknown) => void;
  /** The parent's env-scrubbed bash, so a subagent's subprocesses are locked down too. */
  bashTool: ToolDefinition;
  /** pi SDK entrypoints, already imported by the backend. */
  sdk: {
    createAgentSession: typeof import('@earendil-works/pi-coding-agent')['createAgentSession'];
    DefaultResourceLoader: typeof import('@earendil-works/pi-coding-agent')['DefaultResourceLoader'];
    SessionManager: typeof import('@earendil-works/pi-coding-agent')['SessionManager'];
  };
}

export function createDispatchAgentTool(ctx: SubagentContext): ToolDefinition {
  return defineTool({
    name: 'dispatch_agent',
    label: 'Dispatch subagent',
    description:
      'Delegate a focused, read-only research subtask to a subagent (e.g. "find where events are captured"). The subagent can read/search files and run safe shell, but CANNOT edit files, change .env, or dispatch further subagents. Returns its findings.',
    promptSnippet:
      'dispatch_agent(description, prompt) — delegate a read-only research subtask',
    parameters: Type.Object({
      description: Type.String({ description: 'Short label for the subtask' }),
      prompt: Type.String({ description: 'Full instruction for the subagent' }),
    }),
    // eslint-disable-next-line @typescript-eslint/require-await -- pi tool contract returns a Promise
    async execute(_id, args) {
      const { createAgentSession, DefaultResourceLoader, SessionManager } =
        ctx.sdk;

      const loader = new DefaultResourceLoader({
        cwd: ctx.cwd,
        agentDir: ctx.agentDir,
        systemPrompt: SUBAGENT_SYSTEM_PROMPT,
        noExtensions: true,
        noSkills: true,
        noContextFiles: true,
        noPromptTemplates: true,
        noThemes: true,
        extensionFactories: [ctx.securityFactory],
      });
      await loader.reload();

      const { session: child } = await createAgentSession({
        model: ctx.model,
        modelRegistry: ctx.modelRegistry,
        cwd: ctx.cwd,
        sessionManager: SessionManager.inMemory(ctx.cwd),
        resourceLoader: loader,
        tools: SUBAGENT_TOOLS, // read-only built-ins; no write/edit, no dispatch_agent
        customTools: [ctx.bashTool], // env-scrubbed bash only (still allowlist-fenced)
      });

      let result = '';
      const unsub = child.subscribe((e) => {
        if (e.type === 'message_end') {
          const t = extractText(e.message).trim();
          if (t) result = t;
        }
      });
      logToFile(`[pi] subagent dispatch: ${args.description}`);
      try {
        await child.prompt(args.prompt);
      } finally {
        unsub();
      }
      logToFile(`[pi] subagent "${args.description}" → ${result.length} chars`);
      return text(result || 'Subagent completed with no textual result.');
    },
  });
}
