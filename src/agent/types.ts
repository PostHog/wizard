/**
 * Public type surface of the agent. Type-only, so importing it adds no
 * runtime dependency. Code outside `src/agent` imports these as
 * `@agent/types`; runtime values come from `@agent`.
 */
export type {
  AbortCase,
  AgentFailure,
  AgentRunDefinition,
  ProgramBinding,
  PromptContext,
  RunConfig,
  RunInput,
  RunResult,
  SwitchboardCtx,
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
export type { AgentChunk } from './mcp-prompt-streaming';
export type { InstallSkillResult } from './tools';
