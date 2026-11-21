/**
 * The run's one discovery: what the wizard learns by reading the repo. Every
 * run discovers once, before its program's detection, and every reader reads
 * that result instead of looking on its own, so local suggestions, the
 * warehouse flow, the self-driving prompt and the report all agree. Each
 * program derives its own view from it in `onReady`; discovery writes no
 * program's keys, so a composed run sees only what its own program chose.
 *
 * Discovery always runs; consent only gates reporting (see `report.ts`).
 */

import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import type {
  ProgramReadyContext,
  ProgramConfig,
} from '@programs/program-contract';
import type { ProgramSession } from '@programs/program-contract';
import {
  toWarehouseDestinations,
  toWarehouseSources,
} from '../warehouse-sources/detect';
import { loadSourceDetectors } from '../warehouse-sources/registry';
import type {
  DetectedDestination,
  DetectedSource,
  SourceDetector,
} from '../warehouse-sources/types';
import { loadProjectDiscoveryMode, type ProjectDiscoveryMode } from './flag';
import { discoverProjects, type DiscoveredProjects } from './projects';
import {
  catalogScriptHosts,
  discoverTools,
  type DiscoveredTools,
} from './tools';
import {
  emptyRepoFiles,
  findWorkspaceRoot,
  readScriptHosts,
  walkRepo,
  walkRepoFiles,
  type RepoFiles,
  type RepoWalk,
} from './walk';

/** frameworkContext key holding the run's discovery, every discovered tool included. */
export const DISCOVERY_KEY = 'discovery';

export type Discovery = {
  /** The program whose detection ran discovery. */
  program: string;
  discoveredAt: string;
  /**
   * The directory discovery walked: the workspace root, or the run directory
   * with no workspace or the flag off.
   */
  rootDir: string;
  /** The directory the run started in. */
  runDir: string;
  /**
   * The project the run started in, as a path from `rootDir`. A CI run can
   * narrow `installDir` later, so the report fingerprints this project.
   */
  runProject: string;
  /** The flag mode discovery ran in. Every later step follows this value and never reads the flag itself. */
  mode: ProjectDiscoveryMode;
  /** The walk: tree, manifests, lockfiles, `.env` key names. Local only: never reported. */
  files: RepoFiles;
  tools: DiscoveredTools;
  projects: DiscoveredProjects;
};

type DiscoveryContext = Pick<
  ProgramReadyContext,
  'session' | 'setFrameworkContext' | 'setProjects'
>;

const FAILED_TOOLS: DiscoveredTools = {
  tools: [],
  complete: false,
  failed: true,
};

/** The tool match, which needs the catalog download. Never throws: a failure is a `failed` match. */
async function matchTools(
  catalog: Promise<readonly SourceDetector[]>,
  walk: RepoWalk,
): Promise<DiscoveredTools> {
  const detectors = await catalog;
  // No catalog means discovery could not look, which is not the same as
  // finding nothing. The loader has already reported why.
  if (detectors.length === 0) return FAILED_TOOLS;
  try {
    walk.files.scriptHosts = readScriptHosts(
      walk.templates,
      catalogScriptHosts(detectors),
    );
    return discoverTools(walk.files, detectors);
  } catch (error) {
    analytics.captureException(
      error instanceof Error ? error : new Error(String(error)),
      { step: 'scanCodebase' },
    );
    return FAILED_TOOLS;
  }
}

/** `read()`, or `fallback()` when it throws, so discovery stays best-effort. */
function guarded<T>(step: string, read: () => T, fallback: () => T): T {
  try {
    return read();
  } catch (error) {
    analytics.captureException(
      error instanceof Error ? error : new Error(String(error)),
      { step },
    );
    return fallback();
  }
}

/** A walk that found nothing and says it is not complete, for a walk that threw. */
function failedWalk(dir: string): RepoWalk {
  return {
    files: { ...emptyRepoFiles(dir), complete: false },
    templates: [],
    durationMs: 0,
  };
}

/**
 * Discover once per run. Tools and projects fail apart: projects need only the
 * walk, tools also need the catalog. Best-effort: never throws.
 */
export async function runDiscovery(
  config: Pick<ProgramConfig, 'id'>,
  ctx: DiscoveryContext,
): Promise<void> {
  if (getDiscovery(ctx.session)) return;
  // Started first, so the download overlaps the flag read and the walk.
  const catalog = loadCatalog(ctx.session);
  const mode = await loadProjectDiscoveryMode();
  await discover(config, ctx, ctx.session.installDir, mode, catalog);
}

/**
 * Discover again when login changed the flag's answer. The first discovery
 * runs before login, where a flag rolled out to people or organizations still
 * answers `off`. Call it once, right after login.
 */
export async function rediscoverAfterLogin(
  config: Pick<ProgramConfig, 'id'>,
  ctx: DiscoveryContext,
): Promise<void> {
  const discovery = getDiscovery(ctx.session);
  if (!discovery) return;
  const mode = await loadProjectDiscoveryMode();
  if (mode === discovery.mode) return;
  const catalog = loadCatalog(ctx.session);
  await discover(config, ctx, discovery.runDir, mode, catalog);
}

/** The catalog download. Never rejects: no catalog is an empty one. */
function loadCatalog(
  session: ProgramSession,
): Promise<readonly SourceDetector[]> {
  return loadSourceDetectors(session.baseUrl).catch(
    (): readonly SourceDetector[] => [],
  );
}

async function discover(
  config: Pick<ProgramConfig, 'id'>,
  ctx: DiscoveryContext,
  runDir: string,
  mode: ProjectDiscoveryMode,
  catalog: Promise<readonly SourceDetector[]>,
): Promise<void> {
  // The walk up to the workspace root stays off with the flag.
  const atRunDir = () => ({ rootDir: runDir, runProject: '.' });
  const { rootDir, runProject } =
    mode === 'off'
      ? atRunDir()
      : guarded('findWorkspaceRoot', () => findWorkspaceRoot(runDir), atRunDir);
  const walk = guarded(
    'walkRepo',
    () => walkRepoFiles(rootDir, { runProject }),
    () => failedWalk(rootDir),
  );
  const projects = guarded(
    'discoverProjects',
    () => discoverProjects(walk.files, runProject),
    () => discoverProjects(emptyRepoFiles(rootDir), runProject),
  );
  ctx.setProjects(projects.projects, runProject);

  const tools = await matchTools(catalog, walk);
  ctx.setFrameworkContext(DISCOVERY_KEY, {
    program: config.id,
    discoveredAt: new Date().toISOString(),
    rootDir,
    runDir,
    runProject,
    mode,
    files: walk.files,
    tools,
    projects,
  } satisfies Discovery);

  logToFile(
    `[discovery] mode=${mode} walked ${walk.files.files.length} file(s) in ${walk.durationMs}ms` +
      ` complete=${String(walk.files.complete)} truncated=${String(
        walk.files.truncated,
      )}` +
      ` repoType=${projects.repoType} tool=${
        projects.workspaceTool ?? 'none'
      }` +
      ` runProject=${runProject} projects=${projects.projects
        .map((project) => project.path)
        .join(',')}`,
  );
}

/** The warehouse sources discovery found, for a program that offers them. */
export async function discoveredWarehouseSources(
  session: ProgramSession,
): Promise<DetectedSource[]> {
  const discovery = getDiscovery(session);
  if (!discovery) return [];
  // Resolves at once: discovery already waited for the same download.
  return toWarehouseSources(
    discovery.tools.tools,
    await loadSourceDetectors(session.baseUrl),
  );
}

/** The warehouses discovery found that PostHog can export to. */
export async function discoveredWarehouseDestinations(
  session: ProgramSession,
): Promise<DetectedDestination[]> {
  const discovery = getDiscovery(session);
  if (!discovery) return [];
  return toWarehouseDestinations(
    discovery.tools.tools,
    await loadSourceDetectors(session.baseUrl),
  );
}

export function getDiscovery(
  session: Pick<ProgramSession, 'frameworkContext'>,
): Discovery | undefined {
  return session.frameworkContext[DISCOVERY_KEY] as Discovery | undefined;
}

/** frameworkContext key caching a walk of a directory discovery did not walk. Local only: never reported. */
const REPO_FILES_KEY = 'repoFiles';

/** The walk of `session.installDir`: discovery's when it walked that directory, else walked once and cached. */
export function getRepoFiles(
  session: ProgramSession,
  setFrameworkContext?: (key: string, value: unknown) => void,
): RepoFiles {
  const discovered = getDiscovery(session)?.files;
  if (discovered?.dir === session.installDir) return discovered;
  const kept = session.frameworkContext[REPO_FILES_KEY] as
    | RepoFiles
    | undefined;
  if (kept?.dir === session.installDir) return kept;
  const files = guarded(
    'walkRepo',
    () => walkRepo(session.installDir),
    () => failedWalk(session.installDir).files,
  );
  setFrameworkContext?.(REPO_FILES_KEY, files);
  return files;
}
