/**
 * WizardAskBridge — host-side promise broker for the `wizard_ask` MCP tool.
 *
 * The `wizard_ask` tool needs to (a) read information from the wizard
 * session (the active skill id, used as the analytics `source`) and
 * (b) drive the TUI overlay. Wiring `wizard-tools.ts` directly to either
 * would couple our pure-data MCP server to the runtime UI layer.
 *
 * The bridge is the seam: `wizard-tools.ts` depends on this interface,
 * and `agent-runner.ts` constructs an implementation that knows about
 * both the session and `getUI()`.
 */
import { randomUUID } from 'crypto';

import type {
  AskAnswers,
  AskQuestion,
  PendingQuestion,
} from './wizard-session';

export interface WizardAskRequest {
  questions: AskQuestion[];
}

export interface WizardAskBridge {
  /**
   * Open the WizardAsk overlay and resolve with the user's answers.
   * One answer per question id (string for `single`/`text`, string[] for
   * `multi`). Cancelled fields come back as the literal `"__cancelled__"`.
   */
  request(req: WizardAskRequest): Promise<AskAnswers>;
}

export interface WizardAskBridgeOptions {
  /** Returns the active skill id, used as the analytics `source` on the request. */
  getSource: () => string;
  /** Opens the overlay and resolves once the user submits or cancels. */
  showQuestion: (question: PendingQuestion) => Promise<AskAnswers>;
}

export function createWizardAskBridge(
  opts: WizardAskBridgeOptions,
): WizardAskBridge {
  return {
    async request({ questions }) {
      const pending: PendingQuestion = {
        id: randomUUID(),
        questions,
        source: opts.getSource(),
      };
      return opts.showQuestion(pending);
    },
  };
}
