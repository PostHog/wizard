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
} from '@lib/wizard-ask-bridge';
import type { PendingQuestion } from '@lib/wizard-session';
import type { AgentInteraction } from '@lib/agent/progress';

export interface AskBridgeHandle {
  bridge: WizardAskBridge;
  /**
   * The question currently on screen, or null. The anthropic harness reads it
   * to block Write/Edit while an overlay is open, the same guard pi keeps in
   * its security extension.
   */
  getPendingQuestion: () => PendingQuestion | null;
}

export function createAskBridge(
  interaction: AgentInteraction | undefined,
  signal: AbortSignal,
  options: {
    getSource: () => string;
    richLinks: boolean;
    timeoutMs?: number;
    /** Runs before each question is shown (the orchestrator's bell and metric). */
    beforeShow?: () => void;
  },
): AskBridgeHandle | undefined {
  const ask = interaction?.ask;
  if (!ask) return undefined;

  let pending: PendingQuestion | null = null;
  const bridge = createWizardAskBridge({
    getSource: options.getSource,
    showQuestion: async (question) => {
      options.beforeShow?.();
      pending = question;
      try {
        return await ask(question, { signal });
      } finally {
        pending = null;
      }
    },
    cancelQuestion: interaction?.cancelAsk,
    richLinks: options.richLinks,
    timeoutMs: options.timeoutMs,
  });

  return { bridge, getPendingQuestion: () => pending };
}
