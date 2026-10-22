/**
 * The Decisions API through pi-ai's classifier: the gateway's `/v1/systemone`
 * (`typesafe-system-one`) or OpenAI directly (`openai-decisions`, dev script).
 */

import type {
  ClassifierAnswer,
  ClassifierModel,
  ClassifierQuestion,
  ClassifierResult,
} from '@earendil-works/pi-ai';
import { classify as classifyViaGateway } from '@earendil-works/pi-ai/api/typesafe-system-one';
import { classify as classifyViaOpenAi } from '@earendil-works/pi-ai/api/openai-decisions';
import type {
  DecisionAnswer,
  DecisionQuestionSpec,
  DecisionsTransport,
} from './types';

export const DECISIONS_MODEL = 'gpt-6-luna';

const MODEL_BASE = {
  name: DECISIONS_MODEL,
  type: 'classifier' as const,
  input: ['text' as const],
  contextWindow: 262_144,
  // USD per million tokens; decision models bill input only.
  cost: { input: 0.1, output: 0, cacheRead: 0, cacheWrite: 0 },
};

function modelFor(transport: DecisionsTransport): ClassifierModel<string> {
  const trim = (url: string) => url.replace(/\/+$/, '');
  if ('gateway' in transport) {
    return {
      ...MODEL_BASE,
      id: `openai/${DECISIONS_MODEL}`,
      api: 'typesafe-system-one',
      provider: 'posthog-ai-gateway',
      baseUrl: `${trim(transport.gateway.url)}/v1`,
    };
  }
  return {
    ...MODEL_BASE,
    id: DECISIONS_MODEL,
    api: 'openai-decisions',
    provider: 'openai',
    baseUrl: trim(transport.baseUrl ?? 'https://api.openai.com/v1'),
  };
}

/** A catalog question in pi-ai's shape. Yes/no questions get plain yes/no criteria. */
export function toClassifierQuestion(
  spec: DecisionQuestionSpec,
): ClassifierQuestion {
  if (spec.kind === 'predicate') {
    return {
      type: 'bool',
      instructions: spec.instructions,
      criteria: { true: 'Yes', false: 'No' },
    };
  }
  return {
    type: 'choice',
    instructions: spec.instructions,
    criteria: Object.fromEntries(
      Object.entries(spec.choices ?? {}).map(([value, description]) => [
        value,
        description ?? value,
      ]),
    ),
  };
}

/** pi-ai's answer in the service's shape; null for a kind the catalog doesn't ask. */
export function toDecisionAnswer(
  answer: ClassifierAnswer,
): DecisionAnswer | null {
  if (answer.type === 'bool') {
    return { kind: 'predicate', probability: answer.probability };
  }
  if (answer.type === 'choice') {
    return {
      kind: 'choice',
      choice: answer.choice,
      probability: answer.probabilities[answer.choice] ?? answer.confidence,
      probabilities: answer.probabilities,
    };
  }
  return null;
}

export type ClassifyOptions = {
  transport: DecisionsTransport;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  onPayload?: (payload: unknown) => unknown;
};

/** One classifier call. Never throws: a failure comes back as `stopReason: 'error'`. */
export function classifyQuestions(
  state: Readonly<Record<string, string>>,
  specs: readonly DecisionQuestionSpec[],
  options: ClassifyOptions,
): Promise<ClassifierResult> {
  const model = modelFor(options.transport);
  const apiKey =
    'gateway' in options.transport
      ? options.transport.gateway.token.trim()
      : options.transport.apiKey;
  const classify =
    model.api === 'typesafe-system-one'
      ? classifyViaGateway
      : classifyViaOpenAi;
  return classify(
    model,
    {
      state: { ...state },
      questions: Object.fromEntries(
        specs.map((spec) => [spec.name, toClassifierQuestion(spec)]),
      ),
    },
    {
      apiKey,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      fetch: options.fetch,
      onPayload: options.onPayload,
    },
  );
}

/** The request bodies `specs` would send, one per call, built by pi-ai without sending anything. */
export async function previewRequests(
  state: Readonly<Record<string, string>>,
  batches: readonly (readonly DecisionQuestionSpec[])[],
  transport: DecisionsTransport,
): Promise<unknown[]> {
  const bodies: unknown[] = [];
  for (const specs of batches) {
    await classifyQuestions(state, specs, {
      transport,
      maxRetries: 0,
      onPayload: (payload) => {
        bodies.push(payload);
        // Stops the request before it's sent.
        throw new Error('preview');
      },
    });
  }
  return bodies;
}
