export {
  DISCOVERY_KEY,
  discoveredWarehouseDestinations,
  discoveredWarehouseSources,
  getDiscovery,
  getRepoFiles,
  getTools,
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
  buildPlan,
  picksProject,
  planAsks,
  planNeedsPick,
  reportProjectsDiscovered,
  reportProjectsSelected,
  type PlanOffer,
  type PlanProject,
  type PlanReason,
} from './plan';
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
export { TRAITS } from './traits/registry';
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
