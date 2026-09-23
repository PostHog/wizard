/**
 * The ask bridge over an injected answerer.
 *
 * `createWizardAskBridge` already owns request ids, the timeout race, the
 * `__cancelled__` sentinel and the analytics; it only ever needed a
 * `showQuestion` and a `cancelQuestion`. Here those come from
 * `AgentInteraction` instead of `getUI()`. With no answerer there is no bridge,
 * so `wizard_ask` reports its existing "not available" error rather than
 * hanging on a question nobody can see.
 */

import {
  createWizardAskBridge,
  type WizardAskBridge,
} from '../../progress/wizard-ask-bridge';
import type { AgentInteraction } from '../../progress/progress';

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
    showQuestion: (question) => {
      options.beforeShow?.();
      return ask(question);
    },
    cancelQuestion: interaction?.cancelAsk,
    richLinks: options.richLinks,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
}
