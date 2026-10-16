/** The builders every Decisions question is declared with. */

import type { DecisionQuestionSpec } from './types';

/** A question before it has a name; `defineQuestions` names it by its key. */
export type QuestionDraft = Omit<DecisionQuestionSpec, 'name'>;

/** A yes/no question; the answer is the probability of yes. */
export function predicate(question: {
  ask: string;
  purpose: string;
  facts?: { likely?: string; unlikely?: string };
  shared?: true;
}): QuestionDraft {
  return {
    kind: 'predicate',
    instructions: question.ask,
    purpose: question.purpose,
    ...(question.facts ? { facts: question.facts } : {}),
    ...(question.shared ? { shared: true } : {}),
  };
}

/** A pick-one question over `choices` (value → optional description). Needs two or more choices. */
export function choice(question: {
  ask: string;
  choices: Readonly<Record<string, string | null>>;
  purpose: string;
  fact?: string;
  shared?: true;
}): QuestionDraft {
  return {
    kind: 'choice',
    instructions: question.ask,
    choices: question.choices,
    purpose: question.purpose,
    ...(question.fact ? { fact: question.fact } : {}),
    ...(question.shared ? { shared: true } : {}),
  };
}

/** Name each question by its key, so the key is the name the API and the answers use. */
export function defineQuestions<K extends string>(
  drafts: Record<K, QuestionDraft>,
): Record<K, DecisionQuestionSpec> {
  return Object.fromEntries(
    Object.entries<QuestionDraft>(drafts).map(([name, draft]) => [
      name,
      { ...draft, name },
    ]),
  ) as Record<K, DecisionQuestionSpec>;
}
