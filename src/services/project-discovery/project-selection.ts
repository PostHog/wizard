/** The project selection: every project, whether the program is eligible to run in it, the one that starts selected, and why the others are excluded. */

import type { Integration } from '@shared/constants';
import { analytics } from '@utils/analytics';
import type {
  ProgramConfig,
  ProgramSession,
  Project,
  Traits,
} from '@programs/program-contract';
import { FRAMEWORK_REGISTRY } from '../frameworks/registry';
import { getDiscovery } from './discover';
import { maySendDiscovery } from './tags';
import { getModelRepoTypes, type ModelSource } from './traits/adapter';
import { isLanguageFallback } from './traits/registry';
import { getProjects, getTraitClaims } from './traits/store';

/** Why a project is listed but not eligible. */
export type ProjectExclusionReason =
  | 'has-posthog'
  | 'unsupported-framework'
  | 'library'
  | 'tooling'
  | 'workspace-root'
  | 'not-applicable';

/** One project in the project selection. */
export type ProjectOption = {
  /** The project's path from the workspace root; `.` is that root. */
  path: string;
  framework?: Integration;
  /** The framework's display name, such as `Next.js`. */
  frameworkName?: string;
  /** Whether it can be selected. */
  eligible: boolean;
  /** Why it is not eligible. */
  exclusionReason?: ProjectExclusionReason;
  /** A source picked it as the repo's main app. */
  isMainApp: boolean;
};

export type ProjectSelection = {
  repoType: 'monorepo' | 'single';
  workspaceTool?: string;
  projects: ProjectOption[];
  /** The project that starts selected: the run's default when nobody selects another. */
  selectedProjectPath: string;
  /** False when the walk hit a cap, so some projects may be missing. */
  isDiscoveryComplete: boolean;
  /** A model source sees several apps: it called the repo a monorepo, or named a main app other than the run project. */
  isMonorepoByModel?: true;
};

type Applies = Pick<ProgramConfig, 'appliesTo'>;

function exclusionReasonFor(
  traits: Traits,
  projectPath: string,
): ProjectExclusionReason {
  if (traits.posthogInstalled === 'yes') return 'has-posthog';
  if (traits.projectRole === 'library') return 'library';
  if (traits.projectRole === 'tooling') return 'tooling';
  if (traits.workspaceRoot === projectPath) return 'workspace-root';
  if (traits.framework === undefined) return 'unsupported-framework';
  return 'not-applicable';
}

/** A workspace root with members. */
function isWorkspaceRoot(session: ProgramSession, project: Project): boolean {
  const workspaces = getDiscovery(session)?.projects.workspaces ?? [];
  return workspaces.some((workspace) => workspace.root === project.path);
}

/** A project with a framework of its own, not only a language fallback. */
function isApp(traits: Traits): boolean {
  return (
    traits.framework !== undefined && !isLanguageFallback(traits.framework)
  );
}

function toProjectOption(
  session: ProgramSession,
  config: Applies,
  project: Project,
): ProjectOption {
  const { traits } = project;
  const isRunProject = project.path === session.runProject;
  // A workspace root that is no app itself is where the apps live, not one to pick.
  const root = isWorkspaceRoot(session, project) && !isApp(traits);
  const applies = !root && (config.appliesTo?.(traits) ?? true);
  // The project the run started in is a choice, as today's default, unless it only holds the apps.
  const eligible = applies || (isRunProject && !root);
  return {
    path: project.path,
    ...(traits.framework && {
      framework: traits.framework,
      frameworkName: FRAMEWORK_REGISTRY[traits.framework].metadata.name,
    }),
    eligible,
    ...(!eligible && {
      exclusionReason: root
        ? 'workspace-root'
        : exclusionReasonFor(traits, project.path),
    }),
    isMainApp: traits.mainApp === 'yes',
  };
}

/**
 * The project that starts selected. A run that started inside a workspace
 * member keeps it. A run at the root takes the main app a source named, and
 * with no workspace marker the run directory is that root. With none named, a
 * root that is an app itself keeps the run, and a workspace root that only
 * holds the apps takes the only eligible app, else stays where it started,
 * though that root is not eligible.
 */
function defaultPick(
  session: ProgramSession,
  projects: readonly ProjectOption[],
  atHub: boolean,
): string {
  const { runProject } = session;
  const apps = projects.filter(
    (project) => project.eligible && project.path !== runProject,
  );
  const mainApp = apps.find((project) => project.isMainApp);
  if (!atHub) return runProject === '.' && mainApp ? mainApp.path : runProject;
  if (mainApp) return mainApp.path;
  return apps.length === 1 ? apps[0].path : runProject;
}

const MODEL_SOURCES: readonly ModelSource[] = ['agentic', 'decisions'];

/** A model source sees several apps: it called the repo a monorepo, or named a main app other than the run project. */
function modelSeesMonorepo(
  session: ProgramSession,
  projects: readonly ProjectOption[],
): boolean {
  return (
    Object.values(getModelRepoTypes(session)).includes('monorepo') ||
    projects.some(
      (project) => project.isMainApp && project.path !== session.runProject,
    )
  );
}

/** Whether a model source has ranked this repo's projects: a ranking records what it called the repo, a program's own answers do not. */
function modelRanked(session: ProgramSession): boolean {
  return Object.keys(getModelRepoTypes(session)).length > 0;
}

const eligibleCount = (projectSelection: ProjectSelection): number =>
  projectSelection.projects.filter((project) => project.eligible).length;

/** The project selection for one program: every project, the eligible ones, and the one that starts selected. */
export function buildProjectSelection(
  session: ProgramSession,
  config: Applies,
  /** A project the caller asked for, such as `--project`. It starts selected. */
  requestedProjectPath?: string,
): ProjectSelection {
  const discovered = getDiscovery(session)?.projects;
  const all = getProjects(session);
  const projects = all.map((project) =>
    toProjectOption(session, config, project),
  );
  const runProject = all.find((project) => project.path === session.runProject);
  // The run started at a workspace root that is no app itself.
  const atHub =
    runProject !== undefined &&
    isWorkspaceRoot(session, runProject) &&
    !isApp(runProject.traits);
  return {
    repoType: discovered?.repoType ?? 'single',
    ...(discovered?.workspaceTool && {
      workspaceTool: discovered.workspaceTool,
    }),
    projects,
    selectedProjectPath:
      requestedProjectPath ?? defaultPick(session, projects, atHub),
    isDiscoveryComplete: discovered?.complete ?? true,
    ...(modelSeesMonorepo(session, projects) && { isMonorepoByModel: true }),
  };
}

/**
 * Whether there is a choice to make: more than one project is eligible, and
 * the repo is a monorepo to static discovery or to a model source. A single
 * app is one project, whatever manifests sit below it, such as an Android
 * module or a Swift package.
 */
export function hasMultipleEligibleProjects(
  projectSelection: ProjectSelection,
): boolean {
  return (
    (projectSelection.repoType === 'monorepo' ||
      projectSelection.isMonorepoByModel === true) &&
    eligibleCount(projectSelection) > 1
  );
}

/**
 * Whether a run that asks nobody ranks its projects first. It does where there
 * is a choice. A CI run also does where several projects are eligible and no
 * model source has ranked them, since only a ranking can name a main app there.
 */
export function shouldRankProjects(
  session: ProgramSession,
  projectSelection: ProjectSelection,
): boolean {
  if (hasMultipleEligibleProjects(projectSelection)) return true;
  return (
    session.ci && eligibleCount(projectSelection) > 1 && !modelRanked(session)
  );
}

/** Whether the program works in one picked project: it says which projects it applies to, and discovery ran with the flag on. */
export function picksProject(
  session: ProgramSession,
  config: Applies,
): boolean {
  return (
    config.appliesTo !== undefined &&
    (getDiscovery(session)?.mode ?? 'off') !== 'off'
  );
}

/**
 * Whether a host is asked to pick: the program picks its project, no caller
 * named one, the run is interactive and there is a choice to make. The
 * runner and the test discovery preview both read this.
 */
export function askUserToSelectProject(
  session: ProgramSession,
  config: Applies,
  projectSelection: ProjectSelection,
  requestedProjectPath?: string,
): boolean {
  return (
    picksProject(session, config) &&
    requestedProjectPath === undefined &&
    !session.ci &&
    hasMultipleEligibleProjects(projectSelection)
  );
}

/**
 * Whether the pick takes the run out of the project it started in: that
 * project is not eligible, and the run asks for a pick or its default is
 * another one. A host that shows the project selection reads this before
 * login, to ask nothing about a project the run leaves.
 */
export function pickLeavesRunProject(
  session: ProgramSession,
  config: Applies,
  projectSelection: ProjectSelection = buildProjectSelection(session, config),
): boolean {
  if (!picksProject(session, config)) return false;
  const { runProject } = session;
  const staysEligible = projectSelection.projects.some(
    (project) => project.eligible && project.path === runProject,
  );
  if (staysEligible) return false;
  return (
    askUserToSelectProject(session, config, projectSelection) ||
    projectSelection.selectedProjectPath !== runProject
  );
}

/** The event carries at most this many projects; `project_count` is the true total. */
const MAX_PROJECTS_CAPTURED = 25;

/** The project each model source picked as the main app, for the sources that answered. */
function sourcePicks(session: ProgramSession): Record<string, string | null> {
  const picks: Record<string, string | null> = {};
  for (const project of getProjects(session)) {
    const claims = getTraitClaims(session, project.path);
    const answered = new Set(
      Object.values(claims).flatMap((list) => list.map((c) => c.source)),
    );
    for (const source of MODEL_SOURCES) {
      if (!answered.has(source)) continue;
      picks[source] ??= null;
      if (claims.mainApp?.some((claim) => claim.source === source)) {
        picks[source] = project.path;
      }
    }
  }
  return picks;
}

/** Report the project list once the sources have answered. Leaves the machine only under discovery consent. */
export function reportProjectsDiscovered(
  session: ProgramSession,
  projectSelection: ProjectSelection,
  programId: string,
): void {
  if (!maySendDiscovery(session)) return;
  const projects = getProjects(session);
  analytics.wizardCapture('projects discovered', {
    program_id: programId,
    repo_type: projectSelection.repoType,
    model_monorepo: projectSelection.isMonorepoByModel === true,
    workspace_tool: projectSelection.workspaceTool ?? null,
    complete: projectSelection.isDiscoveryComplete,
    project_count: projects.length,
    offered_count: projectSelection.projects.filter(
      (project) => project.eligible,
    ).length,
    projects: projects.slice(0, MAX_PROJECTS_CAPTURED).map((project) => ({
      path: project.path,
      framework: project.traits.framework ?? null,
      projectRole: project.traits.projectRole ?? null,
      posthogInstalled: project.traits.posthogInstalled ?? null,
      recommended: project.traits.mainApp === 'yes',
    })),
  });
}

/** Report the pick beside the default and each source's main app, so the sources can be graded against it. */
export function reportProjectsSelected(
  session: ProgramSession,
  projectSelection: ProjectSelection,
  picked: string,
  programId: string,
  /** Who picked: the person on the project picker, a caller's `--project`, or nobody. */
  pickedBy: 'person' | 'caller' | 'default',
): void {
  if (!maySendDiscovery(session)) return;
  const mainApp =
    projectSelection.projects.find((project) => project.isMainApp)?.path ??
    null;
  const sources = sourcePicks(session);
  analytics.wizardCapture('projects selected', {
    program_id: programId,
    picked,
    // The run reports its start before the pick, so the picked project's framework travels here.
    picked_framework:
      getProjects(session).find((project) => project.path === picked)?.traits
        .framework ?? null,
    picked_by: pickedBy,
    default: projectSelection.selectedProjectPath,
    kept_default: picked === projectSelection.selectedProjectPath,
    main_app: mainApp,
    kept_main_app: mainApp !== null && picked === mainApp,
    run_project: session.runProject,
    source_main_apps: sources,
    sources_matching_pick: Object.entries(sources)
      .filter(([, pick]) => pick === picked)
      .map(([source]) => source),
    unsettled_traits: getProjects(session).flatMap((project) =>
      (project.unsettled ?? []).map((name) => `${project.path}:${name}`),
    ),
  });
}
