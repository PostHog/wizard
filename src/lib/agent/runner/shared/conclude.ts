import { getUI } from '../../../../ui';
import { logToFile } from '../../../../utils/debug';
import { analytics } from '../../../../utils/analytics';
import { WIZARD_REMARK_EVENT_NAME } from '../../../constants';
import { AgentSignals, AgentErrorType } from '../../signals';
import type { RunBridge, BridgeResult } from './run-bridge';
import { mapRunnerError } from './errors';

/**
 * The post-loop tail shared by the `pi` and `vercel` runners.
 *
 * Both runners stream their SDK's events into a {@link RunBridge}, then need the
 * same conclusion `runAgent` performs: turn the accumulated signals into a
 * result, stop the spinner with a matching message, capture the remark and
 * duration analytics, and run the benchmark middleware's finalize. Keeping it
 * here means the result taxonomy and metrics stay identical across runners.
 */

/** Spinner surface the conclusion stops. */
interface StoppableSpinner {
  stop(message?: string): void;
}

/** Benchmark middleware hook (best-effort; only active in benchmark mode). */
interface FinalizeMiddleware {
  finalize(resultMessage: unknown, totalDurationMs: number): unknown;
}

export interface ConcludeOptions {
  bridge: RunBridge;
  spinner: StoppableSpinner;
  startTime: number;
  successMessage: string;
  errorMessage: string;
  /** Runner label for log lines (`vercel` | `pi`). */
  label: string;
  middleware?: FinalizeMiddleware;
  /** Result message handed to `middleware.finalize` (shape is per-runner). */
  finalizeMessage?: unknown;
}

/** Spinner stop text per error type, mirroring `runAgent`'s messages. */
function stopMessageFor(result: BridgeResult, errorMessage: string): string {
  switch (result.error) {
    case AgentErrorType.ABORT:
      return 'Wizard aborted';
    case AgentErrorType.YARA_VIOLATION:
      return 'Security violation detected';
    case AgentErrorType.MCP_MISSING:
      return 'Agent could not access PostHog MCP';
    case AgentErrorType.RESOURCE_MISSING:
      return 'Agent could not access setup resource';
    case AgentErrorType.RATE_LIMIT:
      return 'Rate limit exceeded';
    case AgentErrorType.API_ERROR:
      return 'API error occurred';
    default:
      return errorMessage;
  }
}

/** Capture the run duration on a non-success exit, matching `runAgent`. */
function captureAborted(startTime: number): void {
  const durationMs = Date.now() - startTime;
  analytics.wizardCapture('agent aborted', {
    duration_ms: durationMs,
    duration_seconds: Math.round(durationMs / 1000),
  });
}

/**
 * Conclude a run that finished its loop without throwing. Inspects the bridge's
 * signals: on any error result, stops the spinner with the matching message and
 * returns it; otherwise captures the remark/duration, runs middleware finalize,
 * and returns success (`{}`).
 */
export function concludeRun(opts: ConcludeOptions): BridgeResult {
  const { bridge, spinner, startTime, successMessage, errorMessage } = opts;
  const result = bridge.finalize();
  if (result.error) {
    captureAborted(startTime);
    spinner.stop(stopMessageFor(result, errorMessage));
    return result;
  }

  const remark = bridge.remark();
  if (remark) analytics.capture(WIZARD_REMARK_EVENT_NAME, { remark });
  const durationMs = Date.now() - startTime;
  analytics.wizardCapture('agent completed', {
    duration_ms: durationMs,
    duration_seconds: Math.round(durationMs / 1000),
  });
  try {
    opts.middleware?.finalize(opts.finalizeMessage, durationMs);
  } catch (e) {
    logToFile(`${AgentSignals.BENCHMARK} Middleware finalize error:`, e);
  }
  spinner.stop(successMessage);
  return {};
}

/**
 * Conclude a run that threw (transport/loop failure) or surfaced a stream-level
 * error. In-band signals collected before the throw win — abort, YARA, and API
 * markers — mirroring `runAgent`'s catch ordering; otherwise the raw error is
 * mapped (429 → RATE_LIMIT, else API_ERROR).
 */
export function concludeError(
  error: unknown,
  opts: ConcludeOptions,
): BridgeResult {
  const { bridge, spinner, startTime, errorMessage, label } = opts;
  captureAborted(startTime);

  const signalResult = bridge.finalize();
  if (signalResult.error) {
    spinner.stop(stopMessageFor(signalResult, errorMessage));
    return signalResult;
  }

  const mapped = mapRunnerError(error);
  logToFile(`[${label}] run failed:`, error);
  getUI().log.error(`Error: ${mapped.message}`);
  spinner.stop(errorMessage);
  return mapped;
}
