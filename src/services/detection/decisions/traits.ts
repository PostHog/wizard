/** Decisions as a trait source: its answers written through the one setter, as source `decisions`. */

import { logToFile } from '@utils/debug';
import {
  applyDetectionReport,
  type ReportSink,
} from '../../project-discovery/traits/adapter';
import {
  setTraits,
  type TraitWrite,
} from '../../project-discovery/traits/store';
import { INTEGRATION_SCAN } from '../project-scope';
import { getDiscovery } from '../../project-discovery/discover';
import { detectProjectsWithDecisions, PROJECT_CONFIDENCE } from './projects';
import { QUESTIONS, type QuestionKey } from './questions';
import {
  readPredicate,
  runProgramDecisions,
  type RunDecisionsContext,
} from './service';
import type { DecisionAnswer, DecisionsResult } from './types';

type Answers = Readonly<Record<string, DecisionAnswer>>;

/** A predicate answer as `yes` or `no` with its confidence, or undefined when it is unsure or missing. */
function yesNo(
  answers: Answers,
  key: QuestionKey,
): { value: 'yes' | 'no'; confidence: number } | undefined {
  const answer = answers[QUESTIONS[key].name];
  if (answer?.kind !== 'predicate') return undefined;
  const value = readPredicate(answer.probability);
  if (value === 'yes') return { value, confidence: answer.probability };
  if (value === 'no') return { value, confidence: 1 - answer.probability };
  return undefined;
}

/** The program-question answers that are traits, as writes for one project. Every other question stays a question. */
export function decisionTraitWrites(
  projectPath: string,
  answers: Answers,
): TraitWrite[] {
  const from = { projectPath, source: 'decisions' as const };
  const writes: TraitWrite[] = [];
  const llm = yesNo(answers, 'calls_llm_api');
  if (llm) writes.push({ ...from, name: 'callsLlmApi', ...llm });
  const web = yesNo(answers, 'web_frontend');
  if (web) writes.push({ ...from, name: 'webFrontend', ...web });
  const mcp = yesNo(answers, 'is_mcp_server');
  // The project itself is the server; a `no` names no path, so it writes nothing.
  if (mcp?.value === 'yes') {
    writes.push({
      ...from,
      name: 'mcpServers',
      value: ['.'],
      confidence: mcp.confidence,
    });
  }
  return writes;
}

/**
 * Rank the repo's projects with Decisions and write its report as traits:
 * frameworks, the main app and PostHog's presence. It judges the walk of the
 * workspace root, so a run that started in one member still ranks them all. A
 * project whose target is below {@link PROJECT_CONFIDENCE} writes nothing.
 */
export async function rankProjectsWithDecisions(
  sink: ReportSink,
  programId: string,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const workspace = getDiscovery(sink.session)?.files;
  const judged = await detectProjectsWithDecisions(
    sink.session,
    {
      ...INTEGRATION_SCAN,
      programId,
      recommend: true,
      fetchImpl,
    },
    workspace,
  );
  if (!judged) return;
  const confident = judged.report.projects.filter(
    (project) => (judged.confidence[project.path] ?? 0) >= PROJECT_CONFIDENCE,
  );
  applyDetectionReport(
    sink,
    { ...judged.report, projects: confident },
    'decisions',
    (project) => judged.confidence[project.path],
    // The workspace walk's paths are already from the workspace root.
    workspace ? '.' : undefined,
  );
}

export type DecisionsSourceContext = RunDecisionsContext & {
  /** Where the answers land as traits. Without one they reach only the log. */
  sink?: ReportSink;
  /** False to ask the program's questions alone, for a project picked after the ranking. */
  rankProjects?: boolean;
};

/**
 * Decisions as one of a program's sources: ask the program's questions of the
 * run project, and with a sink, write the answers and a ranking of the repo's
 * projects as traits of source `decisions`. Never throws: a failed call writes
 * nothing.
 */
export async function runDecisionsSource(
  keys: readonly QuestionKey[],
  ctx: DecisionsSourceContext,
): Promise<DecisionsResult | null> {
  try {
    const result = await runProgramDecisions(keys, ctx);
    if (!ctx.sink) return result;
    if (result) {
      setTraits(
        ctx.sink,
        decisionTraitWrites(ctx.sink.session.runProject, result.answers),
      );
    }
    if (ctx.rankProjects !== false) {
      await rankProjectsWithDecisions(ctx.sink, ctx.programId, ctx.fetchImpl);
    }
    return result;
  } catch (error) {
    logToFile(`[decisions] source failed: ${String(error)}`);
    return null;
  }
}
