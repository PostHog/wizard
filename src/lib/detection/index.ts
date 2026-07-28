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
