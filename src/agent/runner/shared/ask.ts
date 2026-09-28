/**
 * The ask bridge over an injected answerer.
 *
 * `createWizardAskBridge` already owns request ids, the timeout race, the
 * `__cancelled__` sentinel and the analytics; it only ever needed a
 * `showQuestion` that honours each question's own signal. Here that comes from
 * `AgentInteraction` instead of `getUI()`. With no answerer there is no bridge,
 * so `wizard_ask` reports its existing "not available" error rather than
 * hanging on a question nobody can see.
 */

import {
  createWizardAskBridge,
  type WizardAskBridge,
} from '@agent/wizard-ask-bridge';
import type { AgentInteraction } from '@agent/progress';

export function createAskBridge(
  interaction: AgentInteraction | undefined,
  options: {
    getSource: () => string;
    richLinks: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
    /** Runs before each question is shown (the orchestrator's bell and metric). */
    beforeShow?: () => void;
  },
): WizardAskBridge | undefined {
  const ask = interaction?.ask;
  if (!ask) return undefined;

  return createWizardAskBridge({
    getSource: options.getSource,
    showQuestion: (question, context) => {
      options.beforeShow?.();
      return ask(question, context);
    },
    richLinks: options.richLinks,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
}
