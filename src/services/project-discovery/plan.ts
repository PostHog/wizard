/** The plan: the projects a program is offered, which one starts picked, and why the others are not offered. */

import type { Integration } from '@shared/constants';
import { analytics } from '@utils/analytics';
import type {
  ProgramConfig,
  ProgramSession,
  Project,
  TraitSource,
  Traits,
} from '@programs/program-contract';
import { FRAMEWORK_REGISTRY } from '../frameworks/registry';
import { getDiscovery } from './discover';
import { maySendDiscovery } from './tags';
import { isLanguageFallback } from './traits/registry';
import { getProjects, getTraitClaims } from './traits/store';

/** Why a project is listed but not offered. */
export type PlanReason =
  | 'has-posthog'
  | 'unsupported-framework'
  | 'library'
  | 'tooling'
  | 'workspace-root'
  | 'not-applicable';

/** One project on the plan. */
export type PlanProject = {
  /** The project's path from the workspace root; `.` is that root. */
  path: string;
  framework?: Integration;
  /** The framework's display name, such as `Next.js`. */
  frameworkName?: string;
  /** Whether the person can pick it. */
  offered: boolean;
  /** Why it is not offered. */
  reason?: PlanReason;
  /** A source picked it as the repo's main app. */
  mainApp: boolean;
};

export type PlanOffer = {
  repoType: 'monorepo' | 'single';
  workspaceTool?: string;
  projects: PlanProject[];
  /** The project that starts picked: the run's default when nobody picks. */
  picked: string;
  /** False when the walk hit a cap, so some projects may be missing. */
  complete: boolean;
};

type Applies = Pick<ProgramConfig, 'appliesTo'>;

function reasonFor(traits: Traits, projectPath: string): PlanReason {
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

function toPlanProject(
  session: ProgramSession,
  config: Applies,
  project: Project,
): PlanProject {
  const { traits } = project;
  const isRunProject = project.path === session.runProject;
  // A workspace root that is no app itself is where the apps live, not one to pick.
  const root = isWorkspaceRoot(session, project) && !isApp(traits);
  const applies = !root && (config.appliesTo?.(traits) ?? true);
  // The project the run started in is always a choice: it is today's default.
  const offered = applies || isRunProject;
  return {
    path: project.path,
    ...(traits.framework && {
      framework: traits.framework,
      frameworkName: FRAMEWORK_REGISTRY[traits.framework].metadata.name,
    }),
    offered,
    ...(!offered && {
      reason: root ? 'workspace-root' : reasonFor(traits, project.path),
    }),
    mainApp: traits.mainApp === 'yes',
  };
}

/**
 * The project that starts picked. A run that started inside a project keeps
 * it, and so does a run at a workspace root that is an app itself. A run at
 * any other workspace root takes the main app, else the only app offered, else
 * stays where it started.
 */
function defaultPick(
  session: ProgramSession,
  projects: readonly PlanProject[],
  atHub: boolean,
): string {
  const { runProject } = session;
  if (!atHub) return runProject;
  const apps = projects.filter(
    (project) => project.offered && project.path !== runProject,
  );
  const mainApp = apps.find((project) => project.mainApp);
  if (mainApp) return mainApp.path;
  return apps.length === 1 ? apps[0].path : runProject;
}

/** The plan for one program: every project, the ones it is offered, and the one that starts picked. */
export function buildPlan(
  session: ProgramSession,
  config: Applies,
  /** A project the caller asked for, such as `--project`. It starts picked. */
  requested?: string,
): PlanOffer {
  const discovered = getDiscovery(session)?.projects;
  const all = getProjects(session);
  const projects = all.map((project) =>
    toPlanProject(session, config, project),
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
    picked: requested ?? defaultPick(session, projects, atHub),
    complete: discovered?.complete ?? true,
  };
}

/**
 * Whether there is a choice to make: the repo is a monorepo and more than one
 * project is offered. A single app is one project, whatever manifests sit
 * below it, such as an Android module or a Swift package.
 */
export function planNeedsPick(plan: PlanOffer): boolean {
  return (
    plan.repoType === 'monorepo' &&
    plan.projects.filter((project) => project.offered).length > 1
  );
}

/** The event carries at most this many projects; `project_count` is the true total. */
const MAX_PROJECTS_CAPTURED = 25;

const MODEL_SOURCES: readonly TraitSource[] = ['agentic', 'decisions'];

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
  plan: PlanOffer,
  programId: string,
): void {
  if (!maySendDiscovery(session)) return;
  const projects = getProjects(session);
  analytics.wizardCapture('projects discovered', {
    program_id: programId,
    repo_type: plan.repoType,
    workspace_tool: plan.workspaceTool ?? null,
    complete: plan.complete,
    project_count: projects.length,
    offered_count: plan.projects.filter((project) => project.offered).length,
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
  plan: PlanOffer,
  picked: string,
  programId: string,
  /** Who picked: the person on the plan screen, a caller's `--project`, or nobody. */
  pickedBy: 'person' | 'caller' | 'default',
): void {
  if (!maySendDiscovery(session)) return;
  const mainApp =
    plan.projects.find((project) => project.mainApp)?.path ?? null;
  const sources = sourcePicks(session);
  analytics.wizardCapture('projects selected', {
    program_id: programId,
    picked,
    picked_by: pickedBy,
    default: plan.picked,
    kept_default: picked === plan.picked,
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
