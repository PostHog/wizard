/** Test discovery mode: project discovery and a program's own detection, with no login and no agent run. */

import type { MatchKeys } from '@shared/skill-resolution';
import type {
  ProgramConfig,
  Project,
  TraitClaims,
} from '@programs/program-contract';
import {
  buildPlan,
  getDiscovery,
  getProjects,
  getTraitClaims,
  picksProject,
  planAsks,
  runDiscovery,
  settleProjects,
  toMatchKeys,
  toolsByProject,
  type PlanOffer,
  type ProjectDiscoveryMode,
} from '@services/project-discovery';
import {
  buildSession,
  SessionStore,
  type SessionArgs,
} from '@services/session';

/** One project as discovery left it: its settled traits, and what each source said. */
export type DiscoveryTestProject = Project & {
  isRunProject: boolean;
  /** Every source's value for each trait, static detection included. */
  sources: TraitClaims;
  /** The kinds of catalog tool whose signals sit in the project. */
  tools: string[];
};

/** What a run knows about the repo before login. */
export type DiscoveryTestReport = {
  program: string;
  /** The `wizard-project-discovery` value the run read. */
  mode: ProjectDiscoveryMode;
  runDir: string;
  rootDir: string;
  runProject: string;
  repoType: 'monorepo' | 'single';
  workspaceTool: string | null;
  walk: { files: number; complete: boolean; truncated: boolean };
  /** What the program's own detection read in the run project. */
  detection: {
    integration: string | null;
    label: string | null;
    posthogSdkDetected: boolean;
    discoveredFeatures: string[];
  };
  projects: DiscoveryTestProject[];
  /** False when the tool catalog could not be loaded, so no tool was matched. */
  toolsMatched: boolean;
  /** The plan the program would open after login, and whether it would ask. */
  plan: PlanOffer & { asks: boolean };
  /** The run project's match keys, which pick each skill. */
  matchKeys: MatchKeys;
};

/**
 * Run discovery and `config`'s detection as a run does before login, and
 * report what they found. It sends no discovery report and no usage events.
 * What still leaves the machine: the flag read, the tool catalog download, and
 * an error event when something fails, such as a malformed manifest, as in
 * any run. An error event holds no file content.
 */
export async function testDiscovery(
  config: ProgramConfig,
  args: SessionArgs,
): Promise<DiscoveryTestReport> {
  const store = new SessionStore(buildSession({ ...args, noTelemetry: true }));
  const ctx = store.readyContext();
  await runDiscovery(config, ctx);
  await config.onReady?.(ctx);
  settleProjects(ctx);

  const { session } = store;
  const discovery = getDiscovery(session);
  const projects = getProjects(session);
  const tools = toolsByProject(discovery?.tools.tools ?? [], projects);
  const plan = buildPlan(session, config);
  // A program that picks no project works where the run started.
  const picked = picksProject(session, config)
    ? plan.picked
    : session.runProject;
  return {
    program: config.id,
    mode: discovery?.mode ?? 'off',
    runDir: discovery?.runDir ?? session.installDir,
    rootDir: discovery?.rootDir ?? session.installDir,
    runProject: session.runProject,
    repoType: discovery?.projects.repoType ?? 'single',
    workspaceTool: discovery?.projects.workspaceTool ?? null,
    walk: {
      files: discovery?.files.files.length ?? 0,
      complete: discovery?.files.complete ?? false,
      truncated: discovery?.files.truncated ?? false,
    },
    detection: {
      integration: session.integration,
      label: session.detectedFrameworkLabel,
      posthogSdkDetected: session.posthogSdkDetected,
      discoveredFeatures: [...session.discoveredFeatures],
    },
    projects: projects.map((project) => ({
      ...project,
      isRunProject: project.path === session.runProject,
      sources: getTraitClaims(session, project.path),
      tools: (tools.get(project.path) ?? []).map((tool) => tool.kind),
    })),
    toolsMatched: discovery?.tools.failed !== true,
    plan: { ...plan, picked, asks: planAsks(session, config, plan) },
    matchKeys: toMatchKeys(
      projects.find((project) => project.path === session.runProject)?.traits ??
        {},
    ),
  };
}
