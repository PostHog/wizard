export {
  DISCOVERY_KEY,
  discoveredWarehouseDestinations,
  discoveredWarehouseSources,
  getDiscovery,
  getRepoFiles,
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
  discoverProjects,
  parentOf,
  type DiscoveredProjects,
  type Workspace,
} from './projects';
export { reportDiscovery, type DiscoveryReportStore } from './report';
export { maySendDiscovery, tagDiscovery } from './tags';
export type { DetectedTool, DiscoveredTools, ToolSignal } from './tools';
export { applyDetectionReport, joinProjectPath } from './traits/adapter';
export { toMatchKeys } from './traits/match-keys';
export { TRAITS } from './traits/registry';
export { SDK_REGISTRY } from './traits/sdks';
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
  type DiscoveredManifest,
  type RepoFiles,
} from './walk';
