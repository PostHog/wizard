/** Public runtime entry for the programs surface. */
export type * from './types';
export { PROGRAM_BINDINGS, resolveProgramBinding } from './binding';
export { getProgramCommandments } from './commandments';
export { captureSwitchboardDecision } from './binding-telemetry';
export { areSeededTasksEnabled, resolveStageOverrides } from './experiments';
/** Load gateway minting only when the caller requests model auth. */
export function createPosthogInferenceAuthProvider(
  posthog: import('@shared/api').Credentials,
  programId: string,
): import('@agent/types').InferenceAuthProvider {
  return {
    resolve: async () => {
      const { createPosthogInferenceAuthProvider } = await import(
        './credentials'
      );
      return createPosthogInferenceAuthProvider(posthog, programId).resolve();
    },
  };
}
/** Keep agent and execution imports out of CLI startup until a program runs. */
export async function runProgram(
  programId: string,
  input: import('./run-program').ProgramInput,
  options?: import('./run-program').ProgramOptions,
): Promise<import('./run-program').ProgramRunOutcome> {
  const entry = await import('./run-program');
  return entry.runProgram(programId, input, options);
}
/** Source-map project detection runs an agent; load it when a screen asks. */
export async function detectSourceMapsProjects(
  ...args: Parameters<
    typeof import('./error-tracking-upload-source-maps/detect-agentic').detectSourceMapsProjects
  >
): Promise<
  import('./error-tracking-upload-source-maps/detect-agentic').DetectionReport
> {
  const entry = await import(
    './error-tracking-upload-source-maps/detect-agentic'
  );
  return entry.detectSourceMapsProjects(...args);
}
/**
 * Agent capabilities a host reaches through programs: skill installs (scanned
 * with the agent's rules) and the suggested-prompt stream, whose SDK module
 * the agent loads on first call.
 */
export { downloadSkill, runMcpPromptViaSdk } from '@agent';
/** Task streaming loads when a run starts, not at CLI startup. */
export const loadTaskStream = () => import('./task-stream/index');
export {
  Program,
  PROGRAM_REGISTRY,
  getProgramConfig,
  getSubcommandPrograms,
  getCommandPath,
  getLaunchablePrograms,
} from './program-registry';
export { agentSkillConfig } from './program-registry';
export { FRAMEWORK_REGISTRY } from './registry';
export { authenticate, refreshAccessTokenIfNeeded } from './authenticate';
export { detectErrorCode } from './detect-map';
export {
  AUDIT_CHECKS_KEY,
  AUDIT_REPORT_FILE,
  AUDIT_SEVERITY_STYLE,
  getAuditChecks,
} from './audit/types';
export { startAuditLedgerWatcher } from './audit/ledger-watcher';
export { auditConfig } from './audit/index';
export { createSkillProgram } from './agent-skill/index';
export { aiObservabilityConfig } from './ai-observability/index';
export {
  MANUAL_SDK_VARIANTS,
  SOURCE_MAPS_CONTEXT_KEYS,
  VARIANT_DISPLAY_NAME,
  errorTrackingUploadSourceMapsConfig,
} from './error-tracking-upload-source-maps/index';
export {
  ERROR_TRACKING_PROJECT_PATH_KEY,
  detectErrorTrackingProjects,
} from './error-tracking/detect-agentic';
export { errorTrackingConfig } from './error-tracking/index';
export { mcpAnalyticsConfig } from './mcp-analytics/index';
export { metricsConfig } from './metrics/index';
export { migrationConfig } from './migration/index';
export {
  fetchHealthIssues,
  getKindMeta,
  posthogDoctorConfig,
} from './posthog-doctor/index';
export {
  maybeStampAiSdkDetected,
  reportWarehouseSourcesDetected,
} from './posthog-integration/detect';
export {
  SETUP_REPORT_FILE,
  posthogIntegrationConfig,
} from './posthog-integration/index';
export {
  REPLAY_VISION_SUPPORTED,
  replayVisionConfig,
} from './replay-vision/index';
export {
  POSTHOG_SDKS,
  STRIPE_SDKS,
  revenueAnalyticsConfig,
} from './revenue-analytics/index';
export {
  GITHUB_REQUIRED_BODY,
  GITHUB_REQUIRED_MESSAGE,
  SELF_DRIVING_INTEGRATE_PATH_KEY,
} from './self-driving/detect';
export { detectSelfDrivingIntegrationProjects } from './self-driving/detect-agentic';
export { selfDrivingConfig } from './self-driving/index';
export {
  getDetectedWarehouseSources,
  warehouseSourceConfig,
} from './warehouse-source/index';
