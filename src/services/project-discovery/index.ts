export {
  DISCOVERY_KEY,
  discoveredWarehouseDestinations,
  discoveredWarehouseSources,
  DETECTED_PROJECT_KEY,
  detectedProjectOf,
  getDiscovery,
  getRepoFiles,
  getTools,
  projectFromWorkspaceRoot,
  projectPathOf,
  rediscoverAfterLogin,
  runDiscovery,
  toolsByProject,
  type DetectedProject,
  type Discovery,
} from './discover';
export {
  loadProjectDiscoveryMode,
  projectDiscoveryMode,
  type ProjectDiscoveryMode,
} from './flag';
export {
  buildProjectSelection,
  pickLeavesRunProject,
  picksProject,
  askUserToSelectProject,
  hasMultipleEligibleProjects,
  shouldRankProjects,
  reportProjectsDiscovered,
  reportProjectsSelected,
  type ProjectSelection,
  type ProjectOption,
  type ProjectExclusionReason,
} from './project-selection';
export {
  discoverProjects,
  parentOf,
  type DiscoveredProjects,
  type Workspace,
} from './projects';
export {
  detectedEmailProviders,
  type EmailProviderKind,
} from './email-providers';
export { reportDiscovery } from './report';
export { DISCOVERY_TAGS_KEY, maySendDiscovery, tagDiscovery } from './tags';
export type { DetectedTool, DiscoveredTools } from './tools';
export { applyDetectionReport, joinProjectPath } from './traits/adapter';
export { toMatchKeys, toTraitKeys } from './traits/match-keys';
export { TRAITS, VERSIONED_SDK_SKILLS_ENABLED_KEY } from './traits/registry';
export { sdkFeatureGaps, type SdkFeatureGap } from './traits/sdk-features';
export { selectProjects, type ProjectPredicate } from './traits/select';
export {
  getProject,
  getProjects,
  getTraitClaims,
  getTraits,
  setTrait,
  setTraits,
  settleProjects,
  unsettledTraits,
  type TraitSink,
  type TraitWrite,
} from './traits/store';
export {
  findWorkspaceRoot,
  manifestDirs,
  walkRepo,
  type RepoFiles,
} from './walk';
