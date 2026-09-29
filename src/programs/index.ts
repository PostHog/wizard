/** Public runtime entry for the programs surface. */
export type * from './types';
export { runProgram, TASK_OUTCOMES_KEY } from './run-program';
/** How a run ended; `ProgramRunOutcome.outcome` holds one. */
export { RunOutcome } from '@shared/run-state';
export { detectProgram } from './detect-program';
export { ProgramAbort } from './program-abort';
export { buildSession } from './session/wizard-session';
export { SessionStore } from './session/session-store';
export { storeInteraction } from './session/interaction';
export { createFileDestination } from './session/task-stream/destinations/file';
export { createWizardRunSync } from './session/task-stream/wizard-run-sync';
export { PostHogDestination } from './session/task-stream/destinations/posthog';
export { TaskStreamPush } from './session/task-stream/task-stream-push';
export {
  ANSWER_ACTIONS,
  outroDataParam,
  projectControlState,
  SESSION_SETTERS,
  sessionControlTarget,
} from './session/control';
export { logIn } from './login';
/** The login's tokens: scope checks, the client id and the refresh grant. */
export {
  getOAuthClientId,
  missingOAuthScopes,
  OAuthTokenResponseSchema,
  parseOAuthScopes,
} from './oauth/tokens';
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
export { needsFrameworkSetup } from './framework-config';
export { createSkillProgram } from './shared/skill-program';
/** The audit ledger's checks as the session holds them, for a host's task stream. */
export { getAuditChecks } from './session/audit-checks';
