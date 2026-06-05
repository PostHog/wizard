/**
 * McpSuggestedPromptsServices — service layer between
 * McpSuggestedPromptsScreen and the network. Decouples the screen from
 * OAuth and the streaming-agent run so the playground can inject mocks
 * (skip login, canned streaming responses) without a special-case
 * branch in the screen itself.
 *
 * Mirrors the McpInstaller pattern: thin interface, production factory
 * that wires the real implementation, no dynamic imports in the React
 * tree.
 */

import type { Credentials } from '@lib/wizard-session';
import { getOrAskForProjectData } from '@utils/setup-utils';
import { Program } from '@lib/programs/program-registry';
import type { WizardStore } from '@ui/tui/store';
import type { ApiUser } from '@lib/api';

/**
 * Discriminated union covering every kind of streamed event the screen
 * needs to render. Production yields these from Claude SDK messages;
 * the playground yields them from canned scripts.
 */
export type AgentChunk =
  | { kind: 'text'; text: string }
  | { kind: 'tool-call'; toolName: string; detail: string }
  | { kind: 'tool-result'; toolName: string; detail: string }
  | { kind: 'error'; text: string }
  /** Stream completed. `sessionId` is the SDK session ID of the just-
   *  completed turn; pass it back as `resumeSessionId` on a follow-up
   *  call to continue the conversation with full history. */
  | { kind: 'done'; sessionId?: string };

export interface McpSuggestedPromptsServices {
  /**
   * Kicks off the OAuth dance. Production wires this to
   * `getOrAskForProjectData`; the playground returns canned values
   * after a fake delay.
   *
   * While the promise is pending, the implementation is expected to set
   * `session.loginUrl` (via `store.setLoginUrl`) so the screen can
   * render the URL inline. Mocks may set/clear this URL too if they
   * want to exercise the spinner + URL layout.
   */
  performLogin(): Promise<{
    credentials: Credentials;
    roleAtOrganization: string | null;
    user: ApiUser | null;
  }>;

  /**
   * Run a prompt against Claude with the PostHog MCP server available
   * for tool use. Yields chunks as the agent streams. Caller is
   * responsible for honoring the abort signal — implementations should
   * also short-circuit when `signal.aborted` becomes true.
   *
   * In production this calls the Claude Agent SDK's `query()` with the
   * user's OAuth token as the MCP Bearer. In the playground, the demo
   * provides canned scripts.
   */
  runPromptStreaming(args: {
    prompt: string;
    credentials: Credentials;
    signal: AbortSignal;
    /** When set, resume the named SDK session so the agent sees the
     *  earlier turns as context. Used by follow-up picks; omitted on
     *  the first prompt and after `[p]` restarts the conversation. */
    resumeSessionId?: string;
  }): AsyncIterable<AgentChunk>;
}

/**
 * Production services. The `runPromptStreaming` implementation lives
 * in a separate module so the heavy SDK import is only paid when
 * actually invoked.
 */
export function createMcpSuggestedPromptsServices(
  _store: WizardStore,
): McpSuggestedPromptsServices {
  return {
    performLogin: async () => {
      const result = await getOrAskForProjectData({
        signup: false,
        ci: false,
        apiKey: undefined,
        projectId: undefined,
        email: undefined,
        region: undefined,
        // Widens the OAuth scope grant: base `WIZARD_OAUTH_SCOPES` plus
        // read on every product surface (flags, experiments, surveys,
        // replays, errors, web/LLM analytics, cohorts, persons) plus
        // annotation read/write. Persistence writes (dashboard, insight,
        // notebook) come for free from the base set. See
        // `src/lib/oauth/program-scopes.ts`.
        programId: Program.McpTutorial,
      });
      return {
        credentials: {
          accessToken: result.accessToken,
          projectApiKey: result.projectApiKey,
          host: result.host,
          projectId: result.projectId,
        },
        roleAtOrganization: result.roleAtOrganization,
        user: result.user,
      };
    },

    runPromptStreaming: (args) => runProductionPromptStreaming(args),
  };
}

async function* runProductionPromptStreaming(args: {
  prompt: string;
  credentials: Credentials;
  signal: AbortSignal;
  resumeSessionId?: string;
}): AsyncIterable<AgentChunk> {
  // Defer the SDK import to call time — the playground never hits
  // this path (it overrides the whole service object), so demo
  // sessions don't pay the SDK load cost.
  const { runMcpPromptViaSdk } = await import(
    '@lib/agent/mcp-prompt-streaming'
  );
  yield* runMcpPromptViaSdk(args);
}
