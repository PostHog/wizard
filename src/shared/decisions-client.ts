/**
 * Minimal client for OpenAI's Decisions API (`POST /v1/decisions`), direct or
 * through PostHog's AI gateway (`POST /v1/systemone`). Types mirror `openai`'s
 * `resources/decisions.ts`; only text input is used here.
 */

import type { GatewayCredential } from '@shared/api';

export const DECISIONS_MODEL = 'gpt-6-luna';
export const DECISIONS_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export type PredicateQuestion = {
  type: 'predicate';
  name: string;
  instructions: string;
};

export type ChoiceQuestion = {
  type: 'choice';
  name: string;
  instructions: string;
  choices: Array<{ value: string; description?: string }>;
};

export type DecisionQuestion = PredicateQuestion | ChoiceQuestion;

export type DecisionInputMessage = {
  role: 'user';
  content: Array<{ type: 'input_text'; text: string }>;
};

export type DecisionCreateParams = {
  model: string;
  input: string | DecisionInputMessage[];
  questions: DecisionQuestion[];
};

export type PredicateAnswer = {
  type: 'predicate';
  name: string | null;
  probability: number;
};

export type ChoiceAnswer = {
  type: 'choice';
  name: string | null;
  choice: string | boolean;
  confidence: number;
  probabilities: Array<{ value: string | boolean; probability: number }>;
};

export type RefusalAnswer = { type: 'refusal'; name: string | null };

export type DecisionAnswer = PredicateAnswer | ChoiceAnswer | RefusalAnswer;

export type Decision = {
  answers: DecisionAnswer[];
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    input_tokens_details?: { cached_tokens: number };
  };
};

/** OpenAI directly with an API key, or the gateway with the run's gateway token. */
export type DecisionsTransport =
  | { apiKey: string; baseUrl?: string }
  | { gateway: GatewayCredential };

export type DecisionsClientOptions = DecisionsTransport & {
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
};

/** Status codes worth one more try; every other failure is final. */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

class DecisionsHttpError extends Error {
  constructor(readonly status: number, body: string) {
    super(`Decisions API HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

/** Create one decision; retries transient failures, throws on everything else. */
export async function createDecision(
  params: DecisionCreateParams,
  options: DecisionsClientOptions,
): Promise<Decision> {
  const { timeoutMs = 8_000, maxRetries = 1, fetchImpl = fetch } = options;
  const viaGateway = 'gateway' in options;
  const url = viaGateway
    ? `${options.gateway.url.replace(/\/+$/, '')}/v1/systemone`
    : `${(options.baseUrl ?? DECISIONS_DEFAULT_BASE_URL).replace(
        /\/+$/,
        '',
      )}/decisions`;
  const token = viaGateway ? options.gateway.token.trim() : options.apiKey;
  const body = viaGateway ? toSystemOneRequest(params) : params;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        const json: unknown = await response.json();
        return viaGateway
          ? fromSystemOneDecision(params.questions, json as SystemOneDecision)
          : (json as Decision);
      }
      const error = new DecisionsHttpError(
        response.status,
        await response.text(),
      );
      if (!isRetryableStatus(response.status)) throw error;
      lastError = error;
    } catch (error) {
      if (
        error instanceof DecisionsHttpError &&
        !isRetryableStatus(error.status)
      ) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
}

/** The gateway's provider-prefixed id for an OpenAI decision model. */
export function gatewayModelId(model: string): string {
  return model.includes('/') ? model : `openai/${model}`;
}

type SystemOneQuestion =
  | { type: 'noul'; instructions: string }
  | {
      type: 'choice';
      instructions: string;
      criteria: Record<string, string | null>;
    };

type SystemOneAnswer =
  | { type: 'noul'; noul: number }
  | {
      type: 'choice';
      choice: string;
      confidence: number;
      probabilities: Record<string, number>;
    }
  | { type: 'refusal' };

type SystemOneDecision = {
  model: string;
  answers: Record<string, SystemOneAnswer>;
  usage: { input_tokens?: number; output_tokens?: number };
};

/** The gateway's decision shape: one string state, questions keyed by name in order. */
export function toSystemOneRequest(params: DecisionCreateParams): {
  model: string;
  state: string;
  questions: Record<string, SystemOneQuestion>;
} {
  const state =
    typeof params.input === 'string'
      ? params.input
      : params.input
          .flatMap((message) => message.content.map((part) => part.text))
          .join('\n\n');
  const questions: Record<string, SystemOneQuestion> = {};
  for (const question of params.questions) {
    questions[question.name] =
      question.type === 'predicate'
        ? { type: 'noul', instructions: question.instructions }
        : {
            type: 'choice',
            instructions: question.instructions,
            criteria: Object.fromEntries(
              question.choices.map((c) => [c.value, c.description ?? null]),
            ),
          };
  }
  return { model: gatewayModelId(params.model), state, questions };
}

/** Back to the OpenAI shape, one answer per question in order; a missing answer reads as a refusal. */
export function fromSystemOneDecision(
  questions: readonly DecisionQuestion[],
  decision: SystemOneDecision,
): Decision {
  const answers = questions.map((question): DecisionAnswer => {
    const answer = decision.answers?.[question.name];
    if (answer?.type === 'noul') {
      return {
        type: 'predicate',
        name: question.name,
        probability: answer.noul,
      };
    }
    if (answer?.type === 'choice') {
      return {
        type: 'choice',
        name: question.name,
        choice: answer.choice,
        confidence: answer.confidence,
        probabilities: Object.entries(answer.probabilities ?? {}).map(
          ([value, probability]) => ({ value, probability }),
        ),
      };
    }
    return { type: 'refusal', name: question.name };
  });
  const inputTokens = decision.usage?.input_tokens ?? 0;
  const outputTokens = decision.usage?.output_tokens ?? 0;
  return {
    answers,
    model: decision.model,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}
