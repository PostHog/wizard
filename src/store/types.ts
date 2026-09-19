/** Shape of the store surface: every type another surface consumes. Type-only re-exports keep it free of runtime imports. */
export type { AgentSignal } from './agent-protocol/agent-signals.js';
export type {
  AgentChunk,
  McpPromptRequest,
  McpPromptRunner,
} from './agent-protocol/mcp-prompt.js';
export type {
  AbortCase,
  ProgramRun,
  ProgramRunConfig,
  PromptContext,
} from './agent-protocol/program-run.js';
export type { ApiProject, ApiUser } from './api.js';
export type {
  AgenticDetectOptions,
  AgenticDetectionReport,
  DetectTarget,
} from './detection/agentic.js';
export type { PackageManagerDetector } from './detection/package-manager.js';
export type { FileWatcherHandle, FileWatcherOptions } from './file-watcher.js';
export type { SetupQuestion } from './framework-config.js';
export type { WizardReadinessResult } from './health-checks/readiness.js';
export type {
  AllServicesHealth,
  HealthCheckKey,
} from './health-checks/types.js';
export type { HostResolution } from './host-resolution.js';
export type { ProjectDataProfile } from './mcp-project-profile.js';
export type { PromptOption, RoleGreeting } from './mcp-role-prompts.js';
export type { AuditCheck, AuditStatus } from './programs/audit/types.js';
export type {
  DetectedProject,
  DetectionReport,
} from './programs/error-tracking-upload-source-maps/detect-agentic.js';
export type {
  ErrorTrackingDetectionReport,
  ErrorTrackingProject,
} from './programs/error-tracking/detect-agentic.js';
export type {
  HealthIssue,
  HealthIssueSeverity,
} from './programs/posthog-doctor/types.js';
export type { ProgramId } from './programs/program-registry.js';
export type { ProgramConfig } from './programs/program-step.js';
export type { RevenueDetectError } from './programs/revenue-analytics/detect.js';
export type {
  IntegrationDetectionReport,
  IntegrationProject,
} from './programs/self-driving/detect-agentic.js';
export type { SelfDrivingDetectError } from './programs/self-driving/detect.js';
export type { WarehouseDetectError } from './programs/warehouse-source/detect.js';
export type { RepeatBlockTracker } from './security/yara-hooks.js';
export type { ScanContext } from './security/yara-policy.js';
export type {
  SettingsConflict,
  SettingsConflictSource,
} from './services/claude-settings.js';
export type { McpClientResult } from './services/steps/add-mcp-server-to-clients/results.js';
export type { CliSteeringTarget } from './services/steps/install-cli-steering/index.js';
export type { SecretVault } from './session/secret-vault.js';
export type { WizardAskBridge } from './session/wizard-ask-bridge.js';
export type {
  AdditionalFeature,
  AskAnswers,
  AskQuestion,
  Credentials,
  OutroData,
  PendingQuestion,
  RunPhase,
  TaskNotice,
  WizardSession,
} from './session/wizard-session.js';
export type { Harness, Integration, Sequence } from './shared/constants.js';
export type { ErrorCode } from './shared/errors/codes.js';
export type { ProvisioningResult } from './shared/provisioning.js';
export type { CloudRegion, WizardRunOptions } from './shared/types.js';
export type {
  PlannedEvent,
  TokenUsageSnapshot,
  WizardStore,
} from './state/store.js';
export type { TaskStreamPush } from './task-stream/task-stream-push.js';
export type {
  CliEntry,
  InstallSkillResult,
  SkillEntry,
} from './tools/tools.js';
export type {
  AuthErrorDetail,
  SpinnerHandle,
  TokenUsageDelta,
  WizardUI,
} from './ui/wizard-ui.js';
export type { WizardSpellbook } from './wizard-spellbook.js';
export type { StoreBoundaryMember, WizardStoreApi } from './state/store-api.js';
export type {
  ActionView,
  ControlHooks,
  ControlState,
  ControlSurface,
  DetectRequest,
  DriverAction,
  OutroView,
  RunRecord,
  RunRequest,
  RunResult,
  RunStatus,
  SetupQuestionView,
  TaskNoticeView,
} from './control/types.js';
export type {
  ControlServerHandle,
  ControlServerOptions,
} from './control/server.js';
