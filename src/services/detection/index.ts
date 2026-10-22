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
  detectPostHogIntegration,
  reportWarehouseSourcesDetected,
} from './integration';
export {
  POSTHOG_SDKS,
  STRIPE_SDKS,
  findPackageJsons,
  type PackageMatch,
} from './package-scanning';
export {
  detectIntegrationProjects,
  scopeInstallDirToProject,
  toIntegrationCandidates,
} from './project-scope';
