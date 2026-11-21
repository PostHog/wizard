export {
  DISCOVERY_KEY,
  discoveredWarehouseDestinations,
  discoveredWarehouseSources,
  getDiscovery,
  getRepoFiles,
  rediscoverAfterLogin,
  runDiscovery,
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
export {
  detectedEmailProviders,
  type EmailProviderKind,
} from './email-providers';
export { reportDiscovery } from './report';
export { maySendDiscovery, tagDiscovery } from './tags';
export type { DetectedTool, DiscoveredTools } from './tools';
export { TRAITS } from './traits/registry';
export { getProject, getTraits } from './traits/store';
export { toMatchKeys } from './traits/match-keys';
export {
  findWorkspaceRoot,
  manifestDirs,
  walkRepo,
  type RepoFiles,
} from './walk';
