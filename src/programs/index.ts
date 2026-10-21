/** Public runtime entry for the programs surface. */
import { IS_PRODUCTION_BUILD } from '@env';
export type * from './types';
export { runProgram, TASK_OUTCOMES_KEY } from './run-program';
export { reportCodebaseScan, scanCodebaseFor } from './codebase-scan';
/** How a run ended; `ProgramRunOutcome.outcome` holds one. */
export { RunOutcome } from '@shared/run-state';
export { ProgramAbort } from './program-abort';
export { buildSession } from './session/wizard-session';
export { SessionStore, applyAgentProgress } from './session/session-store';
export { storeInteraction } from './session/interaction';
export { createFileDestination } from './session/task-stream/destinations/file';
export { createWizardRunSync } from './session/task-stream/wizard-run-sync';
export { PostHogDestination } from './session/task-stream/destinations/posthog';
export { TaskStreamPush } from './session/task-stream/task-stream-push';
export { logIn } from './login';
/** The login's tokens: scope checks, the client id and the refresh grant. */
export {
  getOAuthClientId,
  missingOAuthScopes,
  OAuthTokenResponseSchema,
  parseOAuthScopes,
} from '@shared/oauth-tokens';
export { loadWizardFlags } from './wizard-flags';
export { apiKeyCredentials, resolveApiKeyLogin } from './api-key-login';
export {
  /** OAuth scopes a program's login asks for. */
  getOAuthScopesForProgram,
  getProvisioningScopesForProgram,
  Program,
  PROGRAM_REGISTRY,
  getProgramConfig,
  findProgramConfig,
  getCommandPath,
  getSubcommandPrograms,
} from './program-registry';
/** Shared program machinery the TUI, the CLI and the e2e harness call. */
export { FRAMEWORK_REGISTRY } from './frameworks/registry';
export { detectFramework } from './detection/framework';
/** Each program's Decisions question keys, for the decisions-detect script. */
export { getProgramDecisions } from './program-registry';
export type {
  DecisionQuestionSpec,
  DecisionsResult,
  DecisionsTransport,
} from './detection/decisions';
/**
 * The Decisions service, for the decisions-detect script. Null in production
 * builds, which drop the import and don't bundle the service.
 */
export async function loadDecisionsService(): Promise<
  typeof import('./detection/decisions') | null
> {
  return IS_PRODUCTION_BUILD ? null : import('./detection/decisions');
}
export { createSkillProgram } from './shared/skill-program';
/** The audit ledger's checks as the session holds them, for a host's task stream. */
export { getAuditChecks } from './session/audit-checks';
/** The scan a downloaded skill goes through, for the TUI's spellbook: the TUI cannot import the agent. */
export { scanInstalledSkill } from '@agent';
