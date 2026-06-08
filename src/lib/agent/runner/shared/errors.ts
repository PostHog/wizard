import { AgentErrorType } from '../../agent-interface';

/**
 * Map runner loop/transport failures and `[ABORT]` signals to the same
 * `AgentErrorType` surfaces the Anthropic SDK path produces, so the TUI and
 * telemetry don't diverge across runners.
 */

const ABORT_PATTERN = /\[ABORT\]\s*(.+?)(?:\n|$)/;

/** Extract the reason from an `[ABORT] <reason>` signal in assistant text, if present. */
export function findAbortReason(text: string): string | null {
  const match = text.match(ABORT_PATTERN);
  return match ? match[1].trim() : null;
}

/** A value carrying an HTTP-ish status (provider/transport errors often do). */
function statusOf(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

/** Map a thrown error to a runner result error + message. 429 → RATE_LIMIT, else API_ERROR. */
export function mapRunnerError(error: unknown): {
  error: AgentErrorType;
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (statusOf(error) === 429) {
    return { error: AgentErrorType.RATE_LIMIT, message };
  }
  return { error: AgentErrorType.API_ERROR, message };
}
