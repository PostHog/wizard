/**
 * Public type surface of the agent. Type-only, so importing it adds no
 * runtime dependency. Code outside `src/agent` imports these as
 * `@agent/types`; runtime values come from `@agent`. Grouped by fate, per the
 * stack plan (sections 4.1 to 4.3).
 */

/** Stays. The run contract and the progress and interaction contracts. */
export type {
  AbortCase,
  AgentFailure,
  AgentRunDefinition,
  PromptContext,
  RunConfig,
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

/** Leaves in B1 with the bindings table. */
export type { ProgramBinding, SwitchboardCtx } from './runner';

/** Leaves in B2 with downloadSkill. */
export type { InstallSkillResult } from './tools';

/** Leaves in B2 with the legacy adapter that records it. */
export type { TaskOutcome } from './runner';

/** Leaves in C2 with runMcpPromptViaSdk. */
export type { AgentChunk } from './mcp-prompt-streaming';
