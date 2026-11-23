export {
  DISCOVERY_KEY,
  discoveredWarehouseDestinations,
  discoveredWarehouseSources,
  getDiscovery,
  getRepoFiles,
  runDiscovery,
  type Discovery,
} from './discover';
export {
  detectedEmailProviders,
  type EmailProviderKind,
} from './email-providers';
export { reportDiscovery } from './report';
export { maySendDiscovery, tagDiscovery } from './tags';
export type { DetectedTool, DiscoveredTools } from './tools';
export { RUN_PROJECT, TRAITS } from './traits/registry';
export { getProject, getTraits } from './traits/store';
export { toMatchKeys } from './traits/match-keys';
export { manifestDirs, walkRepo, type RepoFiles } from './walk';
