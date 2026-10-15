/**
 * The Decisions judgment service. A run collects the questions its programs
 * declare in `ProgramConfig.decisions`, asks them in one call over the project
 * decisions scan, and stores the answers for the programs to read. Knows nothing
 * about any program: the questions and what they decide live with each program.
 */

import { IS_PRODUCTION_BUILD, runtimeEnv } from '@env';
import { WIZARD_DECISIONS_DETECTION_FLAG_KEY } from '@shared/constants';
import type { DecisionsTransport } from '@shared/decisions-client';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import type { ProgramSession } from '../../program-session';
import { getDecisionsScan } from './scan';
import { maySendScanResults } from '../../codebase-scan/tags';
import { askDecisions } from './ask';
import { renderDecisionInput } from './input';
import type {
  DecisionAnswer,
  DecisionsMode,
  DecisionsResult,
  ProgramDecisions,
} from './types';

/** frameworkContext key holding the run's `DecisionsResult`. */
export const DECISIONS_KEY = 'decisions';

/** The flag decides; a dev build's `WIZARD_DECISIONS_DETECTION` overrides it. */
export function getDecisionsMode(flags: Record<string, string>): DecisionsMode {
  if (!IS_PRODUCTION_BUILD) {
    const override = runtimeEnv('WIZARD_DECISIONS_DETECTION')?.toLowerCase();
    if (override === 'off' || override === 'shadow' || override === 'primary') {
      return override;
    }
  }
  const flag = flags[WIZARD_DECISIONS_DETECTION_FLAG_KEY];
  return flag === 'shadow' || flag === 'primary' ? flag : 'off';
}

/** The run's pre-issued gateway key (dev and CI runs). Minted production tokens are not wired yet. */
export function decisionsTransport(
  session: ProgramSession,
): DecisionsTransport | null {
  const gateway = session.credentials?.gateway;
  return gateway?.token.trim() ? { gateway } : null;
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
  if (mode === 'off' || specs.length === 0) return null;

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
