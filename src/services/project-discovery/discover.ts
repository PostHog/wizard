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
import { loadProjectDiscoveryMode } from './flag';
import { discoverProjects, type DiscoveredProjects } from './projects';
import {
  catalogScriptHosts,
  discoverTools,
  type DetectedTool,
  type DiscoveredTools,
} from './tools';
import { getProjects } from './traits/store';
import {
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
  /** The directory the run started in. A CI run can narrow `installDir` later, so the report fingerprints this one. */
  runDir: string;
  /** The walk: tree, manifests, lockfiles, `.env` key names. Local only: never reported. */
  files: RepoFiles;
  tools: DiscoveredTools;
  projects: DiscoveredProjects;
  /** What static detection read in each project but the run project, by path. */
  detected: Record<string, DetectedProject>;
};

/** Static detection in one project the run did not start in. */
export type DetectedProject = {
  framework?: Integration;
  frameworkVariant?: string;
  /** The kinds of data source whose signals sit in the project. */
  warehouseSources?: string[];
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
  session: ProgramSession,
  walk: RepoWalk,
): Promise<ToolMatch> {
  const detectors = await loadSourceDetectors(session.baseUrl);
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

/** The deepest project that holds `file`, both as paths from the root. */
function projectOf(file: string, projects: readonly Project[]): string {
  const holders = projects
    .map((project) => project.path)
    .filter((dir) => dir === '.' || file.startsWith(`${dir}/`));
  return holders.sort((a, b) => b.length - a.length)[0] ?? '.';
}

/** Each project's tools: a tool belongs to every project one of its signals sits in. */
export function toolsByProject(
  tools: readonly DetectedTool[],
  projects: readonly Project[],
): Map<string, DetectedTool[]> {
  const byProject = new Map<string, DetectedTool[]>();
  for (const tool of tools) {
    const owners = new Set(
      tool.signals
        .filter((signal) => signal.file !== null)
        .map((signal) => projectOf(signal.file ?? '', projects)),
    );
    for (const owner of owners) {
      byProject.set(owner, [...(byProject.get(owner) ?? []), tool]);
    }
  }
  return byProject;
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
    .map((project) => project.path)
    .filter((projectPath) => projectPath !== runProject)
    .slice(0, MAX_DETECTED_PROJECTS);
  const frameworks = Promise.all(
    others.map(async (projectPath) => {
      detected[projectPath] = await detectFrameworkIn(
        path.resolve(rootDir, projectPath),
      );
    }),
  ).catch((error) => {
    logToFile(`[discovery] framework detection failed: ${String(error)}`);
  });
  await Promise.race([
    frameworks,
    new Promise((resolve) => setTimeout(resolve, DETECT_BUDGET_MS).unref()),
  ]);
  for (const [projectPath, tools] of toolsByProject(
    match.tools.tools,
    projects,
  )) {
    const sources = toWarehouseSources(tools, match.detectors);
    if (sources.length === 0 || projectPath === runProject) continue;
    detected[projectPath] = {
      ...detected[projectPath],
      warehouseSources: sources.map((source) => source.kind),
    };
  }
  return detected;
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
  const runDir = ctx.session.installDir;
  const mode = await loadProjectDiscoveryMode();
  // The walk up to the workspace root stays off with the flag.
  const { rootDir, runProject } =
    mode === 'off'
      ? { rootDir: runDir, runProject: '.' }
      : findWorkspaceRoot(runDir);
  const walk = walkRepoFiles(rootDir, { runProject });
  const projects = discoverProjects(walk.files, runProject);
  ctx.setProjects(projects.projects, runProject);

  const match = await matchTools(ctx.session, walk);
  ctx.setFrameworkContext(DISCOVERY_KEY, {
    program: config.id,
    discoveredAt: new Date().toISOString(),
    rootDir,
    runDir,
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
      getProjects(ctx.session)
        .filter((project) => project.path !== runProject)
        .map(({ path: projectPath, traits }) => ({
          path: projectPath,
          traits,
        })),
    )}`,
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

export function getDiscovery(session: ProgramSession): Discovery | undefined {
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
  const files = walkRepo(session.installDir);
  setFrameworkContext?.(REPO_FILES_KEY, files);
  return files;
}
