/** One Decisions request for a set of declared questions, with the input redacted first. */

import { redactSecretLines } from '@agent';
import {
  createDecision,
  DECISIONS_MODEL,
  type Decision,
  type DecisionAnswer as ApiAnswer,
  type DecisionQuestion,
  type DecisionsTransport,
} from '@shared/decisions-client';
import type {
  DecisionAnswer,
  DecisionQuestionSpec,
  DecisionsResult,
} from './types';

/** The gateway's `/v1/systemone` refuses more questions than this in one request. */
export const DECISIONS_MAX_QUESTIONS_PER_CALL = 32;
/** Per-attempt timeout; the client retries a transient failure once. */
const DECISIONS_TIMEOUT_MS = 8_000;

export type AskOptions = {
  transport: DecisionsTransport;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type AskResult = Omit<DecisionsResult, 'mode'>;

export function toApiQuestion(spec: DecisionQuestionSpec): DecisionQuestion {
  if (spec.kind === 'predicate') {
    return {
      type: 'predicate',
      name: spec.name,
      instructions: spec.instructions,
    };
  }
  return {
    type: 'choice',
    name: spec.name,
    instructions: spec.instructions,
    choices: Object.entries(spec.choices ?? {}).map(([value, description]) =>
      description ? { value, description } : { value },
    ),
  };
}

/** Pair a batch's answers with its questions by position; throws if the API names a different question. */
export function answersByName(
  questions: readonly DecisionQuestion[],
  decision: Decision,
): Map<string, ApiAnswer> {
  if (decision.answers.length !== questions.length) {
    throw new Error(
      `Decisions API returned ${decision.answers.length} answers for ${questions.length} questions`,
    );
  }
  const answers = new Map<string, ApiAnswer>();
  for (const [i, question] of questions.entries()) {
    const answer = decision.answers[i];
    if (answer.name !== null && answer.name !== question.name) {
      throw new Error(
        `Decisions API answer ${i} is "${answer.name}", expected "${question.name}"`,
      );
    }
    answers.set(question.name, answer);
  }
  return answers;
}

/** The API's answer in the service's shape; null for a refusal. */
export function toAnswer(answer: ApiAnswer): DecisionAnswer | null {
  if (answer.type === 'predicate') {
    return { kind: 'predicate', probability: answer.probability };
  }
  if (answer.type === 'choice') {
    const probabilities = Object.fromEntries(
      answer.probabilities.map((p) => [String(p.value), p.probability]),
    );
    const choice = String(answer.choice);
    return {
      kind: 'choice',
      choice,
      probability: probabilities[choice] ?? answer.confidence,
      probabilities,
    };
  }
  return null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

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

/**
 * Ask `specs` about `input`. Never throws: a failure comes back as `error`
 * with no answers. Nothing is sent when the secret scanner can't load.
 */
export async function askDecisions(
  input: string,
  specs: readonly DecisionQuestionSpec[],
  options: AskOptions,
): Promise<AskResult> {
  const questions = uniqueSpecs(specs).map(toApiQuestion);
  const empty: AskResult = {
    answers: {},
    unanswered: questions.map((q) => q.name),
    model: DECISIONS_MODEL,
    durationMs: 0,
    inputTokens: 0,
    redactedLines: 0,
  };
  if (questions.length === 0) return empty;

  let redacted: { text: string; redactedLines: number };
  try {
    redacted = await redactSecretLines(input);
  } catch (error) {
    return {
      ...empty,
      error: `secret scanner unavailable, nothing sent: ${String(error)}`,
    };
  }

  const started = Date.now();
  const results = await Promise.allSettled(
    chunk(questions, DECISIONS_MAX_QUESTIONS_PER_CALL).map(async (batch) => {
      const decision = await createDecision(
        { model: DECISIONS_MODEL, input: redacted.text, questions: batch },
        {
          ...options.transport,
          timeoutMs: options.timeoutMs ?? DECISIONS_TIMEOUT_MS,
          maxRetries: 1,
          fetchImpl: options.fetchImpl,
        },
      );
      return { decision, answers: answersByName(batch, decision) };
    }),
  );

  const answers: Record<string, DecisionAnswer> = {};
  const errors: string[] = [];
  let model = DECISIONS_MODEL;
  let inputTokens = 0;
  for (const result of results) {
    if (result.status === 'rejected') {
      errors.push(String(result.reason));
      continue;
    }
    model = result.value.decision.model;
    inputTokens += result.value.decision.usage.input_tokens;
    for (const [name, answer] of result.value.answers) {
      const mapped = toAnswer(answer);
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
