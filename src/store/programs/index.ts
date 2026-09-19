/** Program registry and definitions consumed by the cli and the tui. */
export { createSkillProgram } from './agent-skill/index.js';
export { aiObservabilityConfig } from './ai-observability/index.js';
export { auditConfig } from './audit/index.js';
export { startAuditLedgerWatcher } from './audit/ledger-watcher.js';
export {
  AUDIT_CHECKS_FILE,
  AUDIT_REPORT_FILE,
  AUDIT_SEVERITY_STYLE,
  getAuditChecks,
} from './audit/types.js';
export { detectSourceMapsProjects } from './error-tracking-upload-source-maps/detect-agentic.js';
export {
  MANUAL_SDK_VARIANTS,
  SOURCE_MAPS_CONTEXT_KEYS,
} from './error-tracking-upload-source-maps/detect.js';
export {
  VARIANT_DISPLAY_NAME,
  detectSourceMapsPrerequisites,
  errorTrackingUploadSourceMapsConfig,
} from './error-tracking-upload-source-maps/index.js';
export {
  ERROR_TRACKING_PROJECT_PATH_KEY,
  detectErrorTrackingProjects,
} from './error-tracking/detect-agentic.js';
export { errorTrackingConfig } from './error-tracking/index.js';
export { flowFor } from './flow-for.js';
export { mcpAnalyticsConfig } from './mcp-analytics/index.js';
export { metricsConfig } from './metrics/index.js';
export { migrationConfig } from './migration/index.js';
export { fetchHealthIssues } from './posthog-doctor/fetch.js';
export { posthogDoctorConfig } from './posthog-doctor/index.js';
export { getKindMeta } from './posthog-doctor/kind-metadata.js';
export { maybeStampAiSdkDetected } from './posthog-integration/detect.js';
export {
  SETUP_REPORT_FILE,
  posthogIntegrationConfig,
} from './posthog-integration/index.js';
export {
  PROGRAM_REGISTRY,
  Program,
  agentSkillConfig,
  getCommandPath,
  getLaunchablePrograms,
  getProgramConfig,
} from './program-registry.js';
export {
  REPLAY_VISION_SUPPORTED,
  replayVisionConfig,
} from './replay-vision/index.js';
export { revenueAnalyticsConfig } from './revenue-analytics/index.js';
export { runConfigFor } from './run-config.js';
export { detectSelfDrivingIntegrationProjects } from './self-driving/detect-agentic.js';
export {
  GITHUB_REQUIRED_BODY,
  GITHUB_REQUIRED_MESSAGE,
  SELF_DRIVING_INTEGRATE_PATH_KEY,
} from './self-driving/detect.js';
export { selfDrivingConfig } from './self-driving/index.js';
export {
  NO_DEFAULT_LIMIT,
  PRICING_LONG,
  PRICING_SHORT,
} from './self-driving/pricing.js';
export { POSTHOG_SDKS, STRIPE_SDKS } from './shared/package-scanning.js';
export { getDetectedWarehouseSources } from './warehouse-source/detect.js';
export { warehouseSourceConfig } from './warehouse-source/index.js';
export { webAnalyticsDoctorConfig } from './web-analytics-doctor/index.js';
