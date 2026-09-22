/**
 * Public type surface of the agent. Type-only, so importing it adds no
 * runtime dependency. Code outside `src/agent` imports these as
 * `@agent/types`; runtime values come from `@agent`.
 *
 * Audited against the stack plan (sections 4.1 to 4.3): the run contract
 * (RunConfig, RunInput, RunResult, AgentRunDefinition, AgentFailure,
 * AbortCase, PromptContext) and the progress and interaction contracts
 * (AgentProgress, AgentInteraction and their payload shapes) are final.
 * ProgramBinding and SwitchboardCtx leave in B1 with the bindings table.
 * AgentChunk leaves in C2 with runMcpPromptViaSdk. InstallSkillResult
 * leaves in A4 with downloadSkill.
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
