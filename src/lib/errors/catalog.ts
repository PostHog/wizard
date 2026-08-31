import { ErrorCodes, type ErrorCode } from './codes';
import type { ErrorCatalogEntry } from './types';

export const ERROR_CATALOG: Record<ErrorCode, ErrorCatalogEntry> = {
  [ErrorCodes.CliNodeVersion]: {
    group: 'cli',
    retry: 'no',
    description: 'Node.js runtime is older than the required range.',
  },
  [ErrorCodes.CliBadArgs]: {
    group: 'cli',
    retry: 'no',
    description: 'Unrecognized command or option.',
  },
  [ErrorCodes.CliFlagUnavailable]: {
    group: 'cli',
    retry: 'no',
    description: 'A dev-only flag or env var was passed to a published build.',
  },
  [ErrorCodes.CliInteractiveRequired]: {
    group: 'cli',
    retry: 'no',
    description:
      'The command requires an interactive terminal and has no non-interactive fallback.',
  },
  [ErrorCodes.ArgsMissingApiKey]: {
    group: 'args',
    retry: 'no',
    description: 'Non-interactive run without --api-key.',
  },
  [ErrorCodes.ArgsMissingInstallDir]: {
    group: 'args',
    retry: 'no',
    description: 'Non-interactive run without --install-dir.',
  },
  [ErrorCodes.ArgsMissingEmail]: {
    group: 'args',
    retry: 'no',
    description: 'Signup run without --email.',
  },
  [ErrorCodes.ArgsSignupProvisionFailed]: {
    group: 'args',
    retry: 'yes',
    description: 'Account provisioning for --signup failed.',
  },
  [ErrorCodes.AuthKeyType]: {
    group: 'auth',
    retry: 'no',
    description: 'The API key has the wrong type or prefix for this mode.',
  },
  [ErrorCodes.AuthInvalidOrExpired]: {
    group: 'auth',
    retry: 'no',
    description: 'The credential was rejected by the LLM gateway or API.',
  },
  [ErrorCodes.AuthSessionExpired]: {
    group: 'auth',
    // Retryable, unlike its neighbours: a new run means a new login.
    retry: 'yes',
    description: 'The OAuth grant expired or was revoked mid-run.',
  },
  [ErrorCodes.AuthMissingScope]: {
    group: 'auth',
    retry: 'no',
    description: 'The personal API key lacks a scope the run requires.',
  },
  [ErrorCodes.AuthRegionMismatch]: {
    group: 'auth',
    retry: 'no',
    description: 'The resolved region does not match the credential.',
  },
  [ErrorCodes.AuthSettingsConflict]: {
    group: 'auth',
    retry: 'no',
    description: 'A Claude settings file overrides the gateway credential.',
  },
  [ErrorCodes.AuthStoredLoginConflict]: {
    group: 'auth',
    retry: 'no',
    description:
      'The agent SDK used a stored Claude login instead of the gateway token.',
  },
  [ErrorCodes.AuthProjectFetchFailed]: {
    group: 'auth',
    retry: 'yes',
    description: 'Fetching user or project data from the PostHog API failed.',
  },
  [ErrorCodes.EnvLocalServicesDown]: {
    group: 'env',
    retry: 'yes',
    description: 'A local dev target service is not running.',
  },
  [ErrorCodes.EnvServiceOutage]: {
    group: 'env',
    retry: 'yes',
    description: 'Blocking external services are down.',
  },
  [ErrorCodes.DetectBadDirectory]: {
    group: 'detect',
    retry: 'no',
    description:
      'The install directory is missing, not a directory, or unreadable.',
  },
  [ErrorCodes.DetectNoFramework]: {
    group: 'detect',
    retry: 'no',
    description: 'Framework auto-detection found no supported framework.',
  },
  [ErrorCodes.DetectUnsupportedVersion]: {
    group: 'detect',
    retry: 'no',
    description:
      'The detected framework version is below the supported minimum.',
  },
  [ErrorCodes.DetectUnsupportedPlatform]: {
    group: 'detect',
    retry: 'no',
    description: 'The project platform has no matching skill variant.',
  },
  [ErrorCodes.DetectNoPosthogSdk]: {
    group: 'detect',
    retry: 'no',
    description:
      'The program requires an installed PostHog SDK and none was found.',
  },
  [ErrorCodes.DetectNoProjectFiles]: {
    group: 'detect',
    retry: 'no',
    description: 'The project has no files for the program to work on.',
  },
  [ErrorCodes.DetectNoSources]: {
    group: 'detect',
    retry: 'no',
    description: 'No data warehouse sources were found.',
  },
  [ErrorCodes.DetectNoPackageJson]: {
    group: 'detect',
    retry: 'no',
    description: 'The project has no package.json for the program to scan.',
  },
  [ErrorCodes.DetectNoSdks]: {
    group: 'detect',
    retry: 'no',
    description: 'None of the SDKs the program needs are installed.',
  },
  [ErrorCodes.DetectMissingStripe]: {
    group: 'detect',
    retry: 'no',
    description: 'Revenue analytics requires a Stripe SDK and none was found.',
  },
  [ErrorCodes.DetectUnclassified]: {
    group: 'detect',
    // A detect step reported a precondition failure we have no code for yet.
    // Every known cause is a property of the user's project, so retrying can
    // only burn budget — fail closed rather than inheriting `internal`'s 'yes'.
    retry: 'no',
    description: 'A detect step failed with a kind absent from the catalog.',
  },
  [ErrorCodes.SkillMenuFetchFailed]: {
    group: 'skill',
    retry: 'yes',
    description: 'The context-mill skill menu could not be fetched.',
  },
  [ErrorCodes.SkillNotFound]: {
    group: 'skill',
    retry: 'no',
    description: 'The skill id is absent from the context-mill menu.',
  },
  [ErrorCodes.SkillDownloadFailed]: {
    group: 'skill',
    retry: 'yes',
    description: 'The skill download or extraction failed.',
  },
  [ErrorCodes.AgentAbort]: {
    group: 'agent',
    retry: 'case-by-case',
    description: 'The agent emitted an [ABORT] signal with a reason.',
  },
  [ErrorCodes.AgentMcpMissing]: {
    group: 'agent',
    retry: 'yes',
    description: 'The agent could not reach the PostHog MCP server.',
  },
  [ErrorCodes.AgentResourceMissing]: {
    group: 'agent',
    retry: 'yes',
    description: 'The agent could not access a setup resource.',
  },
  [ErrorCodes.AgentRateLimit]: {
    group: 'agent',
    retry: 'yes',
    description: 'The LLM gateway rate-limited the run.',
  },
  [ErrorCodes.AgentApiError]: {
    group: 'agent',
    retry: 'yes',
    description: 'The agent hit an API error other than a rate limit.',
  },
  [ErrorCodes.AgentYaraViolation]: {
    group: 'agent',
    retry: 'no',
    description: 'The security scanner terminated the run.',
  },
  [ErrorCodes.AgentNoProgress]: {
    group: 'agent',
    retry: 'case-by-case',
    description: 'The agent ended without a single tool call.',
  },
  [ErrorCodes.AgentIncompleteTasks]: {
    group: 'agent',
    retry: 'case-by-case',
    description: 'The agent stopped with planned tasks still open.',
  },
  [ErrorCodes.AgentOrchestratorSkillVariantMissing]: {
    group: 'agent',
    retry: 'yes',
    description: 'The orchestrator could not download a needed skill variant.',
  },
  [ErrorCodes.AgentOrchestratorTasksFailed]: {
    group: 'agent',
    retry: 'case-by-case',
    description: 'The orchestrator queue drained with failed or blocked tasks.',
  },
  [ErrorCodes.AgentOrchestratorHollowRun]: {
    group: 'agent',
    retry: 'yes',
    description:
      'The orchestrator drained with zero tasks — the seed step got no usable model output.',
  },
  [ErrorCodes.AgentOrchestratorSinkInvariant]: {
    group: 'agent',
    retry: 'no',
    description: 'The orchestrator plan failed the sink coverage invariant.',
  },
  [ErrorCodes.SettingsUnfixableConflict]: {
    group: 'settings',
    retry: 'no',
    description:
      'A Claude settings conflict cannot be neutralized automatically.',
  },
  [ErrorCodes.InternalUnhandled]: {
    group: 'internal',
    retry: 'yes',
    description: 'An unexpected error escaped the pipeline.',
  },
};
