import type { Credentials } from '../session/wizard-session.js';

/** One streamed piece of an MCP suggested-prompt run, as the TUI renders it. */
export type AgentChunk =
  | { kind: 'text'; text: string }
  /** `command` carries CLI mode's exec command string (`call <tool> …`) so the
   *  screen can recover the inner tool for context-aware follow-ups. */
  | { kind: 'tool-call'; toolName: string; detail: string; command?: string }
  | { kind: 'tool-result'; toolName: string; detail: string }
  | { kind: 'error'; text: string }
  /** Stream completed. `sessionId` is the SDK session ID of the just-
   *  completed turn; pass it back as `resumeSessionId` on a follow-up
   *  call to continue the conversation with full history. */
  | { kind: 'done'; sessionId?: string };

/** What the TUI asks the agent to run for a suggested prompt. */
export interface McpPromptRequest {
  prompt: string;
  credentials: Credentials;
  signal: AbortSignal;
  /** Prior SDK session to continue, so a follow-up can reference earlier turns. */
  resumeSessionId?: string;
  /** Program this run's gateway spend attributes to. */
  programId?: string;
  integration?: string;
}
