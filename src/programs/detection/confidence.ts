/**
 * The one set of thresholds for acting on a Decisions answer. Prompt facts,
 * traits, flow conditions and skill criteria all read these, so they agree on
 * what counts as a confident yes, a confident no, and an answer to ignore.
 */

/** A predicate at or above this is a yes; a choice at or above it is its value. */
export const LIKELY_PROBABILITY = 0.6;
/** A predicate at or below this is a no. */
export const UNLIKELY_PROBABILITY = 0.1;
/** Choice values that never become a fact or a trait. */
export const UNSPECIFIC_CHOICES: ReadonlySet<string> = new Set([
  'other',
  'none',
]);

/** A judged value replaces static detection's at or above this probability. Calibrate from shadow runs. */
export const DECISIONS_ACCEPT_PROBABILITY = 0.85;
/** Between the gates, the judged value needs static agreement or a static miss. */
export const DECISIONS_AGREE_PROBABILITY = 0.6;
/** A project target or main-app answer below this isn't acted on. */
export const PROJECT_CONFIDENCE = 0.6;

/** Whether a judged value may decide over static detection's, by the two gates. */
export function judgedValueWins<T>(
  judged: T,
  probability: number,
  staticValue: T | undefined,
): boolean {
  if (probability >= DECISIONS_ACCEPT_PROBABILITY) return true;
  return (
    probability >= DECISIONS_AGREE_PROBABILITY &&
    (staticValue === undefined || staticValue === judged)
  );
}
