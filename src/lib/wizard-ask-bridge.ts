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

import { analytics } from '@utils/analytics';
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
  /**
   * Per-question timeout in milliseconds. When the user takes longer than
   * this to answer, every unanswered field resolves with the
   * {@link CANCELLED_SENTINEL} value. Defaults to {@link DEFAULT_ASK_TIMEOUT_MS}.
   */
  timeoutMs?: number;
}

/** Sentinel returned for unanswered fields on cancellation or timeout. */
export const CANCELLED_SENTINEL = '__cancelled__';

/** Default per-question timeout (5 minutes). */
export const DEFAULT_ASK_TIMEOUT_MS = 5 * 60 * 1000;

function buildCancelledAnswers(questions: AskQuestion[]): AskAnswers {
  const out: AskAnswers = {};
  for (const q of questions) {
    out[q.id] = CANCELLED_SENTINEL;
  }
  return out;
}

function isFullyCancelled(answers: AskAnswers): boolean {
  const values = Object.values(answers);
  if (values.length === 0) return false;
  return values.every((v) => v === CANCELLED_SENTINEL);
}

export function createWizardAskBridge(
  opts: WizardAskBridgeOptions,
): WizardAskBridge {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;

  return {
    async request({ questions }) {
      const pending: PendingQuestion = {
        id: randomUUID(),
        questions,
        source: opts.getSource(),
      };

      const startedAt = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;

      // Race the user against the timeout. Whichever fires first wins; the
      // other branch is harmless because the overlay still resolves via the
      // store when the user eventually submits (and the answers are simply
      // discarded).
      const timeoutPromise = new Promise<AskAnswers>((resolve) => {
        timer = setTimeout(() => {
          resolve(buildCancelledAnswers(questions));
        }, timeoutMs);
      });

      try {
        const answers = await Promise.race([
          opts.showQuestion(pending),
          timeoutPromise,
        ]);
        const durationMs = Date.now() - startedAt;

        if (isFullyCancelled(answers)) {
          analytics.wizardCapture('wizard_ask cancelled', {
            source: pending.source,
            question_count: questions.length,
            duration_ms: durationMs,
            timed_out: durationMs >= timeoutMs,
          });
        } else {
          analytics.wizardCapture('wizard_ask answered', {
            source: pending.source,
            question_count: questions.length,
            duration_ms: durationMs,
          });
        }

        return answers;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
