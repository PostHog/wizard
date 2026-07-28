/**
 * Responsiveness metrics for an orchestrator run.
 *
 * Responsiveness is the experiment's headline: how quickly the user sees the
 * first progress, and whether progress stays steady (no long silences). The math
 * is accumulated from queue transitions but kept here, pure and time-injected, so
 * it is unit-testable away from the runner. Wall-clock times are passed in as
 * milliseconds; the caller owns the clock.
 */

export interface RunMetricsSummary {
  /** Run start → first task started. */
  time_to_first_task_ms?: number;
  /** Run start → first task completed (the first visible "done"). */
  time_to_first_completion_ms?: number;
  /** Longest silence between two consecutive user-visible transitions. */
  max_gap_ms?: number;
}

/** The per-event timing the `orchestrator task started` event reports. */
export interface StartTiming {
  ms_since_run_start: number;
  gap_since_prev_start_ms?: number;
}

export class RunMetrics {
  private firstStartMs?: number;
  private lastStartMs?: number;
  private firstCompleteMs?: number;
  private lastVisibleMs?: number;
  private maxGapMs = 0;

  constructor(private readonly runStartMs: number) {}

  /** A task started. Returns the per-start-event timing for the start event. */
  recordStart(nowMs: number): StartTiming {
    const timing: StartTiming = {
      ms_since_run_start: nowMs - this.runStartMs,
      gap_since_prev_start_ms:
        this.lastStartMs === undefined ? undefined : nowMs - this.lastStartMs,
    };
    this.firstStartMs ??= nowMs;
    this.lastStartMs = nowMs;
    this.markVisible(nowMs);
    return timing;
  }

  /** A task completed. */
  recordComplete(nowMs: number): void {
    this.firstCompleteMs ??= nowMs;
    this.markVisible(nowMs);
  }

  /** A task reached a terminal non-complete state the user sees (skip/fail). */
  recordTerminal(nowMs: number): void {
    this.markVisible(nowMs);
  }

  /**
   * The run-level responsiveness summary. Timings are `undefined` when the
   * relevant transition never happened (e.g. a run that started no task), so a
   * no-task run stays distinguishable from a genuine zero.
   */
  summary(): RunMetricsSummary {
    return {
      time_to_first_task_ms:
        this.firstStartMs === undefined
          ? undefined
          : this.firstStartMs - this.runStartMs,
      time_to_first_completion_ms:
        this.firstCompleteMs === undefined
          ? undefined
          : this.firstCompleteMs - this.runStartMs,
      max_gap_ms: this.lastVisibleMs === undefined ? undefined : this.maxGapMs,
    };
  }

  /** requeue is not user-visible, so a retry stall counts as silence here. */
  private markVisible(nowMs: number): void {
    if (this.lastVisibleMs !== undefined) {
      this.maxGapMs = Math.max(this.maxGapMs, nowMs - this.lastVisibleMs);
    }
    this.lastVisibleMs = nowMs;
  }
}
