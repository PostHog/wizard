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
import type { AskAnswers, AskQuestion, PendingQuestion } from '@agent/progress';

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

/**
 * One ask's outcome.
 *
 * `answers` holds one answer per question id (string for `single`/`text`,
 * string[] for `multi`); cancelled fields come back as the literal
 * `"__cancelled__"`. `timedOut` records that the per-question timeout, rather
 * than the user, ended the request — the one fact only the bridge holds, and
 * the difference between "the user said no to this" and "nobody is at the
 * terminal any more". Both arrive as {@link CANCELLED_SENTINEL} answers, so
 * without it the two are indistinguishable to the tool facades and to the agent.
 */
export interface AskResponse {
  answers: AskAnswers;
  timedOut: boolean;
}

export interface WizardAskBridge {
  /** Open the WizardAsk overlay and resolve with the user's answers. */
  request(req: WizardAskRequest): Promise<AskResponse>;
  /** An unresolved question keeps file mutations paused across concurrent requests. */
  getPendingQuestion: () => PendingQuestion | null;
}

export interface WizardAskBridgeOptions {
  /** Run cancellation: settles open questions as cancelled and aborts their signals. */
  signal?: AbortSignal;
  /** Returns the active skill id, used as the analytics `source` on the request. */
  getSource: () => string;
  /**
   * Opens the overlay and resolves once the user submits or cancels. `signal`
   * is this question's own: it aborts when the timeout wins the race or the
   * run is cancelled, and the host dismisses this question's overlay. Without
   * that the host keeps its pending-question state, and every later
   * `wizard_ask` in the run fails with "another request is pending" — one
   * unanswered prompt would block credential collection for all remaining
   * sources. The host's abort handling must not throw: the bridge cannot catch
   * an abort listener's error, and Node rethrows it as an uncaught exception.
   */
  showQuestion: (
    question: PendingQuestion,
    context: { signal: AbortSignal },
  ) => Promise<AskAnswers>;
  /**
   * Per-question timeout in milliseconds. When the user takes longer than
   * this to answer, every unanswered field resolves with the
   * {@link CANCELLED_SENTINEL} value. Defaults to {@link DEFAULT_ASK_TIMEOUT_MS}.
   */
  timeoutMs?: number;
  /**
   * Opt the rendered overlay into rich link handling (OSC 8 hyperlinks +
   * clipboard copy for prompt URLs). Set per program; defaults to false.
   * Propagated onto every {@link PendingQuestion} this bridge creates.
   */
  richLinks?: boolean;
}

/** Sentinel returned for unanswered fields on cancellation or timeout. */
export const CANCELLED_SENTINEL = '__cancelled__';

/** Default per-question timeout (5 minutes). */
export const DEFAULT_ASK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * The longer per-question timeout, for asks that send the user on an errand —
 * open a database console, mint a restricted API key. The default above is
 * sized for a question answerable from memory and expires long before an
 * errand is done.
 */
export const LONGER_ASK_TIMEOUT_MS = 20 * 60 * 1000;

function buildCancelledAnswers(questions: AskQuestion[]): AskAnswers {
  const out: AskAnswers = {};
  for (const q of questions) {
    out[q.id] = CANCELLED_SENTINEL;
  }
  return out;
}

export function isFullyCancelled(answers: AskAnswers): boolean {
  const values = Object.values(answers);
  if (values.length === 0) return false;
  return values.every((v) => v === CANCELLED_SENTINEL);
}

export function createWizardAskBridge(
  opts: WizardAskBridgeOptions,
): WizardAskBridge {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;
  const pendingQuestions = new Map<string, PendingQuestion>();

  return {
    getPendingQuestion: () => {
      for (const pending of pendingQuestions.values()) return pending;
      return null;
    },
    async request({ questions, subject }) {
      if (opts.signal?.aborted) {
        return { answers: buildCancelledAnswers(questions), timedOut: false };
      }
      const pending: PendingQuestion = {
        id: randomUUID(),
        questions,
        source: opts.getSource(),
        richLinks: opts.richLinks ?? false,
        askedAt: new Date().toISOString(),
      };
      pendingQuestions.set(pending.id, pending);

      const startedAt = Date.now();
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      let cancelForAbort: (() => void) | undefined;

      // Race the user against the timeout and the run. Whichever fires first
      // wins. When the timeout or the run wins we also abort this question's
      // signal so the host dismisses its overlay: resolving our side alone
      // would leave the host's pending-question state set, and the next
      // wizard_ask would be rejected as a duplicate request.
      const timeoutPromise = new Promise<AskAnswers>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          // Settle first: a host that rejects once dismissed must not win.
          resolve(buildCancelledAnswers(questions));
          controller.abort();
        }, timeoutMs);
      });
      const aborted = new Promise<AskAnswers>((resolve) => {
        cancelForAbort = () => {
          resolve(buildCancelledAnswers(questions));
          controller.abort();
        };
        opts.signal?.addEventListener('abort', cancelForAbort, { once: true });
      });

      try {
        const answers = await Promise.race([
          opts.showQuestion(pending, { signal: controller.signal }),
          timeoutPromise,
          aborted,
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

        return { answers, timedOut };
      } finally {
        if (timer) clearTimeout(timer);
        if (cancelForAbort)
          opts.signal?.removeEventListener('abort', cancelForAbort);
        pendingQuestions.delete(pending.id);
      }
    },
  };
}
