/** Public type entry for the programs surface. */
export type { ProgramId, SubcommandProgram } from './registry/program-registry';
export type {
  ProgramConfig,
  ProgramRunStep,
  ProgramReadyContext,
} from './run/program-step';
export type { ProgramCompletionContext } from './run/program-run';
export type {
  FrameworkConfig,
  SetupQuestion,
} from './frameworks/framework-config';
export type {
  HostFailure,
  ProgramCiHost,
  ProgramRunHost,
} from './host/host-capabilities';
export type { AuthHost } from './host/authenticate';
export type { InteractionUi, ProgressUi } from './host/host-ui';
export type { ProjectDataHost } from './host/project-data';
export type {
  ProgramInput,
  ProgramOptions,
  ProgramRunOutcome,
  ProgramWorkflowConnector,
} from './run/run-program';
export type {
  ProgramInvocationData,
  ProgramProgress,
  ProgramStoreProjection,
  SettledProgramRun,
} from './run/program-store';
export type {
  ProgramBinding,
  ProgramSwitchboardCtx,
  ProgramSwitchboardTrace,
} from './registry/binding';
export type { ProgramRun } from './run/program-run';
export type { ProgramLaunchArgs, ProgramSession } from './run/program-session';
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
