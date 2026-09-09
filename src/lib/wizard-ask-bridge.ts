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
  /**
   * Normalised `subject` of the originating `wizard_ask` call — the thing the
   * questions collect for (a data-warehouse source kind like "postgres", an
   * integration step). Stamped onto the `answered`/`cancelled` events so an
   * outcome can be attributed to what was being asked, not just the run: the
   * warehouse task asks one call per detected source, and without this a
   * cancellation cannot be told apart by source. The caller normalises it
   * (same `normaliseAskSubject` the cap accounting uses) so the value joins to
   * the `wizard_ask capped` event's `subject`. Absent when the call declared none.
   */
  subject?: string;
}

export interface WizardAskBridge {
  /**
   * Open the WizardAsk overlay and resolve with the user's answers.
   * One answer per question id (string for `single`/`text`, string[] for
   * `multi`). A field the user dismissed comes back as the literal
   * `"__cancelled__"`; a field the timeout closed comes back as
   * `"__timed_out__"`.
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
   * {@link TIMED_OUT_SENTINEL} value. Defaults to {@link DEFAULT_ASK_TIMEOUT_MS}.
   */
  timeoutMs?: number;
  /**
   * Opt the rendered overlay into rich link handling (OSC 8 hyperlinks +
   * clipboard copy for prompt URLs). Set per program; defaults to false.
   * Propagated onto every {@link PendingQuestion} this bridge creates.
   */
  richLinks?: boolean;
  /**
   * Dismiss the host's in-flight question overlay. Called when the timeout
   * wins the race: without it the host keeps its pending-question state, and
   * every later `wizard_ask` in the run fails with "another request is
   * pending" — one unanswered prompt would block credential collection for
   * all remaining sources.
   */
  cancelQuestion?: () => void;
}

/** Sentinel returned for unanswered fields when the user dismisses the overlay. */
export const CANCELLED_SENTINEL = '__cancelled__';

/**
 * Sentinel returned for unanswered fields when the timeout wins the race.
 *
 * A timeout is not a decline. The programs that raise `askTimeoutMs` park on a
 * question while the user does slow work away from the terminal — run a
 * production build, trigger a test error, check Error Tracking. Before this
 * sentinel existed both endings resolved to {@link CANCELLED_SENTINEL}, the
 * agent read "the user declined", and it unwound work the user was still in the
 * middle of verifying. The two endings need different answers so the agent can
 * tell them apart.
 */
export const TIMED_OUT_SENTINEL = '__timed_out__';

/** Default per-question timeout (5 minutes). */
export const DEFAULT_ASK_TIMEOUT_MS = 5 * 60 * 1000;

function buildUnansweredAnswers(
  questions: AskQuestion[],
  sentinel: string,
): AskAnswers {
  const out: AskAnswers = {};
  for (const q of questions) {
    out[q.id] = sentinel;
  }
  return out;
}

/** True for either unanswered sentinel — a dismissal or a timeout. */
export function isUnansweredSentinel(value: unknown): boolean {
  return value === CANCELLED_SENTINEL || value === TIMED_OUT_SENTINEL;
}

/**
 * True when no field carries a real answer. Gates the per-run cap refund, so
 * it must cover both endings: neither a dismissal nor a timeout may burn a slot.
 */
export function isFullyCancelled(answers: AskAnswers): boolean {
  const values = Object.values(answers);
  if (values.length === 0) return false;
  return values.every(isUnansweredSentinel);
}

/** True when every field came back as the timeout sentinel. */
export function isFullyTimedOut(answers: AskAnswers): boolean {
  const values = Object.values(answers);
  if (values.length === 0) return false;
  return values.every((v) => v === TIMED_OUT_SENTINEL);
}

export function createWizardAskBridge(
  opts: WizardAskBridgeOptions,
): WizardAskBridge {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;

  return {
    async request({ questions, subject }) {
      const pending: PendingQuestion = {
        id: randomUUID(),
        questions,
        source: opts.getSource(),
        richLinks: opts.richLinks ?? false,
        askedAt: new Date().toISOString(),
      };

      const startedAt = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;

      // Race the user against the timeout. Whichever fires first wins. On
      // timeout we also cancel the host's overlay: resolving our side alone
      // would leave the host's pending-question state set, and the next
      // wizard_ask would be rejected as a duplicate request.
      const timeoutPromise = new Promise<AskAnswers>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          opts.cancelQuestion?.();
          resolve(buildUnansweredAnswers(questions, TIMED_OUT_SENTINEL));
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
            subject,
            question_count: questions.length,
            duration_ms: durationMs,
            timed_out: timedOut,
          });
        } else {
          analytics.wizardCapture('wizard_ask answered', {
            source: pending.source,
            subject,
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
