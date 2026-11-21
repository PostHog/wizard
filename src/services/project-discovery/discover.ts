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

import path from 'path';
import type { Integration } from '@shared/constants';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import type {
  ProgramReadyContext,
  ProgramConfig,
} from '@programs/program-contract';
import type { ProgramSession, Project } from '@programs/program-contract';
import { gatherFrameworkContext } from '../detection/context';
import { detectFramework } from '../detection/framework';
import { FRAMEWORK_REGISTRY } from '../frameworks/registry';
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
  toolsUnder,
  type DetectedTool,
  type DiscoveredTools,
} from './tools';
import { getTraits } from './traits/store';
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
  /**
   * What static detection read in each project, by path. Discovery fills it
   * for every project but the run project. The run project's entry is kept
   * once its program's detection has run, so a run that moves to another
   * project still knows it.
   */
  detected: Record<string, DetectedProject>;
};

/** Static detection in one project, kept apart from the session, which holds the run project's only. */
export type DetectedProject = {
  framework?: Integration;
  frameworkVariant?: string;
  /** Paths the MCP scan suggests as servers. */
  mcpServers?: readonly string[];
  /** The kinds of data source whose signals sit in the project. */
  warehouseSources?: readonly string[];
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

type ToolMatch = {
  tools: DiscoveredTools;
  detectors: readonly SourceDetector[];
};

/** The tool match, which needs the catalog download. Never throws: a failure is a `failed` match. */
async function matchTools(
  catalog: Promise<readonly SourceDetector[]>,
  walk: RepoWalk,
): Promise<ToolMatch> {
  const detectors = await catalog;
  // No catalog means discovery could not look, which is not the same as
  // finding nothing. The loader has already reported why.
  if (detectors.length === 0) return { tools: FAILED_TOOLS, detectors };
  try {
    walk.files.scriptHosts = readScriptHosts(
      walk.templates,
      catalogScriptHosts(detectors),
    );
    return { tools: discoverTools(walk.files, detectors), detectors };
  } catch (error) {
    analytics.captureException(
      error instanceof Error ? error : new Error(String(error)),
      { step: 'scanCodebase' },
    );
    return { tools: FAILED_TOOLS, detectors };
  }
}

/** Static detection runs in at most this many projects beside the run project. */
const MAX_DETECTED_PROJECTS = 25;

/** Static detection in the other projects gets this long in all; a project it has not reached stays undetected. */
const DETECT_BUDGET_MS = 5_000;

/** Static detection reads this many projects at once, so a lapsed budget leaves at most this many still running. */
const DETECT_CONCURRENCY = 4;

/** The framework of one project directory, with its variant when its config reads one. */
async function detectFrameworkIn(dir: string): Promise<DetectedProject> {
  const framework = await detectFramework(dir);
  if (!framework) return {};
  const { metadata } = FRAMEWORK_REGISTRY[framework];
  if (!metadata.getVariant) return { framework };
  const context = await gatherFrameworkContext(FRAMEWORK_REGISTRY[framework], {
    installDir: dir,
    ci: true,
    debug: false,
    benchmark: false,
    yaraReport: false,
    signup: false,
  });
  const frameworkVariant = metadata.getVariant(context);
  return { framework, ...(frameworkVariant && { frameworkVariant }) };
}

/** Each project's tools: those with a signal at or below it. A project with none has no entry. */
export function toolsByProject(
  tools: readonly DetectedTool[],
  projects: readonly Project[],
): Map<string, DetectedTool[]> {
  const byProject = new Map<string, DetectedTool[]>();
  for (const project of projects) {
    const own = toolsUnder(tools, project.path);
    if (own.length > 0) byProject.set(project.path, own);
  }
  return byProject;
}

/**
 * Run `detect` for each project, at most {@link DETECT_CONCURRENCY} at a time,
 * and start none once `deadline` has passed. A project it did not reach stays
 * undetected.
 */
async function detectWithin(
  projectPaths: readonly string[],
  deadline: number,
  detect: (projectPath: string) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < projectPaths.length && Date.now() < deadline) {
      const projectPath = projectPaths[next];
      next += 1;
      await detect(projectPath);
    }
  };
  await Promise.all(Array.from({ length: DETECT_CONCURRENCY }, worker));
}

/** Static detection in every project but the run project: its framework, and the sources among its tools. */
async function detectProjects(
  rootDir: string,
  runProject: string,
  projects: readonly Project[],
  match: ToolMatch,
): Promise<Record<string, DetectedProject>> {
  const detected: Record<string, DetectedProject> = {};
  const others = projects
    .filter((project) => project.path !== runProject)
    .slice(0, MAX_DETECTED_PROJECTS);
  const frameworks = detectWithin(
    others.map((project) => project.path),
    Date.now() + DETECT_BUDGET_MS,
    async (projectPath) => {
      detected[projectPath] = await detectFrameworkIn(
        path.resolve(rootDir, projectPath),
      );
    },
  ).catch((error) => {
    logToFile(`[discovery] framework detection failed: ${String(error)}`);
  });
  // The timer covers a detection that hangs; the deadline stops new ones.
  await Promise.race([
    frameworks,
    new Promise((resolve) => setTimeout(resolve, DETECT_BUDGET_MS).unref()),
  ]);
  for (const [projectPath, tools] of toolsByProject(
    match.tools.tools,
    others,
  )) {
    const sources = toWarehouseSources(tools, match.detectors);
    if (sources.length === 0) continue;
    detected[projectPath] = {
      ...detected[projectPath],
      warehouseSources: sources.map((source) => source.kind),
    };
  }
  return detected;
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

  const match = await matchTools(catalog, walk);
  ctx.setFrameworkContext(DISCOVERY_KEY, {
    program: config.id,
    discoveredAt: new Date().toISOString(),
    rootDir,
    runDir,
    runProject,
    mode,
    files: walk.files,
    tools: match.tools,
    projects,
    // A snapshot: detection past its budget writes to a copy nobody reads.
    detected: {
      ...(await detectProjects(rootDir, runProject, projects.projects, match)),
    },
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
  // The run project's own traits settle later, once its program's detection runs.
  logToFile(
    `[discovery] traits ${JSON.stringify(
      projects.projects
        .filter((project) => project.path !== runProject)
        .slice(0, MAX_DETECTED_PROJECTS)
        .map((project) => ({
          path: project.path,
          traits: getTraits(ctx.session, project.path),
        })),
    )}`,
  );
}

/**
 * One project's tools, the run project's by default: the tools found at or
 * below it. Every reader takes tools from here, so a sibling project's tools
 * never reach the run's prompts, traits or offers.
 */
export function getTools(
  session: Pick<ProgramSession, 'frameworkContext' | 'runProject'>,
  projectPath: string = session.runProject,
): DetectedTool[] {
  const discovery = getDiscovery(session);
  return discovery ? toolsUnder(discovery.tools.tools, projectPath) : [];
}

/** The warehouse sources discovery found in the run project, for a program that offers them. */
export async function discoveredWarehouseSources(
  session: ProgramSession,
): Promise<DetectedSource[]> {
  const discovery = getDiscovery(session);
  if (!discovery) return [];
  // Resolves at once: discovery already waited for the same download.
  return toWarehouseSources(
    getTools(session),
    await loadSourceDetectors(session.baseUrl),
  );
}

/** The warehouses discovery found in the run project that PostHog can export to. */
export async function discoveredWarehouseDestinations(
  session: ProgramSession,
): Promise<DetectedDestination[]> {
  const discovery = getDiscovery(session);
  if (!discovery) return [];
  return toWarehouseDestinations(
    getTools(session),
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
