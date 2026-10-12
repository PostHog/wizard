/**
 * Minimal client for OpenAI's Decisions API (`POST /v1/decisions`). Types
 * mirror `openai`'s `resources/decisions.ts`; only text input is used here.
 */

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

export type DecisionsClientOptions = {
  apiKey: string;
  baseUrl?: string;
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
  const {
    apiKey,
    baseUrl = DECISIONS_DEFAULT_BASE_URL,
    timeoutMs = 8_000,
    maxRetries = 1,
    fetchImpl = fetch,
  } = options;
  const url = `${baseUrl.replace(/\/+$/, '')}/decisions`;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return (await response.json()) as Decision;
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
