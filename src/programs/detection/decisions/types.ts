/** The Decisions judgment service's contract: what a program declares, and what it reads back. */

import type { ProgramSession } from '../../program-session';

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
};

/** `ProgramConfig.decisions`: the questions a program opts into. */
export type ProgramDecisions = {
  questions: readonly DecisionQuestionSpec[];
  /**
   * What the program decided without the answers, logged beside them so shadow
   * runs show agreement. Return flat values, e.g. `{ framework_static: 'nextjs' }`.
   */
  compare?: (
    session: ProgramSession,
    answers: Readonly<Record<string, DecisionAnswer>>,
  ) => Record<string, string | number | boolean | null>;
};

/** off: no call. shadow: answers are logged and compared, never acted on. primary: programs act on them. */
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
