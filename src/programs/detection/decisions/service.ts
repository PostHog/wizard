/**
 * The Decisions judgment service. A run collects the questions its programs
 * declare in `ProgramConfig.decisions`, asks them in one call over the project
 * decisions scan, and stores the answers for the programs to read. Knows nothing
 * about any program: the questions and what they decide live with each program.
 */

import { IS_PRODUCTION_BUILD, runtimeEnv } from '@env';
import { WIZARD_DECISIONS_DETECTION_FLAG_KEY } from '@shared/constants';
import type { GatewayCredential } from '@shared/api';
import { readCiGatewayCredential } from '@shared/ci-gateway';
import type { DecisionsTransport } from '@shared/decisions-client';
import type { CloudRegion } from '@utils/types';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import type { ProgramSession } from '../../program-session';
import { getDecisionsScan } from './scan';
import { maySendScanResults } from '../../codebase-scan/tags';
import { askDecisions } from './ask';
import { renderDecisionInput } from './input';
import type {
  DecisionAnswer,
  DecisionQuestionSpec,
  DecisionsMode,
  DecisionsResult,
  ProgramDecisions,
} from './types';

/** frameworkContext key holding the run's `DecisionsResult`. */
export const DECISIONS_KEY = 'decisions';

/**
 * On runs the service in shadow: ask, log, compare, never act. The flag decides;
 * a dev build's `WIZARD_DECISIONS_DETECTION` overrides it. Primary mode has no
 * switch yet, so the code that acts on answers stays unused.
 */
export function getDecisionsMode(flags: Record<string, string>): DecisionsMode {
  if (!IS_PRODUCTION_BUILD) {
    const override = runtimeEnv('WIZARD_DECISIONS_DETECTION');
    if (override !== undefined) return isOn(override) ? 'shadow' : 'off';
  }
  return isOn(flags[WIZARD_DECISIONS_DETECTION_FLAG_KEY]) ? 'shadow' : 'off';
}

function isOn(value: string | undefined): boolean {
  return ['true', '1', 'shadow'].includes(value?.trim().toLowerCase() ?? '');
}

/**
 * The run's pre-issued gateway key (`--ci` runs), else, in a dev build, the key
 * in `WIZARD_CI_GATEWAY_TOKEN_FILE`. Only Decisions uses the second: the
 * agents keep minting from the login. Minted tokens aren't wired for Decisions.
 */
export function decisionsTransport(
  session: ProgramSession,
): DecisionsTransport | null {
  const gateway =
    session.credentials?.gateway ??
    devGatewayKey(session.credentials?.host.region);
  return gateway?.token.trim() ? { gateway } : null;
}

// Read once: `readCiGatewayCredential` clears the variable after reading it.
let devGateway: GatewayCredential | null | undefined;

function devGatewayKey(
  region: CloudRegion | undefined,
): GatewayCredential | null {
  if (devGateway !== undefined) return devGateway;
  devGateway = null;
  if (IS_PRODUCTION_BUILD || !runtimeEnv('WIZARD_CI_GATEWAY_TOKEN_FILE')) {
    return devGateway;
  }
  try {
    devGateway = readCiGatewayCredential(region ?? 'us');
    logToFile(
      '[decisions] using the dev gateway key from WIZARD_CI_GATEWAY_TOKEN_FILE',
    );
  } catch (error) {
    logToFile(`[decisions] dev gateway key unreadable: ${String(error)}`);
  }
  return devGateway;
}

export type RunDecisionsContext = {
  session: ProgramSession;
  setFrameworkContext: (key: string, value: unknown) => void;
  flags: Record<string, string>;
  fetchImpl?: typeof fetch;
};

/**
 * Ask every declared question once, before the first agent run. Never throws;
 * returns null when the mode is off or nothing was declared.
 */
export async function runProgramDecisions(
  declarations: readonly ProgramDecisions[],
  ctx: RunDecisionsContext,
): Promise<DecisionsResult | null> {
  const mode = getDecisionsMode(ctx.flags);
  const sharing = maySendScanResults(ctx.session);
  const specs = declarations
    .flatMap((d) => d.questions)
    .filter((spec) => sharing || !spec.shared);
  if (specs.length === 0) return null;
  if (mode === 'off') {
    // Said once, so a run with Decisions off reads differently from one that never reached this hook.
    logToFile(
      `[decisions] mode=off: ${specs.length} question(s) not asked. Turn on with the ${WIZARD_DECISIONS_DETECTION_FLAG_KEY} flag, or WIZARD_DECISIONS_DETECTION=true in a dev build.`,
    );
    return null;
  }

  const transport = decisionsTransport(ctx.session);
  let result: DecisionsResult;
  if (!transport) {
    result = {
      mode,
      answers: {},
      unanswered: specs.map((s) => s.name),
      model: '',
      durationMs: 0,
      inputTokens: 0,
      redactedLines: 0,
      error: 'no gateway key for this run',
    };
  } else {
    const input = renderDecisionInput(
      getDecisionsScan(ctx.session, ctx.setFrameworkContext),
    );
    result = {
      mode,
      ...(await askDecisions(input, specs, {
        transport,
        fetchImpl: ctx.fetchImpl,
      })),
    };
  }
  ctx.setFrameworkContext(DECISIONS_KEY, result);

  const compared = Object.assign(
    {},
    ...declarations.map((d) => d.compare?.(ctx.session, result.answers) ?? {}),
  ) as Record<string, string | number | boolean | null>;
  logToFile(
    `[decisions] mode=${mode} answered=${Object.keys(result.answers).length}/${
      specs.length
    } ms=${result.durationMs} tokens=${result.inputTokens} redacted=${
      result.redactedLines
    }${result.error ? ` error=${result.error}` : ''} ${JSON.stringify({
      answers: summarizeAnswers(result.answers),
      compared,
    })}`,
  );
  if (sharing) {
    analytics.wizardCapture('decisions detection completed', {
      mode,
      model: result.model,
      duration_ms: result.durationMs,
      input_tokens: result.inputTokens,
      answered: Object.keys(result.answers).length,
      unanswered: result.unanswered.length,
      failed: Boolean(result.error),
      answers: summarizeAnswers(result.answers),
      ...compared,
    });
  }
  return result;
}

/** Each answer as one flat value: a predicate's probability, or a choice and its probability. */
export function summarizeAnswers(
  answers: Readonly<Record<string, DecisionAnswer>>,
): Record<string, string | number> {
  const round = (n: number) => Math.round(n * 100) / 100;
  return Object.fromEntries(
    Object.entries(answers).map(([name, answer]) => [
      name,
      answer.kind === 'predicate'
        ? round(answer.probability)
        : `${answer.choice}@${round(answer.probability)}`,
    ]),
  );
}

export function getDecisions(
  session: ProgramSession,
): DecisionsResult | undefined {
  return session.frameworkContext[DECISIONS_KEY] as DecisionsResult | undefined;
}

/** An answer a program may act on: only in primary mode. Shadow answers are for comparison. */
export function actionableAnswer(
  session: ProgramSession,
  name: string,
): DecisionAnswer | undefined {
  const result = getDecisions(session);
  return result?.mode === 'primary' ? result.answers[name] : undefined;
}

/** A predicate's probability a program may act on, else null. */
export function actionableProbability(
  session: ProgramSession,
  name: string,
): number | null {
  const answer = actionableAnswer(session, name);
  return answer?.kind === 'predicate' ? answer.probability : null;
}

/** A predicate's `likely` fact applies at or above this; a choice's fact too. */
const LIKELY = 0.6;
/** A predicate's `unlikely` fact applies at or below this. */
const UNLIKELY = 0.1;
/** Choice values that never become a fact. */
const NO_FACT_CHOICES: ReadonlySet<string> = new Set(['other', 'none']);

/**
 * The facts `questions` declare, for the answers a program may act on, one
 * line each in question order. Empty in shadow mode and for unsure answers.
 */
export function questionFacts(
  session: ProgramSession,
  questions: readonly DecisionQuestionSpec[],
): string[] {
  const facts: string[] = [];
  for (const question of questions) {
    const answer = actionableAnswer(session, question.name);
    if (!answer) continue;
    if (answer.kind === 'predicate') {
      if (answer.probability >= LIKELY && question.facts?.likely) {
        facts.push(question.facts.likely);
      } else if (answer.probability <= UNLIKELY && question.facts?.unlikely) {
        facts.push(question.facts.unlikely);
      }
    } else if (
      question.fact &&
      answer.probability >= LIKELY &&
      !NO_FACT_CHOICES.has(answer.choice)
    ) {
      facts.push(question.fact.replace('{choice}', answer.choice));
    }
  }
  return facts;
}

/**
 * The `ProgramConfig` fields for a program that asks `questions`: the
 * declaration, and the facts its answers give the agents.
 */
export function askQuestions(questions: readonly DecisionQuestionSpec[]): {
  decisions: ProgramDecisions;
  projectFacts: (session: ProgramSession) => readonly string[];
} {
  return {
    decisions: { questions },
    projectFacts: (session) => questionFacts(session, questions),
  };
}
