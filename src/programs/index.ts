/** Public runtime entry for the programs surface. */
export type * from './types';
export { runProgram, TASK_OUTCOMES_KEY } from './program-runner/run-program';
export { testDiscovery } from './program-runner/discovery-test';
export { scopeToProject } from './program-runner/detect-program';
export {
  buildPlan,
  getDiscovery,
  pickLeavesRunProject,
  reportDiscovery,
  runDiscovery,
  settleProjects,
} from '@services/project-discovery';
/** How a run ended; `ProgramRunOutcome.outcome` holds one. */
export { RunOutcome } from '@shared/run-state';
export { ProgramAbort } from '@programs/program-contract';
export { buildSession } from '@services/session';
export { SessionStore, applyAgentProgress } from '@services/session';
export { storeInteraction } from '@services/session';
export { createFileDestination } from '@services/session';
export { createWizardRunSync } from '@services/session';
export { PostHogDestination } from '@services/session';
export { TaskStreamPush } from '@services/session';
export { logIn } from './program-runner/login';
/** The login's tokens: scope checks, the client id and the refresh grant. */
export {
  getOAuthClientId,
  missingOAuthScopes,
  OAuthTokenResponseSchema,
  parseOAuthScopes,
} from '@shared/oauth-tokens';
export {
  apiKeyCredentials,
  resolveApiKeyLogin,
} from './program-runner/api-key-login';
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
} from './program-runner/program-registry';
/** Shared program machinery the TUI, the CLI and the e2e harness call. */
export { FRAMEWORK_REGISTRY } from '@services/frameworks';
export { detectFramework } from '@services/detection';
/** Each program's Decisions question keys, for the decisions-detect script. */
export { getProgramDecisions } from './program-runner/program-registry';
export type {
  DecisionQuestionSpec,
  DecisionsResult,
  DecisionsTransport,
} from '@services/detection/decisions';
/** The Decisions service, for the decisions-detect script. */
export function loadDecisionsService(): Promise<
  typeof import('@services/detection/decisions')
> {
  return import('@services/detection/decisions');
}
export { createSkillProgram } from './shared/skill-program';
/** The audit ledger's checks as the session holds them, for a host's task stream. */
export { getAuditChecks } from '@services/session';
/** The scan a downloaded skill goes through, for the TUI's spellbook: the TUI cannot import the agent. */
export { scanInstalledSkill } from '@agent';
