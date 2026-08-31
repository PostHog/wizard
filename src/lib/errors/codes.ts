export const ErrorCodes = {
  CliNodeVersion: 'PHW_CLI_NODE_VERSION',
  CliBadArgs: 'PHW_CLI_BAD_ARGS',
  CliFlagUnavailable: 'PHW_CLI_FLAG_UNAVAILABLE',
  CliInteractiveRequired: 'PHW_CLI_INTERACTIVE_REQUIRED',
  ArgsMissingApiKey: 'PHW_ARGS_MISSING_API_KEY',
  ArgsMissingInstallDir: 'PHW_ARGS_MISSING_INSTALL_DIR',
  ArgsMissingEmail: 'PHW_ARGS_MISSING_EMAIL',
  ArgsSignupProvisionFailed: 'PHW_ARGS_SIGNUP_PROVISION_FAILED',
  AuthKeyType: 'PHW_AUTH_KEY_TYPE',
  AuthMissingScope: 'PHW_AUTH_MISSING_SCOPE',
  AuthRegionMismatch: 'PHW_AUTH_REGION_MISMATCH',
  AuthInvalidOrExpired: 'PHW_AUTH_INVALID_OR_EXPIRED',
  AuthSettingsConflict: 'PHW_AUTH_SETTINGS_CONFLICT',
  AuthStoredLoginConflict: 'PHW_AUTH_STORED_LOGIN_CONFLICT',
  AuthProjectFetchFailed: 'PHW_AUTH_PROJECT_FETCH_FAILED',
  EnvLocalServicesDown: 'PHW_ENV_LOCAL_SERVICES_DOWN',
  EnvServiceOutage: 'PHW_ENV_SERVICE_OUTAGE',
  DetectBadDirectory: 'PHW_DETECT_BAD_DIRECTORY',
  DetectNoFramework: 'PHW_DETECT_NO_FRAMEWORK',
  DetectUnsupportedVersion: 'PHW_DETECT_UNSUPPORTED_VERSION',
  DetectUnsupportedPlatform: 'PHW_DETECT_UNSUPPORTED_PLATFORM',
  DetectNoPosthogSdk: 'PHW_DETECT_NO_POSTHOG_SDK',
  DetectNoProjectFiles: 'PHW_DETECT_NO_PROJECT_FILES',
  DetectNoSources: 'PHW_DETECT_NO_SOURCES',
  DetectNoPackageJson: 'PHW_DETECT_NO_PACKAGE_JSON',
  DetectNoSdks: 'PHW_DETECT_NO_SDKS',
  DetectMissingStripe: 'PHW_DETECT_MISSING_STRIPE',
  DetectUnclassified: 'PHW_DETECT_UNCLASSIFIED',
  SkillMenuFetchFailed: 'PHW_SKILL_MENU_FETCH_FAILED',
  SkillNotFound: 'PHW_SKILL_NOT_FOUND',
  SkillDownloadFailed: 'PHW_SKILL_DOWNLOAD_FAILED',
  AgentAbort: 'PHW_AGENT_ABORT',
  AgentMcpMissing: 'PHW_AGENT_MCP_MISSING',
  AgentResourceMissing: 'PHW_AGENT_RESOURCE_MISSING',
  AgentRateLimit: 'PHW_AGENT_RATE_LIMIT',
  AgentApiError: 'PHW_AGENT_API_ERROR',
  AgentYaraViolation: 'PHW_AGENT_YARA_VIOLATION',
  AgentNoProgress: 'PHW_AGENT_NO_PROGRESS',
  AgentIncompleteTasks: 'PHW_AGENT_INCOMPLETE_TASKS',
  AgentOrchestratorSkillVariantMissing:
    'PHW_AGENT_ORCHESTRATOR_SKILL_VARIANT_MISSING',
  AgentOrchestratorTasksFailed: 'PHW_AGENT_ORCHESTRATOR_TASKS_FAILED',
  AgentOrchestratorHollowRun: 'PHW_AGENT_ORCHESTRATOR_HOLLOW_RUN',
  AgentOrchestratorSinkInvariant: 'PHW_AGENT_ORCHESTRATOR_SINK_INVARIANT',
  SettingsUnfixableConflict: 'PHW_SETTINGS_UNFIXABLE_CONFLICT',
  InternalUnhandled: 'PHW_INTERNAL_UNHANDLED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const ERROR_CODE_PATTERN = /^PHW_[A-Z][A-Z0-9_]*$/;

export function isErrorCode(value: string): value is ErrorCode {
  return (Object.values(ErrorCodes) as string[]).includes(value);
}
