/** The Decisions judgment service's contract: what a program declares, and what it reads back. */

import type { GatewayCredential } from '@shared/api';

/** The gateway with a gateway key, or OpenAI directly with an API key (dev script only). */
export type DecisionsTransport =
  | { gateway: GatewayCredential }
  | { apiKey: string; baseUrl?: string };

/** One question a program needs answered about the project before its agent runs. */
export type DecisionQuestionSpec = {
  /** snake_case, unique across every program. */
  name: string;
  kind: 'predicate' | 'choice';
  /** A fact about the code the model judges, never about the business. */
  instructions: string;
  /** Choice values with an optional description each. Required for `choice`. */
  choices?: Readonly<Record<string, string | null>>;
  /** Why the program asks, in one line. Shown in disclosure and dev output. */
  purpose: string;
  /** Report-only: asked only when the user shares scan results. */
  shared?: true;
  /** Predicate only: what agents read when the answer is likely yes, or likely no. */
  facts?: { likely?: string; unlikely?: string };
  /** Choice only: what agents read, with `{choice}` replaced by the answer. */
  fact?: string;
};

/** off: no call. shadow: answers are logged and compared, never acted on. primary: programs act on them; no switch sets it yet. */
export type DecisionsMode = 'off' | 'shadow' | 'primary';

export type DecisionAnswer =
  | { kind: 'predicate'; probability: number }
  | {
      kind: 'choice';
      choice: string;
      /** Probability of `choice`, read from the distribution. */
      probability: number;
      probabilities: Record<string, number>;
    };

/** What the service stores for the run, under `DECISIONS_KEY`. */
export type DecisionsResult = {
  mode: DecisionsMode;
  /** Answers by question name. A refused or lost question is absent. */
  answers: Record<string, DecisionAnswer>;
  /** Asked but not answered. */
  unanswered: string[];
  model: string;
  durationMs: number;
  inputTokens: number;
  /** Lines of the input dropped by secret and PII redaction. */
  redactedLines: number;
  /** Set when the call failed; `answers` is then empty. */
  error?: string;
};
