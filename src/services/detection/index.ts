export {
  PROJECT_MANIFESTS,
  coerceAgenticReport,
  detectProjectsWithAgent,
  resolveProjectDir,
  type AgenticDetectionReport,
  type DetectEvent,
  type DetectProgress,
  type DetectTarget,
} from './agentic';
export { gatherFrameworkContext } from './context';
export { noteDetectedFramework } from './detected-framework';
export { detectFramework } from './framework';
export {
  detectMcpServer,
  detectPostHogIntegration,
  noteScannedWarehouseSources,
  reportWarehouseSourcesDetected,
} from './integration';
export {
  POSTHOG_SDKS,
  STRIPE_SDKS,
  findPackageJsons,
  type PackageMatch,
} from './package-scanning';
export {
  POSTHOG_SDKS_KEY,
  recordPostHogSdksIfNeeded,
  safePosthogSdkFacts,
  scanPostHogSdks,
} from './posthog-sdks';
export {
  detectIntegrationProjects,
  scopeInstallDirToProject,
  toIntegrationCandidates,
} from './project-scope';
