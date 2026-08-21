/**
 * Follow-up questions asked when a program aborts.
 *
 * A user the program turns away is the only person who can say what they
 * actually had, and the abort screen is the last moment they're still at the
 * terminal. `AbortCase.followUp` lets a program ask before exiting, through the
 * same overlay the agent's `wizard_ask` uses.
 *
 * Two rules hold no matter what the program configures:
 *
 * - Asking never changes the exit. No bridge, a thrown request, a cancelled
 *   prompt, a timeout — all fall through to the same abort.
 * - Free-text answers never reach analytics. Only `single`/`multi` picks ship
 *   their values; a `text` question ships a boolean saying it was answered.
 *   Prefer pickers for anything you intend to aggregate.
 */

import {
  CANCELLED_SENTINEL,
  isFullyCancelled,
  type WizardAskBridge,
} from '@lib/wizard-ask-bridge';
import { logToFile } from '@utils/debug';
import type { AbortCase } from './types';

/** Analytics properties keyed `follow_up_<question id>`. */
export type AbortFollowUpProperties = Record<string, string | string[] | true>;

export async function collectAbortFollowUp(
  matched: AbortCase | undefined,
  askBridge: WizardAskBridge | undefined,
): Promise<AbortFollowUpProperties> {
  const questions = matched?.followUp;
  if (!questions?.length || !askBridge) return {};

  let answers;
  try {
    answers = await askBridge.request({ questions });
  } catch (error) {
    logToFile('[abort-follow-up] ask failed, exiting without it:', error);
    return {};
  }
  if (isFullyCancelled(answers)) return {};

  const freeText = new Set(
    questions.filter((q) => q.kind === 'text').map((q) => q.id),
  );

  const properties: AbortFollowUpProperties = {};
  for (const [id, value] of Object.entries(answers)) {
    if (value === CANCELLED_SENTINEL) continue;
    // A free-text answer is whatever the user typed — a path, a repo name, an
    // internal service. Record that they answered, not what they wrote.
    properties[`follow_up_${id}`] = freeText.has(id) ? true : value;
  }
  return properties;
}
