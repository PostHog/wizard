/**
 * Production telemetry for Pi model stream stalls and mid-stream drops.
 *
 * Emits `wizard: agent stream stalled` in two situations:
 * 1. `stage: 'silent'` when a turn waits on the model for `silenceThresholdMs`
 *    (default 120s) without a chunk — catches hangs even when the user hits
 *    Ctrl+C before the gateway's 600s request deadline.
 * 2. `stage: 'failed'` when a turn ends on a mid-stream deadline/drop error
 *    (or any error after crossing the silence threshold).
 *
 * If a turn that triggered `silent` later finishes or is cancelled, a follow-up
 * `stage: 'recovered'` or `stage: 'aborted'` event closes the loop so dashboards
 * can separate real hangs from slow reasoning turns.
 */

import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { redactSecrets } from '@shared/mcp-clients/results';
import type { Sequence } from '@shared/constants';
import type { GatewayApi } from './gateway';

export const STREAM_STALL_EVENT = 'agent stream stalled';
export const DEFAULT_STREAM_SILENCE_MS = 120_000;

export type StreamStallStage = 'silent' | 'failed' | 'recovered' | 'aborted';

export type StreamStallErrorKind =
  | 'deadline_exceeded'
  | 'upstream_closed'
  | 'connection_reset'
  | 'other';

type TurnState = 'idle' | 'waiting' | 'paused' | 'failed';

export interface StreamStallWatcherOptions {
  sequence: Sequence;
  model: string;
  effort?: string;
  api: GatewayApi;
  tag: string;
  analyticsProperties?: Record<string, unknown>;
  silenceThresholdMs?: number;
  now?: () => number;
}

export interface StreamStallEvent {
  type: string;
  message?: unknown;
  success?: boolean;
  aborted?: boolean;
}

interface AssistantMessageShape {
  role?: string;
  stopReason?: string;
  errorMessage?: string;
}

let activePiSessions = 0;

/** Current count of live Pi sessions in this process (for concurrency telemetry and tests). */
export function getActivePiSessions(): number {
  return activePiSessions;
}

/** Classify known mid-stream deadline / dropped-stream error strings into a closed dashboard enum. */
export function classifyStreamStallError(
  message: string | undefined,
): Exclude<StreamStallErrorKind, 'other'> | undefined {
  if (!message) return undefined;
  if (
    /deadline exceeded|(?:request|stream|headers?|body)\s+timed?\s*out|etimedout|und_err_body_timeout/i.test(
      message,
    )
  ) {
    return 'deadline_exceeded';
  }
  if (
    /upstream closed|stream closed|ended unexpectedly|stream terminated|^terminated$/i.test(
      message,
    )
  ) {
    return 'upstream_closed';
  }
  if (
    /upstream connection lost|econnreset|socket hang up|econnrefused|epipe/i.test(
      message,
    )
  ) {
    return 'connection_reset';
  }
  return undefined;
}

export function createStreamStallWatcher(opts: StreamStallWatcherOptions) {
  const thresholdMs = opts.silenceThresholdMs ?? DEFAULT_STREAM_SILENCE_MS;
  const now = opts.now ?? Date.now;

  activePiSessions += 1;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  let turnNumber = 0;
  let turnState: TurnState = 'idle';
  let turnStartedAt = 0;
  let lastActivityAt = 0;
  let turnStartActiveSessions = activePiSessions;
  let chunksReceived = 0;
  let streamOpened = false;
  let silentReported = false;

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const resetToIdle = () => {
    clearTimer();
    turnState = 'idle';
    turnStartedAt = 0;
    lastActivityAt = 0;
    chunksReceived = 0;
    streamOpened = false;
    silentReported = false;
  };

  const report = (
    stage: StreamStallStage,
    extra?: { errorKind?: StreamStallErrorKind; errorMessage?: string },
  ) => {
    const ts = now();
    const idleMs = turnStartedAt > 0 ? Math.max(0, ts - lastActivityAt) : 0;
    const turnElapsedMs =
      turnStartedAt > 0 ? Math.max(0, ts - turnStartedAt) : 0;
    const truncatedError = extra?.errorMessage
      ? redactSecrets(extra.errorMessage).slice(0, 200)
      : undefined;

    logToFile(
      `[${opts.tag}] stream stalled (stage=${stage} model=${
        opts.model
      } turn=${turnNumber} opened=${String(
        streamOpened,
      )} chunks=${chunksReceived} idle=${Math.round(
        idleMs / 1000,
      )}s active=${activePiSessions}${
        extra?.errorKind ? ` kind=${extra.errorKind}` : ''
      })`,
    );

    analytics.wizardCapture(STREAM_STALL_EVENT, {
      ...opts.analyticsProperties,
      stage,
      harness: 'pi',
      sequence: opts.sequence,
      model: opts.model,
      ...(opts.effort ? { effort: opts.effort } : {}),
      api: opts.api,
      turn_number: turnNumber,
      stream_opened: streamOpened,
      chunks_received: chunksReceived,
      idle_ms: idleMs,
      turn_elapsed_ms: turnElapsedMs,
      active_sessions: activePiSessions,
      turn_start_active_sessions: turnStartActiveSessions,
      ...(extra?.errorKind ? { error_kind: extra.errorKind } : {}),
      ...(truncatedError ? { error_message: truncatedError } : {}),
    });
  };

  const armTimer = () => {
    clearTimer();
    if (
      disposed ||
      turnState !== 'waiting' ||
      silentReported ||
      thresholdMs <= 0
    ) {
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      if (disposed || turnState !== 'waiting' || silentReported) return;
      silentReported = true;
      report('silent');
    }, thresholdMs);
    timer.unref?.();
  };

  return {
    onEvent(event: StreamStallEvent): void {
      if (disposed) return;

      switch (event.type) {
        case 'turn_start': {
          turnNumber += 1;
          turnState = 'waiting';
          turnStartedAt = now();
          lastActivityAt = turnStartedAt;
          turnStartActiveSessions = activePiSessions;
          chunksReceived = 0;
          streamOpened = false;
          silentReported = false;
          armTimer();
          break;
        }
        case 'message_start': {
          const msg = event.message as AssistantMessageShape | undefined;
          if (turnState !== 'waiting' || msg?.role !== 'assistant') break;
          streamOpened = true;
          lastActivityAt = now();
          armTimer();
          break;
        }
        case 'message_update': {
          if (turnState !== 'waiting') break;
          chunksReceived += 1;
          lastActivityAt = now();
          armTimer();
          break;
        }
        case 'message_end': {
          const msg = event.message as AssistantMessageShape | undefined;
          if (msg?.role !== 'assistant') break;
          clearTimer();
          const idleMs =
            turnStartedAt > 0 ? Math.max(0, now() - lastActivityAt) : 0;

          if (msg.stopReason === 'error') {
            const errorKind = classifyStreamStallError(msg.errorMessage);
            if (
              errorKind !== undefined ||
              silentReported ||
              (thresholdMs > 0 && idleMs >= thresholdMs)
            ) {
              turnState = 'failed';
              report('failed', {
                errorKind: errorKind ?? 'other',
                errorMessage: msg.errorMessage,
              });
            } else {
              resetToIdle();
            }
          } else if (msg.stopReason === 'aborted') {
            if (silentReported) {
              report('aborted');
            }
            resetToIdle();
          } else {
            if (silentReported) {
              report('recovered');
            }
            resetToIdle();
          }
          break;
        }
        case 'auto_retry_start':
        case 'compaction_start': {
          if (turnState === 'waiting') {
            clearTimer();
            turnState = 'paused';
          }
          break;
        }
        case 'auto_retry_end': {
          if (turnState !== 'paused') break;
          if (event.success === false) {
            resetToIdle();
          } else {
            turnState = 'waiting';
            lastActivityAt = now();
            armTimer();
          }
          break;
        }
        case 'compaction_end': {
          if (turnState !== 'paused') break;
          if (event.aborted) {
            resetToIdle();
          } else {
            turnState = 'waiting';
            lastActivityAt = now();
            armTimer();
          }
          break;
        }
        case 'agent_end': {
          if (turnState !== 'failed') {
            resetToIdle();
          } else {
            clearTimer();
          }
          break;
        }
        default:
          break;
      }
    },

    noteTransportError(errorMessage: string): void {
      if (disposed || turnState === 'failed') return;
      clearTimer();
      const errorKind = classifyStreamStallError(errorMessage);
      if (errorKind !== undefined || silentReported) {
        turnState = 'failed';
        report('failed', {
          errorKind: errorKind ?? 'other',
          errorMessage,
        });
      }
    },

    dispose(disposeOpts?: { cancelled?: boolean }): void {
      if (disposed) return;
      clearTimer();
      if (
        disposeOpts?.cancelled &&
        (turnState === 'waiting' || turnState === 'paused') &&
        silentReported
      ) {
        report('aborted');
      }
      resetToIdle();
      disposed = true;
      activePiSessions = Math.max(0, activePiSessions - 1);
    },
  };
}
