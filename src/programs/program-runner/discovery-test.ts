/** Test discovery mode: project discovery and a program's own detection, with no login and no agent run. */

import type { GatewayCredential } from '@shared/api';
import { HostResolution } from '@shared/host-resolution';
import type { MatchKeys } from '@shared/skill-resolution';
import { analytics } from '@utils/analytics';
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
import { scopeToRunProject } from './detect-program';
import { decisionKeys } from './run-program';
import {
  DECISIONS_MODEL,
  DECISIONS_USE_KEY,
  decisionsUse,
  runDecisionsSource,
  summarizeAnswers,
  type DecisionsUse,
} from '@services/detection/decisions';
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
  /** What the Decisions call did, or why none was made. */
  decisions: DecisionsPreview;
};

/** A Decisions call a preview made with a pre-issued gateway token, or the reason it made none. */
export type DecisionsPreview =
  | { asked: false; reason: string }
  | {
      asked: true;
      /** What the flag lets a run do with the answers. */
      use: Exclude<DecisionsUse, 'off'>;
      model: string;
      answered: number;
      total: number;
      durationMs: number;
      inputTokens: number;
      error?: string;
      /** Each answer: a predicate's probability, or a choice with its probability. */
      answers: Record<string, string | number>;
    };

/** Ask Decisions as a run would after login, with a pre-issued gateway token in place of the login. */
async function previewDecisions(
  config: ProgramConfig,
  store: SessionStore,
  gateway: GatewayCredential | undefined,
): Promise<DecisionsPreview> {
  if (!gateway) {
    return {
      asked: false,
      reason: 'no gateway token; set WIZARD_CI_GATEWAY_TOKEN_FILE to ask',
    };
  }
  if (!config.rankWith?.includes('decisions')) {
    return {
      asked: false,
      reason: 'this program does not rank with Decisions',
    };
  }
  const use = decisionsUse(await analytics.getAllFlagsForWizard());
  if (use === 'off') {
    return { asked: false, reason: 'wizard-decisions-detection is off' };
  }
  store.setFrameworkContext(DECISIONS_USE_KEY, use);
  // Decisions reads only the gateway from the credentials, so nothing logs in to PostHog.
  store.setCredentials({
    accessToken: '',
    projectApiKey: '',
    projectId: 0,
    host: HostResolution.fromRegion(store.session.region ?? 'us'),
    gateway,
  });
  const asTraits =
    use === 'traits' && (getDiscovery(store.session)?.mode ?? 'off') !== 'off';
  const result = await runDecisionsSource(decisionKeys(config, []), {
    session: store.session,
    setFrameworkContext: (key, value) => store.setFrameworkContext(key, value),
    programId: config.id,
    ...(asTraits && { sink: store.readyContext() }),
    rankProjects: picksProject(store.session, config),
  });
  if (!result) {
    return { asked: false, reason: 'the program declares no question to ask' };
  }
  const answered = Object.keys(result.answers).length;
  return {
    asked: true,
    use,
    model: result.model || DECISIONS_MODEL,
    answered,
    total: answered + result.unanswered.length,
    durationMs: result.durationMs,
    inputTokens: result.inputTokens,
    ...(result.error && { error: result.error }),
    answers: summarizeAnswers(result.answers),
  };
}

/**
 * Run discovery and `config`'s detection as a run does before login, and
 * report what they found. It sends no discovery report and no usage events.
 * What still leaves the machine: the flag read, the tool catalog download, and
 * an error event when something fails, such as a malformed manifest, as in
 * any run. An error event holds no file content. With a gateway token, the
 * Decisions input also goes to the gateway.
 */
export async function testDiscovery(
  config: ProgramConfig,
  args: SessionArgs,
  /** The caller's `--project`, as a path from the workspace root. */
  project?: string,
  /** A pre-issued gateway token. With one, and where its flag allows, the preview asks Decisions. */
  gateway?: GatewayCredential,
): Promise<DiscoveryTestReport> {
  const store = new SessionStore(buildSession({ ...args, noTelemetry: true }));
  const ctx = store.readyContext();
  await runDiscovery(config, ctx);
  // As a run does: detection reads the project the run works in, not the folder it started in.
  scopeToRunProject(store, project);
  await config.onReady?.(ctx);
  settleProjects(ctx);
  const decisions = await previewDecisions(config, store, gateway);

  const { session } = store;
  const discovery = getDiscovery(session);
  const projects = getProjects(session);
  const tools = toolsByProject(discovery?.tools.tools ?? [], projects);
  const requested = project === undefined ? undefined : session.runProject;
  const plan = buildPlan(session, config, requested);
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
    plan: {
      ...plan,
      picked,
      asks: planAsks(session, config, plan, requested),
    },
    matchKeys: toMatchKeys(
      projects.find((project) => project.path === session.runProject)?.traits ??
        {},
    ),
    decisions,
  };
}
