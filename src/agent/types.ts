/**
 * Public type surface of the agent. Type-only, so importing it adds no
 * runtime dependency. Code outside `src/agent` imports these as
 * `@agent/types`; runtime values come from `@agent`.
 */

/** The run contract and the progress and interaction contracts. */
export type {
  AbortCase,
  AgentFailure,
  AgentRunDefinition,
  PromptContext,
  RunConfig,
  ResolvedBinding,
  RunHooks,
  RunInput,
  RunResult,
} from './runner';
export type {
  AgentInteraction,
  AgentProgress,
  AskAnswers,
  AskQuestion,
  AuthErrorDetail,
  OutroData,
  PendingQuestion,
  SpinnerHandle,
  TaskNotice,
  TokenUsageDelta,
} from './progress';

/** The binding a program declares, and how a caller routes a run. */
export type { AgentBinding, AgentRouting } from './runner';

/** What `RunHooks.recordTaskOutcomes` receives: each orchestrated task's final state. */
export type { TaskOutcome } from './runner';

/** One streamed piece of an MCP prompt run: text, a tool call or result, an error, or the end. */
export type { McpPromptChunk } from './mcp-prompt-streaming';
