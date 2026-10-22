/** One Decisions request for a set of declared questions, with the state redacted first. */

import { redactSecretLines } from '@agent';
import {
  classifyQuestions,
  DECISIONS_MODEL,
  toDecisionAnswer,
} from './classifier';
import type { DecisionState } from './input';
import type {
  DecisionAnswer,
  DecisionQuestionSpec,
  DecisionsResult,
  DecisionsTransport,
} from './types';

/** The gateway's `/v1/systemone` refuses more questions than this in one request. */
export const DECISIONS_MAX_QUESTIONS_PER_CALL = 32;
/** Per-attempt timeout; a transient failure is retried once. */
const DECISIONS_TIMEOUT_MS = 8_000;

export type AskOptions = {
  transport: DecisionsTransport;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type AskResult = Omit<DecisionsResult, 'mode'>;

/** One question per name; the first declaration wins. */
export function uniqueSpecs(
  specs: readonly DecisionQuestionSpec[],
): DecisionQuestionSpec[] {
  const seen = new Set<string>();
  return specs.filter((spec) => {
    if (seen.has(spec.name)) return false;
    seen.add(spec.name);
    return true;
  });
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/** Drop every line with a secret or PII match from each field. Rejects when the scanner can't load. */
async function redactState(
  state: DecisionState,
): Promise<{ state: DecisionState; redactedLines: number }> {
  let redactedLines = 0;
  const redacted = { ...state };
  for (const field of Object.keys(state) as (keyof DecisionState)[]) {
    const result = await redactSecretLines(state[field]);
    redacted[field] = result.text;
    redactedLines += result.redactedLines;
  }
  return { state: redacted, redactedLines };
}

/**
 * Ask `specs` about `state`. Never throws: a failure comes back as `error`
 * with no answers. Nothing is sent when the secret scanner can't load.
 */
export async function askDecisions(
  state: DecisionState,
  specs: readonly DecisionQuestionSpec[],
  options: AskOptions,
): Promise<AskResult> {
  const questions = uniqueSpecs(specs);
  const empty: AskResult = {
    answers: {},
    unanswered: questions.map((q) => q.name),
    model: DECISIONS_MODEL,
    durationMs: 0,
    inputTokens: 0,
    redactedLines: 0,
  };
  if (questions.length === 0) return empty;

  let redacted: { state: DecisionState; redactedLines: number };
  try {
    redacted = await redactState(state);
  } catch (error) {
    return {
      ...empty,
      error: `secret scanner unavailable, nothing sent: ${String(error)}`,
    };
  }

  const started = Date.now();
  const results = await Promise.all(
    chunk(questions, DECISIONS_MAX_QUESTIONS_PER_CALL).map((batch) =>
      classifyQuestions(redacted.state, batch, {
        transport: options.transport,
        timeoutMs: options.timeoutMs ?? DECISIONS_TIMEOUT_MS,
        maxRetries: 1,
        fetch: options.fetchImpl,
      }),
    ),
  );

  const answers: Record<string, DecisionAnswer> = {};
  const errors: string[] = [];
  let model = DECISIONS_MODEL;
  let inputTokens = 0;
  for (const result of results) {
    if (result.stopReason !== 'stop') {
      errors.push(result.errorMessage ?? result.stopReason);
      continue;
    }
    model = result.model;
    inputTokens += result.usage?.input ?? 0;
    for (const [name, answer] of Object.entries(result.answers)) {
      const mapped = toDecisionAnswer(answer);
      if (mapped) answers[name] = mapped;
    }
  }

  return {
    answers,
    unanswered: questions.map((q) => q.name).filter((n) => !(n in answers)),
    model,
    durationMs: Date.now() - started,
    inputTokens,
    redactedLines: redacted.redactedLines,
    ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
  };
}
