/** Public type entry for the programs surface. */
export type { ProgramId, SubcommandProgram } from './program-registry';
export type {
  ProgramConfig,
  ProgramRunStep,
  ProgramReadyContext,
} from './program-step';
export type { ProgramCompletionContext, ProgramRun } from './program-run';
export type { FrameworkConfig, SetupQuestion } from './framework-config';
export type {
  HostFailure,
  ProgramCiHost,
  ProgramRunHost,
} from './host-capabilities';
export type { AuthHost } from './authenticate';
export type { ProjectDataHost } from './project-data';
export type {
  ProgramInput,
  ProgramOptions,
  ProgramOverrides,
  ProgramRunOutcome,
  ProgramSettings,
  WizardFlagSnapshot,
} from './run-program';
export type {
  ProgramDataProgress,
  ProgramDiagnostic,
  ProgramInvocationData,
  ProgramProgress,
  ProgramRunProgress,
  SettledProgramRun,
} from './program-store';
export type { ProgramSwitchboardCtx } from './binding';
export type { ProgramLaunchArgs, ProgramSession } from './program-session';
export type { AuditCheck, AuditStatus } from './audit/types';
export type {
  DetectedProject,
  DetectionReport,
} from './error-tracking-upload-source-maps/detect-agentic';
export type {
  ErrorTrackingDetectionReport,
  ErrorTrackingProject,
} from './error-tracking/detect-agentic';
export type { HealthIssue, HealthIssueSeverity } from './posthog-doctor/index';
export type { RevenueDetectError } from './revenue-analytics/index';
export type {
  IntegrationDetectionReport,
  IntegrationProject,
} from './self-driving/detect-agentic';
export type { SelfDrivingDetectError } from './self-driving/index';
export type { WarehouseDetectError } from './warehouse-source/index';
export type { TaskStreamPush } from './task-stream/task-stream-push';
