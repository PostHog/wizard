export { detectFramework } from './framework.js';
export { discoverFeatures } from './features.js';
export {
  gatherFrameworkContext,
  checkFrameworkVersion,
  type VersionCheckResult,
} from './context.js';
export {
  detectProjectsWithAgent,
  coerceAgenticReport,
  type DetectTarget,
  type AgenticProject,
  type AgenticDetectionReport,
  type AgenticDetectOptions,
  type DetectEvent,
} from './agentic.js';
export {
  detectFrameworkRouted,
  getJevMode,
  type JevMode,
  type RoutedDetection,
} from './jev/route.js';
export {
  detectWithJev,
  summarizeJevReport,
  type JevDetectionReport,
} from './jev/index.js';
