/** Decisions as a trait source: its answers written through the one setter, as source `decisions`. */

import { logToFile } from '@utils/debug';
import { applyDetectionReport } from '../../project-discovery/traits/adapter';
import {
  setTraits,
  type TraitSink,
  type TraitWrite,
} from '../../project-discovery/traits/store';
import { INTEGRATION_TARGETS } from '../project-scope';
import { detectProjectsWithDecisions } from './projects';
import { QUESTIONS, type QuestionKey } from './questions';
import { runProgramDecisions, type RunDecisionsContext } from './service';
import type { DecisionAnswer, DecisionsResult } from './types';

/** A predicate reads as `yes` at or above this probability. */
const YES = 0.6;
/** A predicate reads as `no` at or below this probability. Between the two it says nothing. */
const NO = 0.1;

type Answers = Readonly<Record<string, DecisionAnswer>>;

/** A predicate answer as `yes` or `no` with its confidence, or undefined when it is unsure or missing. */
function yesNo(
  answers: Answers,
  key: QuestionKey,
): { value: 'yes' | 'no'; confidence: number } | undefined {
  const answer = answers[QUESTIONS[key].name];
  if (answer?.kind !== 'predicate') return undefined;
  if (answer.probability >= YES) {
    return { value: 'yes', confidence: answer.probability };
  }
  if (answer.probability <= NO) {
    return { value: 'no', confidence: 1 - answer.probability };
  }
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

/** Rank the repo's projects with Decisions and write its report as traits: frameworks, the main app and PostHog's presence. */
export async function rankProjectsWithDecisions(
  sink: TraitSink,
  programId: string,
): Promise<void> {
  const judged = await detectProjectsWithDecisions(sink.session, {
    targets: INTEGRATION_TARGETS,
    purpose: 'set up a PostHog SDK integration',
    programId,
    recommend: true,
  });
  if (!judged) return;
  applyDetectionReport(
    sink,
    judged.report,
    'decisions',
    (project) => judged.confidence[project.path],
  );
}

export type DecisionsSourceContext = RunDecisionsContext & {
  /** Where the answers land as traits. Without one they reach only the log. */
  sink?: TraitSink;
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
      await rankProjectsWithDecisions(ctx.sink, ctx.programId);
    }
    return result;
  } catch (error) {
    logToFile(`[decisions] source failed: ${String(error)}`);
    return null;
  }
}
