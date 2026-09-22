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
  InferenceAuthProvider,
  RunAgentOptions,
  RunConfig,
  ResolvedBinding,
  RunFlags,
  RunHooks,
  RunInput,
  RunResult,
  SeedTaskEntry,
} from './runner';
export type { GatewayAuth } from '@shared/gateway-auth';
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

/** Generic switchboard input types retained for the B2 compatibility export. */
export type { ProgramBinding, SwitchboardCtx } from './runner';
export type { EffortLevel } from './runner/switchboard/models';

/** Leaves in B2 with downloadSkill. */
export type { InstallSkillResult } from './tools';

/** Leaves in C2 with runMcpPromptViaSdk. */
export type { AgentChunk } from './mcp-prompt-streaming';
