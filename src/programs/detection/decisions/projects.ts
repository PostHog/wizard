/**
 * Project detection through the judgment service: the same report the agent
 * scan returns (`AgenticDetectionReport`), from one Decisions call over the
 * decisions scan instead of an agent run. Candidate apps are the folders that hold a
 * manifest; the model classifies each into the caller's targets and picks the
 * main one. Whether PostHog is installed is a package lookup, not a judgment.
 */

import type { DecisionsTransport } from '@shared/decisions-client';
import { logToFile } from '@utils/debug';
import type { ProgramSession } from '../../program-session';
import type {
  AgenticDetectionReport,
  AgenticProject,
  DetectTarget,
} from '../agentic';
import { getDecisionsScan, manifestDirs, type DecisionsScan } from './scan';
import { askDecisions } from './ask';
import { renderDecisionInput } from './input';
import { decisionsTransport } from './service';
import type { DecisionQuestionSpec } from './types';

/** Folders classified in one call; the gateway takes 32 questions and two are fixed. */
const MAX_CANDIDATES = 12;
/** A target or main-app answer below this probability isn't acted on. */
export const PROJECT_CONFIDENCE = 0.6;
const NOT_A_TARGET = 'none';

export type JudgedProjects = {
  report: AgenticDetectionReport;
  /** Every listed project's target, and the main app when asked for, cleared {@link PROJECT_CONFIDENCE}. */
  confident: boolean;
};

export type JudgeProjectsOptions = {
  targets: readonly DetectTarget[];
  purpose?: string;
  recommend?: boolean;
  fetchImpl?: typeof fetch;
  /** Where a failed call's reason goes. Defaults to the log file. */
  onError?: (message: string) => void;
};

/** Whether a manifest in `dir` (not a subfolder) declares a PostHog SDK. */
function hasPostHogIn(scan: DecisionsScan, dir: string): boolean {
  return scan.manifests.some((m) => {
    const manifestDir = m.path.includes('/')
      ? m.path.slice(0, m.path.lastIndexOf('/'))
      : '.';
    return (
      manifestDir === dir &&
      m.packages.some((p) => p.toLowerCase().includes('posthog'))
    );
  });
}

function targetQuestion(
  index: number,
  dir: string,
  targets: readonly DetectTarget[],
  purpose: string,
): DecisionQuestionSpec {
  return {
    name: `project_${index}_target`,
    kind: 'choice',
    instructions: `Which of these is the project rooted at \`${dir}\`? Judge from its own dependencies and files. When several match, answer the one listed first. Answer ${NOT_A_TARGET} when it matches none, or when it is a shared library, config or tooling package rather than an app.`,
    choices: {
      ...Object.fromEntries(targets.map((t) => [t.id, t.name])),
      [NOT_A_TARGET]: 'None of these, or not an app',
    },
    purpose: `Find the projects to ${purpose}.`,
  };
}

/**
 * Classify the repo's candidate apps. Returns null when the call can't be made
 * or fails; the caller then keeps its agent scan.
 */
export async function detectProjectsWithDecisions(
  session: ProgramSession,
  options: JudgeProjectsOptions,
): Promise<JudgedProjects | null> {
  const transport = decisionsTransport(session);
  if (!transport) return null;
  return judgeProjects(getDecisionsScan(session), transport, options);
}

/** {@link detectProjectsWithDecisions} for a scan and transport the caller holds. */
export async function judgeProjects(
  scan: DecisionsScan,
  transport: DecisionsTransport,
  options: JudgeProjectsOptions,
): Promise<JudgedProjects | null> {
  const { targets, recommend = false } = options;
  const purpose = options.purpose ?? 'set up a PostHog integration';

  const candidates = manifestDirs(scan).slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) candidates.push('.');

  const specs: DecisionQuestionSpec[] = candidates.map((dir, i) =>
    targetQuestion(i, dir, targets, purpose),
  );
  specs.push({
    name: 'is_monorepo',
    kind: 'predicate',
    instructions:
      'This repository holds several independently deployable apps or packages.',
    purpose: 'Decide whether to offer a choice of app.',
  });
  // The API rejects a choice with fewer than two values; one folder needs no pick.
  if (recommend && candidates.length > 1) {
    specs.push({
      name: 'primary_app',
      kind: 'choice',
      instructions:
        'Which folder holds the main user-facing app of this repository?',
      choices: Object.fromEntries(candidates.map((dir) => [dir, null])),
      purpose: 'Suggest which app to set up first.',
    });
  }

  const result = await askDecisions(renderDecisionInput(scan), specs, {
    transport,
    fetchImpl: options.fetchImpl,
  });
  if (result.error && Object.keys(result.answers).length === 0) {
    (options.onError ?? logToFile)(
      `[decisions] project detection failed: ${result.error}`,
    );
    return null;
  }

  const projects: AgenticProject[] = [];
  let confident = true;
  for (const [i, dir] of candidates.entries()) {
    const answer = result.answers[`project_${i}_target`];
    if (answer?.kind !== 'choice' || answer.choice === NOT_A_TARGET) continue;
    const target = targets.find((t) => t.id === answer.choice);
    if (!target) continue;
    if (answer.probability < PROJECT_CONFIDENCE) confident = false;
    projects.push({
      path: dir,
      framework: target.name,
      targetId: target.id,
      hasPostHog: hasPostHogIn(scan, dir),
    });
  }

  if (recommend) {
    const primary = result.answers.primary_app;
    const pick =
      candidates.length === 1
        ? projects[0]
        : primary?.kind === 'choice' &&
          primary.probability >= PROJECT_CONFIDENCE
        ? projects.find((p) => p.path === primary.choice)
        : undefined;
    if (!pick) confident = false;
    for (const project of projects) project.recommended = project === pick;
    // The picker lists the recommended project first, as the agent scan's report does.
    projects.sort((a, b) => Number(b.recommended) - Number(a.recommended));
  }

  const monorepo = result.answers.is_monorepo;
  const repoType =
    projects.length > 1 ||
    (monorepo?.kind === 'predicate' && monorepo.probability >= 0.5)
      ? 'monorepo'
      : 'single';
  return {
    report: { repoType, projects },
    confident: confident && projects.length > 0,
  };
}

/** Flat comparison of two reports for the shadow log. */
export function compareProjectReports(
  agent: AgenticDetectionReport,
  judged: AgenticDetectionReport,
): Record<string, string | number | boolean | null> {
  const key = (p: AgenticProject) => `${p.path}=${p.targetId ?? 'none'}`;
  const agentKeys = new Set(agent.projects.map(key));
  const judgedKeys = new Set(judged.projects.map(key));
  const shared = [...agentKeys].filter((k) => judgedKeys.has(k)).length;
  const recommended = (r: AgenticDetectionReport) =>
    r.projects.find((p) => p.recommended)?.path ?? null;
  return {
    agent_projects: agent.projects.length,
    decisions_projects: judged.projects.length,
    matching_projects: shared,
    projects_agree:
      shared === agentKeys.size && agentKeys.size === judgedKeys.size,
    agent_recommended: recommended(agent),
    decisions_recommended: recommended(judged),
    repo_type_agree: agent.repoType === judged.repoType,
  };
}
